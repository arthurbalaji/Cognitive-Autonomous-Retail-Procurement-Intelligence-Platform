#!/usr/bin/env python3
"""E9 - webhook ingestion load test against the live stack (run on an otherwise idle machine).

Signed Shopify-style `inventory_levels/update` webhooks (exactly the POS' signing: HMAC-SHA256 over the raw body, shop domain,
unique webhook id, triggered-at) are sent open-loop at fixed rates straight to CARPIP's public webhook endpoint for store-1.
Per event the stock alternates between the item's true level and level+1 (never lower, so no reorder can trigger); at the end every
item is restored to its true POS level with a newer version and convergence is verified.

Latency is measured client-side (monotonic clock). Pipeline lag is measured with DATABASE timestamps only (no clock skew):
inbound_event.received_at -> stock_movement.at (joined on the unique source version) and outbox published_at - created_at.

    python scripts/bench/load_ingest.py --rates 25 50 100 200 --secs 60
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import platform
import subprocess
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "results")


def env(name: str) -> str:
    for line in open(os.path.join(ROOT, ".env"), encoding="utf8"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"{name} missing from .env")


def psql(db: str, user: str, pw_name: str, sql: str) -> list[list[str]]:
    p = subprocess.run(["docker", "compose", "exec", "-T", "-e", f"PGPASSWORD={env(pw_name)}", "postgres", "psql", "-U", user, "-d", db, "-At", "-F", "\t", "-c", sql],
                       cwd=ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"psql failed: {p.stderr[:400]}")
    return [ln.split("\t") for ln in p.stdout.strip().splitlines() if ln]


def pos(sql):
    return psql("pos", "pos_app", "POS_DB_PASSWORD", sql)


def core(sql):
    return psql("carpip", "carpip_app", "CARPIP_DB_PASSWORD", sql)


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else float("nan")


class Sampler(threading.Thread):
    """Samples docker stats for the backend/postgres/kafka containers while a phase runs."""
    def __init__(self):
        super().__init__(daemon=True)
        self.stop_ev = threading.Event()
        self.rows: dict[str, list[float]] = {}

    def run(self):
        while not self.stop_ev.is_set():
            p = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}}"], capture_output=True, text=True)
            for ln in p.stdout.splitlines():
                n, c = ln.rsplit(" ", 1)
                if any(k in n for k in ("carpip-backend", "postgres", "kafka", "pos-backend")):
                    self.rows.setdefault(n, []).append(float(c.strip("%")))
            self.stop_ev.wait(3)


async def phase(client: httpx.AsyncClient, url: str, shop: dict, items: list[dict], rate: int, secs: int, tag: str, seq: dict) -> dict:
    lat, codes, outcomes = [], {}, {}
    t_start = time.perf_counter()
    sem = asyncio.Semaphore(512)
    tasks = []
    n_total = rate * secs
    base_ts = datetime.now(timezone.utc)

    async def one(k: int):
        it = items[k % len(items)]
        seq[it["id"]] = seq.get(it["id"], 0) + 1
        ts = base_ts + timedelta(milliseconds=k + 1)   # unique, strictly increasing version per event
        avail = it["available"] + (k // len(items)) % 2
        body = json.dumps({"inventory_item_id": it["id"], "location_id": it["loc"], "available": avail,
                           "updated_at": ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"}, separators=(",", ":")).encode()
        sig = base64.b64encode(hmac.new(shop["secret"].encode(), body, hashlib.sha256).digest()).decode()
        hdr = {"Content-Type": "application/json", "X-Shopify-Topic": "inventory_levels/update", "X-Shopify-Hmac-Sha256": sig, "X-Shopify-Shop-Domain": shop["domain"],
               "X-Shopify-Webhook-Id": f"load-{tag}-{k}-{uuid.uuid4().hex[:8]}", "X-Shopify-Triggered-At": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
               "X-Shopify-API-Version": "2024-01"}
        async with sem:
            t0 = time.perf_counter()
            try:
                r = await client.post(url, content=body, headers=hdr)
                dt = (time.perf_counter() - t0) * 1000
                lat.append(dt)
                codes[r.status_code] = codes.get(r.status_code, 0) + 1
                try:
                    o = r.json().get("status", "?")
                except Exception:  # noqa: BLE001
                    o = "?"
                outcomes[o] = outcomes.get(o, 0) + 1
            except Exception as e:  # noqa: BLE001
                codes[type(e).__name__] = codes.get(type(e).__name__, 0) + 1

    for k in range(n_total):                                   # open loop: arrivals are scheduled, never waiting for replies
        delay = t_start + k / rate - time.perf_counter()
        if delay > 0:
            await asyncio.sleep(delay)
        tasks.append(asyncio.create_task(one(k)))
    await asyncio.gather(*tasks)
    wall = time.perf_counter() - t_start
    ok = codes.get(200, 0)
    return {"rate": rate, "sent": n_total, "ok": ok, "errors": n_total - ok, "codes": {str(k): v for k, v in codes.items()}, "outcomes": outcomes, "wall_s": round(wall, 2),
            "achieved_rps": round(n_total / wall, 1), "p50_ms": round(pct(lat, .5), 1), "p95_ms": round(pct(lat, .95), 1), "p99_ms": round(pct(lat, .99), 1), "max_ms": round(max(lat), 1) if lat else None}


def drain(timeout: float = 180.0) -> float:
    t0 = time.time()
    while time.time() - t0 < timeout:
        n = int(core("SELECT count(*) FROM outbox_event WHERE published_at IS NULL")[0][0])
        lag = int(core("SELECT count(*) FROM inbound_event WHERE external_event_id LIKE 'load-%' AND status='RECEIVED'")[0][0])
        if n == 0 and lag == 0:
            time.sleep(3)
            return time.time() - t0
        time.sleep(1)
    return float("nan")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rates", type=int, nargs="+", default=[25, 50, 100, 200])
    ap.add_argument("--secs", type=int, default=60)
    ap.add_argument("--items", type=int, default=100)
    a = ap.parse_args()

    shop_row = pos("SELECT domain, webhook_secret FROM shops WHERE handle='store-1'")[0]
    addr = pos("SELECT address FROM webhook_subscriptions WHERE shop_id=(SELECT id FROM shops WHERE handle='store-1') AND topic='inventory_levels/update' LIMIT 1")[0][0]
    url = "http://127.0.0.1:8080/api/erp/webhook/" + addr.rsplit("/", 1)[1]
    shop = {"domain": shop_row[0], "secret": shop_row[1]}
    rows = pos("""SELECT l.inventory_item_id, l.location_id, l.available FROM inventory_levels l JOIN inventory_items i ON i.id=l.inventory_item_id
                  JOIN variants v ON v.inventory_item_id=i.id JOIN products p ON p.id=v.product_id WHERE p.shop_id=(SELECT id FROM shops WHERE handle='store-1')
                  ORDER BY l.available DESC LIMIT %d""" % a.items)
    items = [{"id": int(r[0]), "loc": int(r[1]), "available": int(r[2])} for r in rows]
    print(f"{len(items)} items, available range {items[-1]['available']}..{items[0]['available']}; endpoint {url}")
    po_before = core("SELECT count(*) FROM purchase_order")[0][0]
    t_run = datetime.now(timezone.utc)

    results, cpu = [], {}
    seq: dict = {}
    for rate in a.rates:
        s = Sampler()
        s.start()
        print(f"== {rate} req/s for {a.secs} s", flush=True)

        async def go():
            async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=512)) as c:
                return await phase(c, url, shop, items, rate, a.secs, f"r{rate}", seq)
        res = asyncio.run(go())
        res["drain_s"] = round(drain(), 1)
        s.stop_ev.set()
        res["peak_cpu_pct"] = {k: max(v) for k, v in s.rows.items()}
        res["mean_cpu_pct"] = {k: round(sum(v) / len(v), 1) for k, v in s.rows.items()}
        print(json.dumps(res), flush=True)
        results.append(res)

    # restore true levels with a newer version, then verify convergence
    now = datetime.now(timezone.utc) + timedelta(seconds=2)
    async def restore():
        async with httpx.AsyncClient(timeout=30) as c:
            for k, it in enumerate(items):
                body = json.dumps({"inventory_item_id": it["id"], "location_id": it["loc"], "available": it["available"],
                                   "updated_at": (now + timedelta(milliseconds=k)).strftime("%Y-%m-%dT%H:%M:%S.") + f"{(now + timedelta(milliseconds=k)).microsecond // 1000:03d}Z"}, separators=(",", ":")).encode()
                sig = base64.b64encode(hmac.new(shop["secret"].encode(), body, hashlib.sha256).digest()).decode()
                await c.post(url, content=body, headers={"Content-Type": "application/json", "X-Shopify-Topic": "inventory_levels/update", "X-Shopify-Hmac-Sha256": sig,
                                                         "X-Shopify-Shop-Domain": shop["domain"], "X-Shopify-Webhook-Id": f"load-restore-{k}-{uuid.uuid4().hex[:8]}",
                                                         "X-Shopify-Triggered-At": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "X-Shopify-API-Version": "2024-01"})
    time.sleep(1)
    wait = (now - datetime.now(timezone.utc)).total_seconds()
    if wait > 0:
        time.sleep(wait + 0.5)
    asyncio.run(restore())
    drain()
    ids = ",".join(str(i["id"]) for i in items)
    truth = {int(r[0]): int(r[1]) for r in pos(f"SELECT inventory_item_id, available FROM inventory_levels WHERE inventory_item_id IN ({ids})")}
    carp = core("""SELECT p.sku, p.current_stock FROM product p WHERE p.tenant_id=(SELECT tenant_id FROM inbound_event WHERE external_event_id LIKE 'load-%' LIMIT 1)""")
    sku_of = {int(r[0]): r[1] for r in pos(f"SELECT i.id, i.sku FROM inventory_items i WHERE i.id IN ({ids})")}
    cmap = {r[0]: int(r[1]) for r in carp}
    mismatch = [(sku_of[i], truth[i], cmap.get(sku_of[i])) for i in truth if cmap.get(sku_of[i]) != truth[i]]

    # database-clock pipeline lag per phase
    lag = core("""
      WITH ev AS (SELECT split_part(external_event_id,'-',2) AS phase, received_at, (payload->>'updated_at')::timestamptz AS sv FROM inbound_event WHERE external_event_id LIKE 'load-r%'),
           ap AS (SELECT ev.phase, ev.received_at, min(m.at) AS applied_at FROM ev JOIN stock_movement m ON m.source_version = ev.sv GROUP BY ev.phase, ev.received_at, ev.sv)
      SELECT phase, count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM applied_at-received_at)),
             percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM applied_at-received_at)), percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM applied_at-received_at)),
             max(extract(epoch FROM applied_at-received_at)), extract(epoch FROM max(applied_at)-min(received_at)) FROM ap GROUP BY phase ORDER BY phase""")
    relay = core("""SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM published_at-created_at)), percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM published_at-created_at))
                    FROM outbox_event WHERE topic='inventory.updates' AND created_at >= '%s'""" % t_run.isoformat())[0]
    lagd = {r[0]: {"applied": int(r[1]), "lag_p50_s": round(float(r[2]), 3), "lag_p95_s": round(float(r[3]), 3), "lag_p99_s": round(float(r[4]), 3), "lag_max_s": round(float(r[5]), 3), "span_s": round(float(r[6]), 1)} for r in lag}
    for r in results:
        r["pipeline"] = lagd.get(f"r{r['rate']}")
        if r["pipeline"]:
            r["lost_or_unapplied"] = r["ok"] - r["pipeline"]["applied"]
    po_after = core("SELECT count(*) FROM purchase_order")[0][0]
    out = {"hardware": {"host": platform.platform(), "note": "all services + load generator on one laptop (i5-1235U, 16 GB, Docker Desktop)"}, "secs_per_rate": a.secs, "items": len(items),
           "outbox_relay_lag_s_p50_p99": [round(float(x), 3) for x in relay], "purchase_orders_before_after": [po_before, po_after], "restore_mismatches": mismatch, "phases": results}
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "load_ingest.json"), "w"), indent=2)
    md = ["# E9 - webhook ingestion load test (live stack, single laptop)", "",
          f"Open-loop, HMAC-signed `inventory_levels/update` webhooks to CARPIP's public endpoint for store-1, {a.secs} s per rate, {len(items)} items. "
          "Latency = client-side round trip to the HTTP 200 (verification + inbound_event insert + outbox insert in one transaction). Pipeline lag = database clock, inbound_event.received_at -> stock_movement.at "
          "(outbox relay -> Kafka -> idempotent consumer -> versioned stock write). All services and the generator share one laptop.", "",
          "| offered req/s | achieved | ok | errors | p50 ms | p95 ms | p99 ms | applied | pipeline lag p50 / p95 / p99 s | drain s | backend CPU mean/peak % |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        p = r.get("pipeline") or {}
        bc = [k for k in r["mean_cpu_pct"] if "carpip-backend" in k]
        md.append(f"| {r['rate']} | {r['achieved_rps']} | {r['ok']} | {r['errors']} | {r['p50_ms']} | {r['p95_ms']} | {r['p99_ms']} | {p.get('applied', 'n/a')} | "
                  f"{p.get('lag_p50_s', 'n/a')} / {p.get('lag_p95_s', 'n/a')} / {p.get('lag_p99_s', 'n/a')} | {r['drain_s']} | "
                  f"{r['mean_cpu_pct'].get(bc[0], '') if bc else ''} / {r['peak_cpu_pct'].get(bc[0], '') if bc else ''} |")
    md += ["", f"Outbox relay lag (receipt -> Kafka publish) p50 / p99: {out['outbox_relay_lag_s_p50_p99'][0]} / {out['outbox_relay_lag_s_p50_p99'][1]} s.",
           f"Convergence after restoring true levels: {len(mismatch)} mismatching items of {len(items)}. Purchase orders before/after: {po_before}/{po_after}."]
    open(os.path.join(OUT, "load_ingest.md"), "w", encoding="utf8").write("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    main()
