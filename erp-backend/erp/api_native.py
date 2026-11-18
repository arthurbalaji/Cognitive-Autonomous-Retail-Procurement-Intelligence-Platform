"""ERP native API used by the web UI (company manager login)."""
from __future__ import annotations

from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import db, domain, workers
from .security import current_user, password_hash, sign_token

router = APIRouter(prefix="/erp/api")


def company_of(user: dict = Depends(current_user)) -> dict:
    co = db.one("SELECT * FROM companies WHERE id=:i", i=user["company_id"])
    if not co:
        raise HTTPException(401, {"code": "UNAUTHORIZED", "detail": "company no longer exists"})
    return co


class Login(BaseModel):
    email: str
    password: str


@router.get("/companies")
def companies():
    return db.rows("SELECT code, name, mode FROM companies ORDER BY id")


@router.post("/auth/login")
def login(req: Login):
    u = db.one("SELECT u.*, c.name AS company_name, c.code, c.mode FROM users u JOIN companies c ON c.id=u.company_id WHERE u.email=:e", e=req.email.lower())
    if not u or u["password_hash"] != password_hash(req.email, req.password):
        raise HTTPException(401, {"code": "INVALID_CREDENTIALS", "detail": "invalid email or password"})
    return {"token": sign_token({"uid": u["id"], "company_id": u["company_id"], "name": u["name"]}),
            "user": {"name": u["name"], "email": u["email"], "company": u["company_name"], "code": u["code"], "mode": u["mode"]}}


@router.get("/me")
def me(co: dict = Depends(company_of), user: dict = Depends(current_user)):
    return {"name": user["name"], "company": {k: co[k] for k in ("code", "name", "mode", "auto_confirm", "auto_progress", "carpip_tenant_public_id")},
            "connected": bool(co["carpip_base_url"] or co["mode"] == "ZOHO"), "reliability": domain.reliability(None, co["id"])}


@router.get("/dashboard")
def dashboard(co: dict = Depends(company_of)):
    cid = co["id"]
    by = db.rows("SELECT status, count(*)::int AS n FROM sales_orders WHERE company_id=:c GROUP BY status ORDER BY status", c=cid)
    k = db.one("""SELECT (SELECT count(*) FROM items WHERE company_id=:c AND active)::int AS items,
                         (SELECT COALESCE(SUM(l.qty_ordered * l.unit_price),0) FROM sales_order_lines l JOIN sales_orders s ON s.id=l.sales_order_id
                           WHERE s.company_id=:c AND s.status IN ('DELIVERED'))::text AS delivered_value,
                         (SELECT count(*) FROM sales_orders WHERE company_id=:c AND status='RECEIVED')::int AS awaiting_confirmation,
                         (SELECT count(*) FROM outbox_events WHERE company_id=:c AND status='PENDING')::int AS outbox_pending""", c=cid)
    low = db.rows("""SELECT i.sku, i.name, COALESCE(SUM(l.qty_on_hand - l.qty_reserved),0)::int AS available, i.moq FROM items i LEFT JOIN stock_lots l ON l.item_id=i.id
                     WHERE i.company_id=:c AND i.active GROUP BY i.id ORDER BY 3 ASC LIMIT 6""", c=cid)
    return {"orders": by, "kpis": k, "lowStock": low, "reliability": domain.reliability(None, cid)}


@router.get("/sales-orders")
def list_orders(status: str | None = None, co: dict = Depends(company_of)):
    sql = """SELECT s.id, s.po_number, s.status, s.promised_eta, s.reject_reason, s.created_at, s.updated_at, cu.name AS customer,
                    (SELECT COALESCE(SUM(qty_ordered * unit_price),0) FROM sales_order_lines WHERE sales_order_id=s.id)::text AS total,
                    (SELECT string_agg(name || ' x' || qty_ordered, ', ') FROM sales_order_lines WHERE sales_order_id=s.id) AS summary
             FROM sales_orders s JOIN customers cu ON cu.id=s.customer_id WHERE s.company_id=:c"""
    params: dict = {"c": co["id"]}
    if status:
        sql += " AND s.status = ANY(string_to_array(:st, ','))"
        params["st"] = status
    return db.rows(sql + " ORDER BY s.id DESC LIMIT 200", **params)


@router.get("/sales-orders/{so_id}")
def order_detail(so_id: int, co: dict = Depends(company_of)):
    with db.engine.connect() as c:
        return domain.sales_order_view(c, co["id"], so_id)


class ConfirmReq(BaseModel):
    lines: dict[int, int] | None = None


class RejectReq(BaseModel):
    reason: str


