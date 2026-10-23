#!/usr/bin/env python3
"""Resilience scenarios: triggers each demo failure through the admin API and ASSERTS how the platform reacts.

  python scripts/e2e/scenarios.py [--only webhook-replay,kafka-outage,...]

Scenarios: webhook-replay, out-of-order, kafka-outage, bedrock-outage, supplier-stockout, decline-reroute, concurrency-race, tenant-isolation
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import sys
import time

import httpx

CARPIP, POS, ERP = os.getenv("CARPIP_URL", "http://127.0.0.1:8080"), os.getenv("POS_URL", "http://127.0.0.1:4000"), os.getenv("ERP_URL", "http://127.0.0.1:8000")
PW = "Demo@12345"
FAILS: list[str] = []
c = httpx.Client(timeout=90)


def check(cond: bool, label: str, detail: str = "") -> None:
    print(f"   {'PASS' if cond else 'FAIL'}  {label}{'  -> ' + str(detail) if detail and not cond else ''}", flush=True)
    if not cond:
        FAILS.append(label)


def j(method, url, **kw):
    tolerate = kw.pop("_ok", False)
    r = c.request(method, url, **kw)
    if r.status_code >= 400 and not tolerate:
        raise SystemExit(f"{method} {url} -> {r.status_code} {r.text[:300]}")
    return r.json() if r.content else {}


def login(email, pw=PW):
    return {"Authorization": "Bearer " + j("POST", f"{CARPIP}/api/auth/login", json={"email": email, "password": pw})["token"]}


ADMIN = login(os.getenv("CARPIP_ADMIN_EMAIL", "admin@carpip.local"), os.getenv("CARPIP_ADMIN_PASSWORD", "Admin@12345"))
R1 = login("retailer1@carpip.demo")
POS_TOK = {"Authorization": "Bearer " + j("POST", f"{POS}/pos/api/auth/pin", json={"shop": "store-1", "pin": "1111"})["token"]}


def scenario(name, params=None):
    return j("POST", f"{CARPIP}/api/admin/demo/scenarios/{name}", json={"params": params or {}}, headers=ADMIN)


def pos_stock(sku):
    return next(p["available"] for p in j("GET", f"{POS}/pos/api/shops/store-1/products?q={sku}", headers=POS_TOK) if p["sku"] == sku)


def pick_safe_sku(min_stock=40):
    """A well-stocked SKU far above its reorder point (so test sales do not trigger procurement)."""
    items = j("GET", f"{CARPIP}/api/products?size=200", headers=R1)["items"]
    return max((p for p in items if p["reorder_point"] > 0 and not p["open_po_status"] and p["current_stock"] >= min_stock), key=lambda p: p["position"] / p["reorder_point"])


def sell(sku, q):
    return httpx.post(f"{POS}/pos/api/shops/store-1/checkout", json={"items": [{"sku": sku, "qty": q}]}, headers=POS_TOK, timeout=60)


def wait(cond, secs=40, step=1.0):
    t = time.time()
    while time.time() - t < secs:
        v = cond()
        if v:
            return v
        time.sleep(step)
    return None


def webhook_replay():
    print("\n== webhook-replay (duplicate / content-idempotent / tampered / stale)")
    p = pick_safe_sku()
    sell(p["sku"], 1)
    wait(lambda: j("GET", f"{CARPIP}/api/products/{p['id']}", headers=R1)["current_stock"] == pos_stock(p["sku"]), 20)
    time.sleep(2)
    before = j("GET", f"{CARPIP}/api/products/{p['id']}", headers=R1)["current_stock"]
    audit0 = len([a for a in j("GET", f"{CARPIP}/api/admin/audit?limit=300", headers=ADMIN) if a["action"] == "WEBHOOK_SIGNATURE_INVALID"])
    r = scenario("webhook-replay", {"mode": "same", "topic": "orders/create", "shop": "store-1"})["triggered"]
    check(r["carpipStatus"] == 200 and "duplicate" in r["carpipResponse"], "same webhook id -> 200 duplicate", r)
    r = scenario("webhook-replay", {"mode": "new_id", "topic": "orders/create", "shop": "store-1"})["triggered"]
    time.sleep(3)
    after = j("GET", f"{CARPIP}/api/products/{p['id']}", headers=R1)["current_stock"]
    check(r["carpipStatus"] == 200 and before == after, "same body under a NEW id is accepted but changes nothing (content-level idempotency)", f"{before}->{after}")
    r = scenario("webhook-replay", {"mode": "tampered", "topic": "orders/create", "shop": "store-1"})["triggered"]
    check(r["carpipStatus"] == 401, "tampered body (old signature) -> 401", r)
    r = scenario("webhook-replay", {"mode": "stale", "topic": "orders/create", "shop": "store-1"})["triggered"]
    check(r["carpipStatus"] == 401, "stale timestamp (1 h old) -> 401", r)
    audit1 = len([a for a in j("GET", f"{CARPIP}/api/admin/audit?limit=300", headers=ADMIN) if a["action"] == "WEBHOOK_SIGNATURE_INVALID"])
    check(audit1 > audit0, "signature failure written to the audit log")


def out_of_order():
    print("\n== out-of-order inventory events")
    r = scenario("out-of-order", {"shop": "store-1"})["triggered"]
    sku = r["sku"]
    pid = next(p["id"] for p in j("GET", f"{CARPIP}/api/products?size=200&q={sku}", headers=R1)["items"] if p["sku"] == sku)
    ok = wait(lambda: j("GET", f"{CARPIP}/api/products/{pid}", headers=R1)["current_stock"] == r["second"], 30)
    check(bool(ok), f"CARPIP ends on the NEWEST value ({r['second']}), not the late older one ({r['first']})")
    time.sleep(6)
    mv = j("GET", f"{CARPIP}/api/products/{pid}/movements", headers=R1)
    check(any(m["reason"] == "STALE_IGNORED" for m in mv), "the late older update was recorded as STALE_IGNORED")
    check(j("GET", f"{CARPIP}/api/products/{pid}", headers=R1)["current_stock"] == pos_stock(sku), "CARPIP == POS afterwards")


def kafka_outage():
    print("\n== kafka outage (transactional outbox)")
    p = pick_safe_sku()
    scenario("kafka-outage", {"paused": True})
    try:
        pos_before = pos_stock(p["sku"])
        sell(p["sku"], 2)
        time.sleep(6)
        h = j("GET", f"{CARPIP}/api/admin/system/health", headers=ADMIN)
        cur = j("GET", f"{CARPIP}/api/products/{p['id']}", headers=R1)["current_stock"]
        check(h["outbox"]["backlog"] > 0, "webhook accepted (200) and parked in the outbox while Kafka is 'down'", h["outbox"])
        # (CARPIP's polling reconciliation may legitimately refresh stock during the outage - that is the designed fallback path)
        print(f"   info  during the outage CARPIP stock={cur}, POS stock={pos_stock(p['sku'])} (polling fallback may already have reconciled)")
    finally:
        scenario("kafka-outage", {"paused": False})
    ok = wait(lambda: j("GET", f"{CARPIP}/api/products/{p['id']}", headers=R1)["current_stock"] == pos_stock(p["sku"]), 40)
    check(bool(ok), "after resume the backlog drains and stock converges")
    check(bool(wait(lambda: j("GET", f"{CARPIP}/api/admin/system/health", headers=ADMIN)["outbox"]["backlog"] == 0, 30)), "outbox drained after resume")
    _ = pos_before


def bedrock_outage():
    print("\n== bedrock outage -> deterministic rule fallback")
    for fault in ("throttle", "out_of_bounds"):
        scenario("bedrock-outage", {"mode": fault})
        items = j("GET", f"{CARPIP}/api/products?size=200", headers=R1)["items"]
        cand = [p for p in items if p["reorder_point"] > 0 and p["position"] > p["reorder_point"] and not p["open_po_status"] and p["gtin"]]
        cand.sort(key=lambda p: p["position"] / p["reorder_point"])
        p = cand[0]
        need = p["position"] - p["reorder_point"] + 1
        sell(p["sku"], max(1, need))
        po = wait(lambda: next((x for x in j("GET", f"{CARPIP}/api/purchase-orders?limit=50", headers=R1) if x["product_id"] == p["id"] and x["origin"] == "AI"), None), 30)
        check(po is not None, f"[{fault}] a PO was still raised")
        if not po:
            continue
        d = wait(lambda: (lambda x: x if x["status"] != "NEGOTIATING" else None)(j("GET", f"{CARPIP}/api/purchase-orders/{po['id']}", headers=ADMIN)), 120, 2)
        check(d is not None and d["status"] not in ("NEGOTIATION_ERROR",), f"[{fault}] negotiation completed anyway", d and d["status"])
        if d:
            turns = [t for n in d["negotiations"] for t in n["turns"]]
            if fault == "out_of_bounds":      # the model answers, but with a wrong action / 1-rupee price / prompt injection
                check(sum(n["guardrail_interventions"] or 0 for n in d["negotiations"]) > 0, f"[{fault}] guardrails overrode the hallucinated responses")
                check(not any("ignore all previous" in (t["message"] or "").lower() for t in turns), f"[{fault}] injected text never reached the transcript")
            else:
                check(bool(turns) and all(t["source"] == "RULE" for t in turns), f"[{fault}] every turn fell back to the RULE voice", {t["source"] for t in turns})
            for n in d["negotiations"]:
                if n["status"] == "ACCEPTED":
                    check(float(n["floor_price"]) <= float(n["final_price"]) <= float(n["retailer_max"]), f"[{fault}] price still inside bounds ({n['final_price']})")
        # let this PO finish so the next iteration starts clean
        j("POST", f"{CARPIP}/api/purchase-orders/{po['id']}/cancel", json={"reason": "scenario cleanup"}, headers=R1, _ok=True)
    scenario("bedrock-outage", {"mode": "none"})


def supplier_stockout():
    print("\n== supplier stock-out propagates to CARPIP (WB / signed webhook)")
    res = scenario("supplier-stockout", {"company": "WB"})["triggered"]["stockedOut"][0]
    sku = res["sku"]
    def avail():
        offers = j("GET", f"{CARPIP}/api/suppliers/offers", headers=ADMIN)
        return next((o["available_qty"] for o in offers if o["supplier_sku"] == sku), None)
    ok = wait(lambda: avail() == 0, 40)
    check(bool(ok), f"CARPIP shows {sku} as unavailable at Sri Murugan within seconds", avail())


def concurrency_race():
    print("\n== two checkouts race for the last units")
    p = pick_safe_sku(60)
    have = pos_stock(p["sku"])
    with cf.ThreadPoolExecutor(12) as ex:
        res = list(ex.map(lambda _: sell(p["sku"], have // 4 + 1), range(12)))
    ok = sum(1 for r in res if r.status_code == 200)
    over = sum(1 for r in res if r.status_code == 409)
    check(ok > 0 and over > 0, f"some checkouts succeed ({ok}), the rest are refused with 409 OUT_OF_STOCK ({over})")
    check(pos_stock(p["sku"]) >= 0, "stock never goes negative", pos_stock(p["sku"]))
    check(pos_stock(p["sku"]) == have - ok * (have // 4 + 1), "stock equals exactly (initial - successful sales)")


def tenant_isolation():
    print("\n== tenant isolation")
    r2 = login("retailer2@carpip.demo")
    foreign = j("GET", f"{CARPIP}/api/products?size=1", headers=r2)["items"][0]["id"]
    r = c.get(f"{CARPIP}/api/products/{foreign}", headers=R1)
    check(r.status_code == 404, "another retailer's product id -> 404 (not 403)", r.status_code)
    r = c.get(f"{CARPIP}/api/products?size=5", headers={"Authorization": "Bearer garbage"})
    check(r.status_code == 401, "garbage token -> 401")
    r = c.post(f"{CARPIP}/api/admin/tenants", json={"name": "x", "type": "RETAILER"}, headers=R1)
    check(r.status_code == 403, "retailer cannot call admin API -> 403", r.status_code)
    wh = login("wholesaler-a@carpip.demo")
    r = c.get(f"{CARPIP}/api/products", headers=wh)
    check(r.status_code == 403, "wholesaler cannot read retailer inventory -> 403", r.status_code)
    r = c.post(f"{CARPIP}/graphql", json={"query": "{ stockStatus(first:3){ sku } }"}, headers=wh)
    check(r.status_code == 200 and r.json().get("errors"), "wholesaler GraphQL stockStatus is denied")


def _env(name, default=""):
    if os.getenv(name):
        return os.getenv(name)
    try:
        for line in open(os.path.join(os.path.dirname(__file__), "..", "..", ".env"), encoding="utf-8"):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return default


def decline_reroute():
    print("\n== supplier declines after submission -> re-route to the next-ranked quote")
    admin_h = {"X-Admin-Token": _env("ERP_ADMIN_TOKEN")}
    flags = lambda code, v: j("PATCH", f"{ERP}/erp/admin/companies/{code}/flags", json={"autoConfirm": v}, headers=admin_h)
    for code in ("WA", "WB", "WC"):
        flags(code, False)                       # hold every order unconfirmed so we can make the winner run out of stock
    try:
        items = j("GET", f"{CARPIP}/api/products?size=200", headers=R1)["items"]
        cand = sorted([p for p in items if p["reorder_point"] > 0 and p["position"] > p["reorder_point"] and not p["open_po_status"] and p["gtin"]], key=lambda p: p["position"] / p["reorder_point"])
        p = cand[0]
        sell(p["sku"], max(1, p["position"] - p["reorder_point"] + 1))
        po = wait(lambda: next((x for x in j("GET", f"{CARPIP}/api/purchase-orders?limit=50", headers=R1) if x["product_id"] == p["id"] and x["origin"] == "AI"), None), 30)
        check(po is not None, "a PO was raised")
        d = wait(lambda: (lambda x: x if x["status"] in ("SUBMITTED", "PENDING_APPROVAL", "NEGOTIATION_REJECTED") else None)(j("GET", f"{CARPIP}/api/purchase-orders/{po['id']}", headers=ADMIN)), 120, 2)
        check(d is not None and d["status"] == "SUBMITTED", "PO submitted to the winning supplier and held unconfirmed", d and d["status"])
        first = d["wholesaler"]
        code = {"Kovai Distributors": "WA", "Sri Murugan Wholesale": "WB", "Chennai Bulk Traders": "WC"}[first]
        etok = {"Authorization": "Bearer " + j("POST", f"{ERP}/erp/api/auth/login", json={"email": {"WA": "a", "WB": "b", "WC": "c"}[code] + "@erp.demo", "password": PW})["token"]}
        so = wait(lambda: next((o for o in j("GET", f"{ERP}/erp/api/sales-orders", headers=etok) if o["po_number"] == d["po_number"]), None), 30)
        check(so is not None, f"order is waiting unconfirmed in {first}'s ERP")
        sku = j("GET", f"{ERP}/erp/api/sales-orders/{so['id']}", headers=etok)["lines"][0]["sku"]
        j("POST", f"{ERP}/erp/demo/stockout", json={"company": code, "sku": sku}, headers=admin_h)
        moved = wait(lambda: (lambda x: x if x["wholesaler"] != first and x["status"] in ("APPROVED", "SUBMITTED", "CONFIRMED", "PARTIALLY_CONFIRMED") else None)(j("GET", f"{CARPIP}/api/purchase-orders/{po['id']}", headers=ADMIN)), 60, 2)
        check(moved is not None, f"supplier {first} rejected (out of stock) and the PO was re-routed", moved and moved["wholesaler"])
        if moved:
            hist = " | ".join(h["reason"] or "" for h in moved["history"])
            check("rerouted" in hist, "history records the re-route", hist[-160:])
            print(f"   info  re-routed to {moved['wholesaler']} at {moved['unit_price_agreed']}")
    finally:
        for code in ("WA", "WB", "WC"):
            flags(code, True)


ALL = {"webhook-replay": webhook_replay, "out-of-order": out_of_order, "kafka-outage": kafka_outage, "bedrock-outage": bedrock_outage,
       "supplier-stockout": supplier_stockout, "concurrency-race": concurrency_race, "decline-reroute": decline_reroute, "tenant-isolation": tenant_isolation}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    for name in (a.only.split(",") if a.only else ALL):
        ALL[name.strip()]()
    print("\nSCENARIOS:", "PASSED" if not FAILS else f"FAILED ({len(FAILS)}): {FAILS}")
    sys.exit(1 if FAILS else 0)
