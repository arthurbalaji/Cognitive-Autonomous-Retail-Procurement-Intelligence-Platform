#!/usr/bin/env python3
"""End-to-end smoke test: a POS sale storm -> CARPIP -> negotiation -> supplier ERP -> delivery -> stock back at the POS.

  python scripts/e2e/smoke.py [--store store-1] [--mode llm|rule|off] [--no-concurrency]

Asserts: stock converges between POS and CARPIP; exactly ONE in-flight AI PO per SKU despite concurrent sales; negotiation
turns <= 3 and prices inside [floor, RMAP]; the PO reaches the supplier ERP; after ERP confirm/ship/deliver the retailer's
POS stock increases by the received quantity; no dead-lettered messages; outbox drained.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import sys
import time

import httpx

CARPIP = os.getenv("CARPIP_URL", "http://127.0.0.1:8080")
POS = os.getenv("POS_URL", "http://127.0.0.1:4000")
ERP = os.getenv("ERP_URL", "http://127.0.0.1:8000")
PW = "Demo@12345"
STORES = {"store-1": ("retailer1@carpip.demo", "1111"), "store-2": ("retailer2@carpip.demo", "2222"), "store-3": ("retailer3@carpip.demo", "3333")}
ERP_USERS = {"Kovai Distributors": "a@erp.demo", "Sri Murugan Wholesale": "b@erp.demo", "Chennai Bulk Traders": "c@erp.demo"}
T0 = time.time()
FAILS: list[str] = []


def log(m: str) -> None:
    print(f"[{time.time() - T0:5.0f}s] {m}", flush=True)


def check(cond: bool, label: str, detail: str = "") -> None:
    print(f"   {'PASS' if cond else 'FAIL'}  {label}{'  -> ' + detail if detail and not cond else ''}", flush=True)
    if not cond:
        FAILS.append(label)


def req(c: httpx.Client, method: str, url: str, **kw):
    r = c.request(method, url, **kw)
    if r.status_code >= 400 and not kw.pop("allow", False):
        raise SystemExit(f"{method} {url} -> {r.status_code} {r.text[:300]}")
    return r.json() if r.content else {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default="store-1")
    ap.add_argument("--mode", default=None, help="force negotiation mode via admin setting (llm|rule|off)")
    ap.add_argument("--no-concurrency", action="store_true")
    args = ap.parse_args()
    email, pin = STORES[args.store]
    c = httpx.Client(timeout=60)

    admin_pw = os.getenv("CARPIP_ADMIN_PASSWORD", "Admin@12345")
    admin = req(c, "POST", f"{CARPIP}/api/auth/login", json={"email": os.getenv("CARPIP_ADMIN_EMAIL", "admin@carpip.local"), "password": admin_pw})["token"]
    ah = {"Authorization": f"Bearer {admin}"}
    if args.mode:
        req(c, "PUT", f"{CARPIP}/api/admin/settings/negotiation-mode", json={"mode": args.mode}, headers=ah)
        log(f"negotiation mode forced to {args.mode}")
    h = {"Authorization": "Bearer " + req(c, "POST", f"{CARPIP}/api/auth/login", json={"email": email, "password": PW})["token"]}
    ph = {"Authorization": "Bearer " + req(c, "POST", f"{POS}/pos/api/auth/pin", json={"shop": args.store, "pin": pin})["token"]}

    # ---- pick a SKU just above its reorder point
    items = req(c, "GET", f"{CARPIP}/api/products?size=200", headers=h)["items"]
    cand = [p for p in items if p["reorder_point"] > 0 and p["position"] > p["reorder_point"] and not p["open_po_status"] and p["gtin"]]
    cand.sort(key=lambda p: p["position"] / p["reorder_point"])
    sku = next((p for p in cand if p["position"] / p["reorder_point"] <= 2.0 and p["current_stock"] >= 6), cand[0])
    need = sku["position"] - sku["reorder_point"] + 1
    log(f"selected {sku['sku']} '{sku['name']}': stock {sku['current_stock']}, ROP {sku['reorder_point']}, selling {need} units to cross the threshold")

    # ---- sale storm (several concurrent checkouts incl. a duplicate-looking burst) + replay of the last webhook
    pieces = [min(3, need - i) for i in range(0, need, 3)]
    def sell(q: int):
        return httpx.post(f"{POS}/pos/api/shops/{args.store}/checkout", json={"items": [{"sku": sku["sku"], "qty": q}]}, headers=ph, timeout=60)
    t_sale = time.time()
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(sell, pieces if not args.no_concurrency else pieces))
    sold = sum(p for p, r in zip(pieces, res) if r.status_code == 200)
    log(f"{sum(1 for r in res if r.status_code == 200)}/{len(res)} checkouts succeeded, {sold} units sold")
    check(sold > 0, "POS accepted the concurrent sales")

    # ---- CARPIP must converge on the same stock and raise exactly one PO
    pos_stock = lambda: next(p["available"] for p in req(c, "GET", f"{POS}/pos/api/shops/{args.store}/products?q={sku['sku']}", headers=ph) if p["sku"] == sku["sku"])
    expected = pos_stock()
    po = None
    for _ in range(90):
        time.sleep(1)
        cur = req(c, "GET", f"{CARPIP}/api/products/{sku['id']}", headers=h)
        pos_list = [p for p in req(c, "GET", f"{CARPIP}/api/purchase-orders?limit=100", headers=h) if p["product_id"] == sku["id"] and p["origin"] == "AI"]
        if cur["current_stock"] == expected and pos_list:
            po = pos_list[0]
            break
    check(cur["current_stock"] == expected, f"CARPIP stock converged with POS ({cur['current_stock']} == {expected})  [{time.time() - t_sale:.1f}s after the sale]")
    check(len(pos_list) == 1, "exactly ONE AI purchase order was raised for the SKU", f"found {len(pos_list)}")
    if not po:
        log("no PO appeared"); return 1
    log(f"PO {po['po_number']} created (trigger {po['trigger']})")

    # ---- follow the PO to approval
    t_neg = time.time()
    d = None
    for _ in range(150):
        time.sleep(2)
        d = req(c, "GET", f"{CARPIP}/api/purchase-orders/{po['id']}", headers=h)
        if d["status"] not in ("NEGOTIATING",):
            break
    log(f"negotiation finished in {time.time() - t_neg:.0f}s -> {d['status']} ({d['negotiation_status']})")
    if d["status"] in ("NEGOTIATION_REJECTED", "NEGOTIATION_ERROR"):
        check(d["status"] == "NEGOTIATION_REJECTED", "negotiation ended in a legitimate decision", d["status"])
        log(f"decision: {d['decision']}")
        return 1 if FAILS else 0
    adm = req(c, "GET", f"{CARPIP}/api/purchase-orders/{po['id']}", headers=ah)
    for n in adm["negotiations"]:
        turns = n["turns"]
        rt = {t["turn_no"] for t in turns if t["actor"] == "RETAILER"}
        check(len(rt) <= 3, f"negotiation with {n['supplier']}: <= 3 turns ({len(rt)})")
        fl, mx, fp = n["floor_price"], n["retailer_max"], n["final_price"]
        if n["status"] == "ACCEPTED":
            check(float(fl) <= float(fp) <= float(mx), f"{n['supplier']}: accepted price {fp} within [floor {fl}, RMAP {mx}]")
        srcs = {t["source"] for t in turns}
        log(f"   {n['supplier']}: {n['status']} @ {fp}  base {n['base_price']}  mpi {n['mpi_used']}  sources {sorted(srcs)}  tokens {n['tokens_in']}/{n['tokens_out']}  {n['latency_ms']}ms")
    if d["status"] == "PENDING_APPROVAL":
        req(c, "POST", f"{CARPIP}/api/purchase-orders/{po['id']}/approve", json={}, headers=h)
        log("PO approved manually")

    # ---- supplier side
    supplier = d["wholesaler"]
    etok = {"Authorization": "Bearer " + req(c, "POST", f"{ERP}/erp/api/auth/login", json={"email": ERP_USERS[supplier], "password": PW})["token"]}
    so = None
    for _ in range(90):
        time.sleep(2)
        d = req(c, "GET", f"{CARPIP}/api/purchase-orders/{po['id']}", headers=h)
        orders = req(c, "GET", f"{ERP}/erp/api/sales-orders", headers=etok)
        so = next((o for o in orders if o["po_number"] == d["po_number"]), None)
        if so and d["status"] not in ("APPROVED",):
            break
    check(so is not None, f"PO reached the supplier ERP ({supplier})")
    if not so:
        return 1
    log(f"ERP sales order {so['id']} status {so['status']}; CARPIP PO {d['status']}")
    before = pos_stock()
    for step in range(40):
        time.sleep(2)
        d = req(c, "GET", f"{CARPIP}/api/purchase-orders/{po['id']}", headers=h)
        s = req(c, "GET", f"{ERP}/erp/api/sales-orders/{so['id']}", headers=etok)
        if d["status"] == "CLOSED":
            break
        if s["status"] == "RECEIVED":
            req(c, "POST", f"{ERP}/erp/api/sales-orders/{so['id']}/confirm", json={}, headers=etok)
        elif s["status"] in ("CONFIRMED", "PARTIALLY_CONFIRMED") and d["status"] in ("CONFIRMED", "PARTIALLY_CONFIRMED"):
            time.sleep(1)
            r = httpx.post(f"{ERP}/erp/api/sales-orders/{so['id']}/ship", json={}, headers=etok); log(f"   ERP ship -> {r.status_code}") if r.status_code != 200 else None
        elif s["status"] in ("SHIPPED", "PARTIALLY_SHIPPED") and d["status"] in ("SHIPPED", "PARTIALLY_SHIPPED"):
            r = httpx.post(f"{ERP}/erp/api/sales-orders/{so['id']}/deliver", json={}, headers=etok); log(f"   ERP deliver -> {r.status_code}") if r.status_code != 200 else None
    check(d["status"] == "CLOSED", f"PO closed after ERP confirm/ship/deliver + receipt (status {d['status']})")
    after = pos_stock()
    qty = d["qty_received"]
    check(after == before + qty and qty > 0, f"goods receipt landed in the POS stock (+{qty}: {before} -> {after})")
    time.sleep(2)
    cur = req(c, "GET", f"{CARPIP}/api/products/{sku['id']}", headers=h)
    check(cur["current_stock"] == after, f"CARPIP stock equals POS stock after the receipt echo ({cur['current_stock']} == {after})")
    inc = req(c, "GET", f"{POS}/pos/api/shops/{args.store}/incoming", headers=ph)
    check(any(i["po_number"] == d["po_number"] for i in inc), "POS 'Incoming stock' shows the purchase order")

    # ---- platform health
    hl = req(c, "GET", f"{CARPIP}/api/admin/system/health", headers=ah)
    dead = sum(hl["kafka"].get("deadLetters", {}).values())
    check(dead == 0, "no dead-lettered Kafka messages", str(hl["kafka"].get("deadLetters")))
    check(hl["outbox"]["backlog"] == 0, "outbox fully drained", str(hl["outbox"]))
    check(hl["writebacks"]["dead"] == 0, "no dead writebacks", str(hl["writebacks"]))
    print()
    print("SMOKE TEST:", "PASSED" if not FAILS else f"FAILED ({len(FAILS)}): {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