class ShipReq(BaseModel):
    lines: dict[int, int] | None = None
    carrier: str | None = "Blue Dart"
    tracking: str | None = None
    etaDays: int | None = 2


class DeliverReq(BaseModel):
    lateDays: int = 0


@router.post("/sales-orders/{so_id}/confirm")
def confirm(so_id: int, req: ConfirmReq | None = None, co: dict = Depends(company_of), user: dict = Depends(current_user)):
    return domain.confirm_sales_order(co, so_id, req.lines if req else None, user["name"])


@router.post("/sales-orders/{so_id}/reject")
def reject(so_id: int, req: RejectReq, co: dict = Depends(company_of), user: dict = Depends(current_user)):
    return domain.reject_sales_order(co, so_id, req.reason, user["name"])


@router.post("/sales-orders/{so_id}/ship")
def ship(so_id: int, req: ShipReq | None = None, co: dict = Depends(company_of)):
    r = req or ShipReq()
    return domain.ship_sales_order(co, so_id, r.lines, r.carrier, r.tracking, r.etaDays)


@router.post("/sales-orders/{so_id}/deliver")
def deliver(so_id: int, req: DeliverReq | None = None, co: dict = Depends(company_of)):
    return domain.deliver_sales_order(co, so_id, req.lateDays if req else 0)


@router.get("/items")
def items(q: str | None = None, co: dict = Depends(company_of)):
    rows = db.rows("""SELECT i.id, i.sku, i.gtin, i.name, i.category, i.pack_size, i.moq, i.lead_time_days, i.max_discount_pct::text AS max_discount_pct, i.shelf_life_days, i.active,
                             COALESCE((SELECT SUM(qty_on_hand) FROM stock_lots WHERE item_id=i.id),0)::int AS on_hand,
                             COALESCE((SELECT SUM(qty_reserved) FROM stock_lots WHERE item_id=i.id),0)::int AS reserved,
                             (SELECT unit_price::text FROM item_prices WHERE item_id=i.id ORDER BY min_qty LIMIT 1) AS list_price,
                             (SELECT MIN(expiry_date) FROM stock_lots WHERE item_id=i.id AND qty_on_hand > 0) AS nearest_expiry
                      FROM items i WHERE i.company_id=:c AND (:q IS NULL OR lower(i.name) LIKE :ql OR i.sku = :q OR i.gtin = :q) ORDER BY i.name LIMIT 300""",
                   c=co["id"], q=q, ql=f"%{(q or '').lower()}%")
    return rows


@router.get("/items/{item_id}")
def item(item_id: int, co: dict = Depends(company_of)):
    it = db.one("SELECT * FROM items WHERE id=:i AND company_id=:c", i=item_id, c=co["id"])
    if not it:
        raise HTTPException(404, {"code": "NOT_FOUND", "detail": "item not found"})
    it["tiers"] = db.rows("SELECT min_qty, unit_price::text AS unit_price FROM item_prices WHERE item_id=:i ORDER BY min_qty", i=item_id)
    it["lots"] = db.rows("SELECT id, lot_no, qty_on_hand, qty_reserved, expiry_date, received_at FROM stock_lots WHERE item_id=:i ORDER BY expiry_date NULLS LAST, id", i=item_id)
    it["max_discount_pct"] = str(it["max_discount_pct"])
    return it


class Tiers(BaseModel):
    tiers: list[dict]


class ItemPatch(BaseModel):
    moq: int | None = None
    packSize: int | None = None
    leadTimeDays: int | None = None
    maxDiscountPct: float | None = None
    active: bool | None = None


class LotReq(BaseModel):
    qty: int
    expiryDays: int | None = None
    lotNo: str | None = None


@router.put("/items/{item_id}/prices")
def prices(item_id: int, req: Tiers, co: dict = Depends(company_of)):
    domain.set_prices(co, item_id, req.tiers)
    return {"status": "ok"}


@router.patch("/items/{item_id}")
def patch_item(item_id: int, req: ItemPatch, co: dict = Depends(company_of)):
    if req.moq is not None and req.moq < 1 or req.packSize is not None and req.packSize < 1 or req.leadTimeDays is not None and req.leadTimeDays < 0:
        raise HTTPException(422, {"code": "INVALID_VALUE", "detail": "moq/packSize must be >= 1 and leadTimeDays >= 0"})
    if req.maxDiscountPct is not None and not (0 <= req.maxDiscountPct <= 0.5):
        raise HTTPException(422, {"code": "INVALID_VALUE", "detail": "maxDiscountPct must be within 0..0.5"})
    n = db.execute("""UPDATE items SET moq=COALESCE(:m,moq), pack_size=COALESCE(:p,pack_size), lead_time_days=COALESCE(:l,lead_time_days),
                      max_discount_pct=COALESCE(:d,max_discount_pct), active=COALESCE(:a,active) WHERE id=:i AND company_id=:c""",
                   m=req.moq, p=req.packSize, l=req.leadTimeDays, d=req.maxDiscountPct, a=req.active, i=item_id, c=co["id"])
    if not n:
        raise HTTPException(404, {"code": "NOT_FOUND", "detail": "item not found"})
    with db.tx() as c:
        domain.mark_dirty(c, co["id"])
    return {"status": "ok"}


