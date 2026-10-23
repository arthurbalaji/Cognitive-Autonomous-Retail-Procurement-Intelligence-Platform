"""Wholesale ERP business logic: tiered pricing, FEFO lot allocation, sales-order lifecycle, reliability, catalog export."""
from __future__ import annotations

import json
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from . import db


class ErpError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail


def d(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def q2(x) -> Decimal:
    return d(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ pricing / stock
def tier_price(c, item_id: int, qty: int) -> Decimal:
    r = db.one("SELECT unit_price FROM item_prices WHERE item_id=:i AND min_qty <= :q ORDER BY min_qty DESC LIMIT 1", c, i=item_id, q=max(qty, 1))
    return d(r["unit_price"]) if r else Decimal("0")


def list_price(c, item_id: int) -> Decimal:
    r = db.one("SELECT unit_price FROM item_prices WHERE item_id=:i ORDER BY min_qty ASC LIMIT 1", c, i=item_id)
    return d(r["unit_price"]) if r else Decimal("0")


def available(c, item_id: int) -> int:
    v = db.scalar("SELECT COALESCE(SUM(qty_on_hand - qty_reserved),0) FROM stock_lots WHERE item_id=:i AND (expiry_date IS NULL OR expiry_date > current_date)", c, i=item_id)
    return int(v or 0)


def reliability(c, company_id: int) -> float:
    r = db.one("SELECT count(*) FILTER (WHERE on_time) AS ok, count(*) AS n FROM delivery_history WHERE company_id=:c AND at > now() - interval '90 days'", c, c=company_id)
    ok, n = (r["ok"] or 0, r["n"] or 0) if r else (0, 0)
    return round((ok + 2) / (n + 3), 3)   # Laplace-smoothed on-time delivery rate


def mark_dirty(c, company_id: int) -> None:
    db.execute("INSERT INTO settings(key, value) VALUES (:k,'1') ON CONFLICT (key) DO UPDATE SET value='1'", c, k=f"dirty:{company_id}")


def get_setting(key: str, default: str = "") -> str:
    r = db.one("SELECT value FROM settings WHERE key=:k", k=key)
    return r["value"] if r else default


def set_setting(key: str, value: str) -> None:
    db.execute("INSERT INTO settings(key, value) VALUES (:k,:v) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", k=key, v=value)


# ------------------------------------------------------------------ events to CARPIP (transactional outbox)
def emit(c, company_id: int, etype: str, body: dict) -> None:
    co = db.one("SELECT mode, carpip_base_url, carpip_tenant_public_id FROM companies WHERE id=:i", c, i=company_id)
    if not co or co["mode"] != "PATH_B" or not co["carpip_base_url"]:
        return   # Zoho-mode companies are polled by CARPIP; nothing is pushed
    payload = {"type": etype, **body}
    db.execute("INSERT INTO outbox_events(company_id, type, event_id, body) VALUES (:c,:t,:e,:b)", c, c=company_id, t=etype, e=str(uuid.uuid4()), b=json.dumps(payload, default=str))


# ------------------------------------------------------------------ catalog export
def catalog(c, company_id: int) -> list[dict]:
    rel = reliability(c, company_id)
    out = []
    for it in db.rows("SELECT * FROM items WHERE company_id=:c AND active ORDER BY name", c, c=company_id):
        tiers = db.rows("SELECT min_qty, unit_price FROM item_prices WHERE item_id=:i ORDER BY min_qty", c, i=it["id"])
        base = next((t for t in tiers if t["min_qty"] <= 1), tiers[0] if tiers else None)
        if not base:
            continue
        exp = db.scalar("SELECT MIN(expiry_date) FROM stock_lots WHERE item_id=:i AND qty_on_hand - qty_reserved > 0 AND (expiry_date IS NULL OR expiry_date > current_date)", c, i=it["id"])
        out.append({
            "supplierSku": it["sku"], "gtin": it["gtin"], "name": it["name"], "category": it["category"], "uom": it["uom"], "packSize": it["pack_size"],
            "moq": it["moq"], "listPrice": str(base["unit_price"]),
            "priceTiers": [{"minQty": t["min_qty"], "unitPrice": str(t["unit_price"])} for t in tiers if t["min_qty"] > 1],
            "availableQty": available(c, it["id"]), "leadTimeDays": it["lead_time_days"], "shippingReliability": rel,
            "nearestExpiry": exp.isoformat() if exp else None, "shelfLifeDays": it["shelf_life_days"], "maxDiscountPct": str(it["max_discount_pct"]),
        })
    return out


# ------------------------------------------------------------------ sales orders
def _resolve_item(c, company_id: int, line: dict) -> dict:
    it = None
    if line.get("sku"):
        it = db.one("SELECT * FROM items WHERE company_id=:c AND sku=:s", c, c=company_id, s=line["sku"])
    if not it and line.get("gtin"):
        it = db.one("SELECT * FROM items WHERE company_id=:c AND gtin=:g", c, c=company_id, g=line["gtin"])
    if not it or not it["active"]:
        raise ErpError(422, "UNKNOWN_ITEM", f"item not in catalog: sku={line.get('sku')} gtin={line.get('gtin')}")
    return it


def create_sales_order(company: dict, customer_name: str, customer_tenant: str | None, po_number: str, lines: list[dict], source: str = "CARPIP",
                       quote_ref: str | None = None) -> tuple[int, bool]:
    """Idempotent on (company, po_number): a retry returns the existing order (created=False)."""
    if not po_number or not lines:
        raise ErpError(422, "INVALID_ORDER", "po_number and at least one line are required")
    with db.tx() as c:
        existing = db.one("SELECT id FROM sales_orders WHERE company_id=:c AND po_number=:p", c, c=company["id"], p=po_number)
        if existing:
            return existing["id"], False
        cust = db.one("SELECT id FROM customers WHERE company_id=:c AND name=:n", c, c=company["id"], n=customer_name)
        if not cust:
            db.execute("INSERT INTO customers(company_id, name, carpip_tenant_public_id) VALUES (:c,:n,:t) ON CONFLICT DO NOTHING", c, c=company["id"], n=customer_name, t=customer_tenant)
            cust = db.one("SELECT id FROM customers WHERE company_id=:c AND name=:n", c, c=company["id"], n=customer_name)
        resolved = []
        for ln in lines:
            qty = int(ln.get("quantity", 0))
            price = d(ln.get("unitPrice", ln.get("rate", 0)))
            if qty <= 0 or price <= 0:
                raise ErpError(422, "INVALID_LINE", "quantity and unit price must be positive")
            resolved.append((_resolve_item(c, company["id"], ln), qty, q2(price)))
        lead = max(it["lead_time_days"] for it, _, _ in resolved)
        so = db.one("INSERT INTO sales_orders(company_id, customer_id, po_number, status, promised_eta, source, quote_ref) VALUES (:c,:cu,:p,'RECEIVED',:eta,:s,:q) RETURNING id",
                    c, c=company["id"], cu=cust["id"], p=po_number, eta=date.today() + timedelta(days=lead), s=source, q=quote_ref)
        for it, qty, price in resolved:
            db.execute("INSERT INTO sales_order_lines(sales_order_id, item_id, sku, gtin, name, qty_ordered, unit_price) VALUES (:so,:i,:s,:g,:n,:q,:p)",
                       c, so=so["id"], i=it["id"], s=it["sku"], g=it["gtin"], n=it["name"], q=qty, p=price)
    return so["id"], True


def _lines(c, so_id: int) -> list[dict]:
    return db.rows("SELECT l.*, i.pack_size, i.moq, i.max_discount_pct FROM sales_order_lines l JOIN items i ON i.id=l.item_id WHERE l.sales_order_id=:s ORDER BY l.id", c, s=so_id)


def _so(c, company_id: int, so_id: int, lock: bool = True) -> dict:
    so = db.one(f"SELECT * FROM sales_orders WHERE id=:i AND company_id=:c {'FOR UPDATE' if lock else ''}", c, i=so_id, c=company_id)
    if not so:
        raise ErpError(404, "NOT_FOUND", "sales order not found")
    return so


def _po_lines_payload(lines: list[dict], key: str, field: str) -> list[dict]:
    return [{"gtin": l["gtin"], "sku": l["sku"], key: l[field]} for l in lines]


def _release(c, line: dict) -> None:
    """Release the un-shipped part of every allocation of this line."""
    for a in db.rows("SELECT id, lot_id, qty, shipped FROM allocations WHERE line_id=:l", c, l=line["id"]):
        rem = a["qty"] - a["shipped"]
        if rem > 0:
            db.execute("UPDATE stock_lots SET qty_reserved = qty_reserved - :r WHERE id=:i", c, r=rem, i=a["lot_id"])
            db.execute("UPDATE allocations SET qty = shipped WHERE id=:i", c, i=a["id"])


def confirm_sales_order(company: dict, so_id: int, wanted: dict[int, int] | None = None, actor: str = "system") -> dict:
    """FEFO-reserves stock. Rejects the order if the agreed price is below the supplier's current floor policy or nothing can be supplied."""
    with db.tx() as c:
        so = _so(c, company["id"], so_id)
        if so["status"] != "RECEIVED":
            raise ErpError(409, "INVALID_STATE", f"order is {so['status']}, only RECEIVED orders can be confirmed")
        lines = _lines(c, so_id)
        partial_pct = int(get_setting("partial_pct", "0") or 0)
        # price policy: agreed price must not be below the CURRENT floor (list tier price * (1 - max discount))
        for l in lines:
            floor = q2(tier_price(c, l["item_id"], l["qty_ordered"]) * (1 - d(l["max_discount_pct"])))
            if d(l["unit_price"]) + Decimal("0.005") < floor:
                return _reject_locked(c, company, so, lines, f"PRICE_EXPIRED: agreed {l['unit_price']} is below current floor {floor} for {l['sku']}", "rejected")
        total_conf = 0
        changed_items = []
        for l in lines:
            want = l["qty_ordered"] if wanted is None or l["id"] not in wanted else int(wanted[l["id"]])
            if wanted is None and partial_pct > 0:
                want = int(l["qty_ordered"] * partial_pct / 100)
            want = max(0, min(want, l["qty_ordered"]))
            pack = max(l["pack_size"], 1)
            avail = available(c, l["item_id"])
            give = min(want, avail)
            give = (give // pack) * pack if pack > 1 else give
            if give < max(l["moq"], 1) and give < l["qty_ordered"]:
                give = 0 if give < l["moq"] else give
            if give <= 0:
                continue
            remaining = give
            for lot in db.rows("SELECT id, qty_on_hand, qty_reserved FROM stock_lots WHERE item_id=:i AND (expiry_date IS NULL OR expiry_date > current_date) "
                               "AND qty_on_hand - qty_reserved > 0 ORDER BY expiry_date NULLS LAST, id FOR UPDATE", c, i=l["item_id"]):
                take = min(remaining, lot["qty_on_hand"] - lot["qty_reserved"])
                if take <= 0:
                    continue
                db.execute("UPDATE stock_lots SET qty_reserved = qty_reserved + :t WHERE id=:i", c, t=take, i=lot["id"])
                db.execute("INSERT INTO allocations(line_id, lot_id, qty) VALUES (:l,:lot,:q)", c, l=l["id"], lot=lot["id"], q=take)
                remaining -= take
                if remaining <= 0:
                    break
            db.execute("UPDATE sales_order_lines SET qty_confirmed=:q WHERE id=:i", c, q=give, i=l["id"])
            l["qty_confirmed"] = give
            total_conf += give
            changed_items.append(l["item_id"])
        if total_conf <= 0:
            return _reject_locked(c, company, so, lines, "INSUFFICIENT_STOCK: nothing could be allocated", "rejected")
        full = all(l["qty_confirmed"] >= l["qty_ordered"] for l in lines)
        status = "CONFIRMED" if full else "PARTIALLY_CONFIRMED"
        db.execute("UPDATE sales_orders SET status=:s, updated_at=now() WHERE id=:i", c, s=status, i=so_id)
        emit(c, company["id"], "sales_order.confirmed", {"po_number": so["po_number"], "eta": so["promised_eta"].isoformat() if so["promised_eta"] else None,
                                                         "lines": _po_lines_payload(lines, "confirmed_qty", "qty_confirmed")})
        _emit_stock(c, company["id"], changed_items)
        mark_dirty(c, company["id"])
        db.execute("INSERT INTO integration_log(company_id, direction, method, path, status, note) VALUES (:c,'INTERNAL','CONFIRM',:p,200,:n)", c, c=company["id"], p=so["po_number"], n=f"{status} by {actor}")
    return {"po_number": so["po_number"], "status": status}


def _emit_stock(c, company_id: int, item_ids: list[int]) -> None:
    ids = sorted(set(item_ids))
    if not ids:
        return
    items = []
    for i in ids:
        it = db.one("SELECT sku FROM items WHERE id=:i", c, i=i)
        items.append({"supplierSku": it["sku"], "availableQty": available(c, i)})
    emit(c, company_id, "stock.changed", {"items": items})


def _reject_locked(c, company: dict, so: dict, lines: list[dict], reason: str, kind: str) -> dict:
    was_received = so["status"] == "RECEIVED"
    for l in lines:
        _release(c, l)
    status = "REJECTED" if was_received else "CANCELLED"
    db.execute("UPDATE sales_orders SET status=:s, reject_reason=:r, updated_at=now() WHERE id=:i", c, s=status, r=reason, i=so["id"])
    emit(c, company["id"], "sales_order.rejected" if was_received else "sales_order.cancelled", {"po_number": so["po_number"], "reason": reason})
    _emit_stock(c, company["id"], [l["item_id"] for l in lines])
    mark_dirty(c, company["id"])
    return {"po_number": so["po_number"], "status": status, "reason": reason}


def reject_sales_order(company: dict, so_id: int, reason: str, actor: str = "user") -> dict:
    if not reason:
        raise ErpError(422, "REASON_REQUIRED", "a reason is required")
    with db.tx() as c:
        so = _so(c, company["id"], so_id)
        if so["status"] not in ("RECEIVED", "CONFIRMED", "PARTIALLY_CONFIRMED"):
            raise ErpError(409, "INVALID_STATE", f"order is {so['status']}; goods already shipped cannot be rejected")
        out = _reject_locked(c, company, so, _lines(c, so_id), f"{reason} (by {actor})", "rejected")
    return out


def ship_sales_order(company: dict, so_id: int, parts: dict[int, int] | None, carrier: str | None, tracking: str | None, eta_days: int | None) -> dict:
    with db.tx() as c:
        so = _so(c, company["id"], so_id)
        if so["status"] not in ("CONFIRMED", "PARTIALLY_CONFIRMED", "PARTIALLY_SHIPPED"):
            raise ErpError(409, "INVALID_STATE", f"order is {so['status']}; only confirmed orders can be shipped")
        lines = _lines(c, so_id)
        todo = []
        for l in lines:
            remaining = l["qty_confirmed"] - l["qty_shipped"]
            qty = remaining if parts is None else int(parts.get(l["id"], 0))
            if qty < 0 or qty > remaining:
                raise ErpError(422, "INVALID_QUANTITY", f"line {l['sku']}: can ship at most {remaining}")
            if qty > 0:
                todo.append((l, qty))
        if not todo:
            raise ErpError(422, "NOTHING_TO_SHIP", "no shippable quantity")
        n = db.scalar("SELECT count(*) FROM shipments WHERE sales_order_id=:s", c, s=so_id) + 1
        eta = date.today() + timedelta(days=eta_days if eta_days is not None else 2)
        sh = db.one("INSERT INTO shipments(sales_order_id, shipment_no, carrier, tracking, eta) VALUES (:s,:n,:ca,:t,:e) RETURNING id", c,
                    s=so_id, n=f"{so['po_number']}-S{n}", ca=carrier, t=tracking or f"TRK{uuid.uuid4().hex[:10].upper()}", e=eta)
        shipped_lines = []
        for l, qty in todo:
            left = qty
            for a in db.rows("SELECT a.id, a.lot_id, a.qty, a.shipped FROM allocations a WHERE a.line_id=:l AND a.shipped < a.qty ORDER BY a.id FOR UPDATE", c, l=l["id"]):
                take = min(left, a["qty"] - a["shipped"])
                db.execute("UPDATE allocations SET shipped = shipped + :t WHERE id=:i", c, t=take, i=a["id"])
                db.execute("UPDATE stock_lots SET qty_on_hand = qty_on_hand - :t, qty_reserved = qty_reserved - :t WHERE id=:i", c, t=take, i=a["lot_id"])
                left -= take
                if left <= 0:
                    break
            db.execute("UPDATE sales_order_lines SET qty_shipped = qty_shipped + :q WHERE id=:i", c, q=qty, i=l["id"])
            db.execute("INSERT INTO shipment_lines(shipment_id, line_id, qty) VALUES (:s,:l,:q)", c, s=sh["id"], l=l["id"], q=qty)
            shipped_lines.append({"gtin": l["gtin"], "sku": l["sku"], "shipped_qty": qty})
        after = _lines(c, so_id)
        status = "SHIPPED" if all(l["qty_shipped"] >= l["qty_confirmed"] for l in after) else "PARTIALLY_SHIPPED"
        db.execute("UPDATE sales_orders SET status=:s, promised_eta=:e, updated_at=now() WHERE id=:i", c, s=status, e=eta, i=so_id)
        tracking_no = db.scalar("SELECT tracking FROM shipments WHERE id=:i", c, i=sh["id"])
        emit(c, company["id"], "shipment.created", {"po_number": so["po_number"], "eta": eta.isoformat(), "tracking": tracking_no, "lines": shipped_lines})
    return {"po_number": so["po_number"], "status": status, "shipment": f"{so['po_number']}-S{n}"}


def deliver_sales_order(company: dict, so_id: int, late_days: int = 0) -> dict:
    with db.tx() as c:
        so = _so(c, company["id"], so_id)
        if so["status"] not in ("SHIPPED", "PARTIALLY_SHIPPED"):
            raise ErpError(409, "INVALID_STATE", f"order is {so['status']}; only shipped orders can be delivered")
        lines = _lines(c, so_id)
        for l in lines:
            db.execute("UPDATE sales_order_lines SET qty_delivered = qty_shipped WHERE id=:i", c, i=l["id"])
            l["qty_delivered"] = l["qty_shipped"]
            if l["qty_shipped"] < l["qty_confirmed"]:
                _release(c, l)      # the unshipped remainder will never arrive: free the reservation
        db.execute("UPDATE shipments SET delivered_at=now() WHERE sales_order_id=:s AND delivered_at IS NULL", c, s=so_id)
        db.execute("UPDATE sales_orders SET status='DELIVERED', updated_at=now() WHERE id=:i", c, i=so_id)
        delivered_on = date.today() + timedelta(days=late_days)
        promised = so["promised_eta"] or date.today()
        db.execute("INSERT INTO delivery_history(company_id, sales_order_id, promised, delivered, on_time) VALUES (:c,:s,:p,:d,:ok)", c, c=company["id"], s=so_id, p=promised, d=delivered_on, ok=delivered_on <= promised)
        emit(c, company["id"], "sales_order.delivered", {"po_number": so["po_number"], "lines": _po_lines_payload(lines, "delivered_qty", "qty_delivered")})
        _emit_stock(c, company["id"], [l["item_id"] for l in lines])
        mark_dirty(c, company["id"])
    return {"po_number": so["po_number"], "status": "DELIVERED"}


def cancel_by_carpip(company: dict, po_number: str, reason: str = "cancelled by buyer") -> dict:
    with db.tx() as c:
        so = db.one("SELECT * FROM sales_orders WHERE company_id=:c AND po_number=:p FOR UPDATE", c, c=company["id"], p=po_number)
        if not so:
            raise ErpError(404, "NOT_FOUND", "unknown purchase order")
        if so["status"] in ("CANCELLED", "REJECTED"):
            return {"po_number": po_number, "status": so["status"]}
        if so["status"] not in ("RECEIVED", "CONFIRMED", "PARTIALLY_CONFIRMED"):
            raise ErpError(409, "ALREADY_SHIPPED", f"order is {so['status']}; goods are on their way and cannot be cancelled")
        lines = _lines(c, so["id"])
        for l in lines:
            _release(c, l)
        db.execute("UPDATE sales_orders SET status='CANCELLED', reject_reason=:r, updated_at=now() WHERE id=:i", c, r=reason, i=so["id"])
        # no outbound event: the buyer initiated this cancellation
        mark_dirty(c, company["id"])
    return {"po_number": po_number, "status": "CANCELLED"}


# ------------------------------------------------------------------ stock / price maintenance
def receive_lot(company: dict, item_id: int, qty: int, expiry: date | None, lot_no: str | None, warehouse_id: int | None = None) -> dict:
    if qty <= 0:
        raise ErpError(422, "INVALID_QUANTITY", "quantity must be positive")
    with db.tx() as c:
        it = db.one("SELECT * FROM items WHERE id=:i AND company_id=:c", c, i=item_id, c=company["id"])
        if not it:
            raise ErpError(404, "NOT_FOUND", "item not found")
        wh = warehouse_id or db.scalar("SELECT id FROM warehouses WHERE company_id=:c ORDER BY id LIMIT 1", c, c=company["id"])
        db.execute("INSERT INTO stock_lots(item_id, warehouse_id, lot_no, qty_on_hand, expiry_date) VALUES (:i,:w,:l,:q,:e)", c, i=item_id, w=wh, l=lot_no or f"L{uuid.uuid4().hex[:6].upper()}", q=qty, e=expiry)
        _emit_stock(c, company["id"], [item_id])
        mark_dirty(c, company["id"])
    return {"sku": it["sku"], "available": available(None, item_id)}


def set_prices(company: dict, item_id: int, tiers: list[dict]) -> None:
    if not tiers or not any(int(t["minQty"]) <= 1 for t in tiers):
        raise ErpError(422, "INVALID_TIERS", "a list price tier with minQty 1 is required")
    with db.tx() as c:
        it = db.one("SELECT sku FROM items WHERE id=:i AND company_id=:c", c, i=item_id, c=company["id"])
        if not it:
            raise ErpError(404, "NOT_FOUND", "item not found")
        db.execute("DELETE FROM item_prices WHERE item_id=:i", c, i=item_id)
        for t in tiers:
            if d(t["unitPrice"]) <= 0:
                raise ErpError(422, "INVALID_PRICE", "prices must be positive")
            db.execute("INSERT INTO item_prices(item_id, min_qty, unit_price) VALUES (:i,:m,:p)", c, i=item_id, m=max(int(t["minQty"]), 1), p=q2(t["unitPrice"]))
        base = list_price(c, item_id)
        emit(c, company["id"], "price_list.updated", {"items": [{"supplierSku": it["sku"], "listPrice": str(base),
             "priceTiers": [{"minQty": t["minQty"], "unitPrice": str(q2(t["unitPrice"]))} for t in tiers if int(t["minQty"]) > 1]}]})
        mark_dirty(c, company["id"])


def sales_order_view(c, company_id: int, so_id: int) -> dict:
    so = db.one("SELECT s.*, cu.name AS customer FROM sales_orders s JOIN customers cu ON cu.id = s.customer_id WHERE s.id=:i AND s.company_id=:c", c, i=so_id, c=company_id)
    if not so:
        raise ErpError(404, "NOT_FOUND", "sales order not found")
    lines = db.rows("""SELECT l.*, i.pack_size, i.moq, i.max_discount_pct FROM sales_order_lines l JOIN items i ON i.id=l.item_id WHERE l.sales_order_id=:s ORDER BY l.id""", c, s=so_id)
    for l in lines:
        floor = q2(tier_price(c, l["item_id"], l["qty_ordered"]) * (1 - d(l["max_discount_pct"])))
        l["current_floor"] = str(floor)
        l["available_now"] = available(c, l["item_id"])
        l["price_ok"] = d(l["unit_price"]) + Decimal("0.005") >= floor
        l["allocations"] = db.rows("SELECT a.qty, a.shipped, sl.lot_no, sl.expiry_date FROM allocations a JOIN stock_lots sl ON sl.id=a.lot_id WHERE a.line_id=:l ORDER BY sl.expiry_date NULLS LAST", c, l=l["id"])
    so["lines"] = lines
    so["total"] = str(sum(d(l["unit_price"]) * l["qty_ordered"] for l in lines))
    so["shipments"] = db.rows("SELECT id, shipment_no, carrier, tracking, eta, shipped_at, delivered_at FROM shipments WHERE sales_order_id=:s ORDER BY id", c, s=so_id)
    return so


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def pack_multiple(n: int, pack: int) -> int:
    return int(math.floor(n / pack) * pack) if pack > 1 else n