@router.post("/items/{item_id}/lots")
def add_lot(item_id: int, req: LotReq, co: dict = Depends(company_of)):
    exp = date.today() + timedelta(days=req.expiryDays) if req.expiryDays else None
    return domain.receive_lot(co, item_id, req.qty, exp, req.lotNo)


class NewItem(BaseModel):
    sku: str
    name: str
    gtin: str | None = None
    category: str | None = None
    uom: str | None = "EA"
    packSize: int = 1
    moq: int = 1
    leadTimeDays: int = 3
    shelfLifeDays: int | None = None
    maxDiscountPct: float = 0.2
    listPrice: str
    tiers: list[dict] | None = None
    openingQty: int = 0
    openingExpiryDays: int | None = None


@router.post("/items", status_code=201)
def create_item(req: NewItem, co: dict = Depends(company_of), user: dict = Depends(current_user)):
    return domain.create_item(co, req.model_dump(), user["name"])


class BillLine(BaseModel):
    itemId: int
    qty: int
    unitCost: str
    lotNo: str | None = None
    expiryDate: str | None = None


class NewBill(BaseModel):
    vendor: str
    billNo: str
    billDate: date | None = None
    lines: list[BillLine]


@router.get("/purchases")
def purchases(co: dict = Depends(company_of)):
    return domain.list_purchase_bills(co["id"])


@router.post("/purchases", status_code=201)
def create_purchase(req: NewBill, co: dict = Depends(company_of), user: dict = Depends(current_user)):
    return domain.create_purchase_bill(co, req.vendor, req.billNo, req.billDate, [ln.model_dump() for ln in req.lines], user["name"])


class Flags(BaseModel):
    autoConfirm: bool | None = None
    autoProgress: bool | None = None


@router.patch("/company/settings")
def settings(req: Flags, co: dict = Depends(company_of)):
    db.execute("UPDATE companies SET auto_confirm=COALESCE(:a,auto_confirm), auto_progress=COALESCE(:p,auto_progress) WHERE id=:i", a=req.autoConfirm, p=req.autoProgress, i=co["id"])
    return {"status": "ok"}


@router.get("/integration-log")
def integration_log(co: dict = Depends(company_of)):
    return {
        "log": db.rows("SELECT direction, method, path, status, note, at FROM integration_log WHERE company_id=:c ORDER BY id DESC LIMIT 80", c=co["id"]),
        "outbox": db.rows("SELECT id, type, status, attempts, last_status, last_error, created_at, sent_at FROM outbox_events WHERE company_id=:c ORDER BY id DESC LIMIT 60", c=co["id"]),
    }


@router.post("/outbox/{event_id}/retry")
def retry_event(event_id: int, co: dict = Depends(company_of)):
    n = db.execute("UPDATE outbox_events SET status='PENDING', attempts=0, next_attempt_at=now() WHERE id=:i AND company_id=:c AND status='FAILED'", i=event_id, c=co["id"])
    return {"requeued": n}


@router.post("/catalog/push")
def push_now(co: dict = Depends(company_of)):
    return workers.push_catalog(co["id"])


QUERY = """query { reorderSignals(horizonDays: 14) { gtin name retailersTracking retailersBelowRop unitsSold7d forecastUnits14d avgMpi shortfallUnits } }"""


@router.get("/demand-insights")
def demand_insights(co: dict = Depends(company_of)):
    """Server-side proxy to CARPIP's GraphQL engine using this wholesaler's API key (Path B: GraphQL)."""
    if not co["carpip_api_key"]:
        return {"connected": False, "signals": []}
    from . import config

    try:
        r = httpx.post(config.CARPIP_GRAPHQL_URL, json={"query": QUERY}, headers={"Authorization": f"Bearer {co['carpip_api_key']}"}, timeout=15.0)
        j = r.json()
        if "errors" in j:
            return {"connected": True, "error": j["errors"][0].get("message"), "signals": []}
        return {"connected": True, "signals": j["data"]["reorderSignals"]}
    except Exception as e:  # noqa: BLE001
        return {"connected": False, "error": str(e)[:200], "signals": []}
