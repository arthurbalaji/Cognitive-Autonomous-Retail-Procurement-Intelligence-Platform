"""Provisioning (bootstrap job) and demo scenarios. Protected by X-Admin-Token."""
from __future__ import annotations

import secrets
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import db, domain, workers
from .security import admin_only, password_hash

router = APIRouter(prefix="/erp", dependencies=[Depends(admin_only)])


def _co(code: str) -> dict:
    co = db.one("SELECT * FROM companies WHERE code=:c", c=code)
    if not co:
        raise HTTPException(404, {"code": "NOT_FOUND", "detail": f"unknown company {code}"})
    return co


class CompanyReq(BaseModel):
    code: str
    name: str
    mode: str
    carpipTenantPublicId: str | None = None
    carpipBaseUrl: str | None = None
    carpipApiKey: str | None = None
    carpipWebhookSecret: str | None = None
    autoConfirm: bool = True
    autoProgress: bool = False
    users: list[dict] = []


@router.post("/admin/companies")
def upsert_company(req: CompanyReq):
    if req.mode not in ("ZOHO", "PATH_B"):
        raise HTTPException(422, {"code": "BAD_REQUEST", "detail": "mode must be ZOHO or PATH_B"})
    ex = db.one("SELECT * FROM companies WHERE code=:c", c=req.code)
    if ex:
        db.execute("""UPDATE companies SET name=:n, mode=:m, carpip_tenant_public_id=COALESCE(:t, carpip_tenant_public_id), carpip_base_url=COALESCE(:b, carpip_base_url),
                      carpip_api_key=COALESCE(:k, carpip_api_key), carpip_webhook_secret=COALESCE(:s, carpip_webhook_secret), auto_confirm=:ac, auto_progress=:ap WHERE code=:c""",
                   n=req.name, m=req.mode, t=req.carpipTenantPublicId, b=req.carpipBaseUrl, k=req.carpipApiKey, s=req.carpipWebhookSecret, ac=req.autoConfirm, ap=req.autoProgress, c=req.code)
    else:
        zoho = req.mode == "ZOHO"
        db.execute("""INSERT INTO companies(code, name, mode, carpip_tenant_public_id, carpip_base_url, carpip_api_key, carpip_webhook_secret, zoho_org_id, oauth_client_id,
                      oauth_client_secret, oauth_refresh_token, auto_confirm, auto_progress) VALUES (:c,:n,:m,:t,:b,:k,:s,:zo,:ci,:cs,:rt,:ac,:ap)""",
                   c=req.code, n=req.name, m=req.mode, t=req.carpipTenantPublicId, b=req.carpipBaseUrl, k=req.carpipApiKey, s=req.carpipWebhookSecret,
                   zo=("60" + secrets.token_hex(5)) if zoho else None, ci=("1000." + secrets.token_hex(8).upper()) if zoho else None,
                   cs=secrets.token_hex(16) if zoho else None, rt=("1000." + secrets.token_hex(24)) if zoho else None, ac=req.autoConfirm, ap=req.autoProgress)
    co = _co(req.code)
    if not db.one("SELECT 1 AS x FROM warehouses WHERE company_id=:c", c=co["id"]):
        db.execute("INSERT INTO warehouses(company_id, name) VALUES (:c,:n)", c=co["id"], n=f"{req.name} - Main warehouse")
    for u in req.users:
        db.execute("""INSERT INTO users(company_id, email, password_hash, name) VALUES (:c,:e,:p,:n)
                      ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name""",
                   c=co["id"], e=u["email"].lower(), p=password_hash(u["email"], u["password"]), n=u.get("name", "Manager"))
    return {"code": co["code"], "mode": co["mode"], "zoho": {"orgId": co["zoho_org_id"], "clientId": co["oauth_client_id"], "clientSecret": co["oauth_client_secret"],
                                                           "refreshToken": co["oauth_refresh_token"]} if co["mode"] == "ZOHO" else None}


@router.get("/admin/companies")
def list_companies():
    return db.rows("SELECT code, name, mode, carpip_tenant_public_id, auto_confirm, auto_progress, zoho_org_id FROM companies ORDER BY id")


class CatalogReq(BaseModel):
    items: list[dict]
    deliveryHistory: dict | None = None


@router.post("/admin/companies/{code}/catalog")
def load_catalog(code: str, req: CatalogReq):
    co = _co(code)
    wh = db.scalar("SELECT id FROM warehouses WHERE company_id=:c ORDER BY id LIMIT 1", c=co["id"])
    created = updated = 0
    for it in req.items:
        ex = db.one("SELECT id FROM items WHERE company_id=:c AND sku=:s", c=co["id"], s=it["sku"])
        params = dict(c=co["id"], s=it["sku"], g=it.get("gtin"), n=it["name"], cat=it.get("category"), u=it.get("uom", "EA"), p=it.get("packSize", 1), m=it.get("moq", 1),
                      sl=it.get("shelfLifeDays"), l=it.get("leadTimeDays", 3), d=it.get("maxDiscountPct", 0.2))
        if ex:
            db.execute("UPDATE items SET gtin=:g, name=:n, category=:cat, uom=:u, pack_size=:p, moq=:m, shelf_life_days=:sl, lead_time_days=:l, max_discount_pct=:d WHERE id=:i", i=ex["id"], **params)
            item_id = ex["id"]
            updated += 1
        else:
            item_id = db.one("""INSERT INTO items(company_id, sku, gtin, name, category, uom, pack_size, moq, shelf_life_days, lead_time_days, max_discount_pct)
                                VALUES (:c,:s,:g,:n,:cat,:u,:p,:m,:sl,:l,:d) RETURNING id""", **params)["id"]
            created += 1
        tiers = it.get("tiers") or []
        if tiers:
            db.execute("DELETE FROM item_prices WHERE item_id=:i", i=item_id)
            for t in tiers:
                db.execute("INSERT INTO item_prices(item_id, min_qty, unit_price) VALUES (:i,:m,:p)", i=item_id, m=t["minQty"], p=t["unitPrice"])
        if not db.one("SELECT 1 AS x FROM stock_lots WHERE item_id=:i", i=item_id):     # lots are only seeded once (idempotent re-runs)
            for n, lot in enumerate(it.get("lots") or []):
                exp = date.today() + timedelta(days=lot["expiryDays"]) if lot.get("expiryDays") else None
                db.execute("INSERT INTO stock_lots(item_id, warehouse_id, lot_no, qty_on_hand, expiry_date) VALUES (:i,:w,:l,:q,:e)",
                           i=item_id, w=wh, l=f"{it['sku']}-L{n + 1}", q=lot["qty"], e=exp)
    h = req.deliveryHistory
    if h and not db.scalar("SELECT count(*) FROM delivery_history WHERE company_id=:c", c=co["id"]):
        total, ok = int(h["total"]), int(h["onTime"])
        for n in range(total):
            db.execute("INSERT INTO delivery_history(company_id, promised, delivered, on_time, at) VALUES (:c, current_date, current_date, :ok, now() - make_interval(days => :d))",
                       c=co["id"], ok=n < ok, d=n % 80)
    with db.tx() as c:
        domain.mark_dirty(c, co["id"])
    return {"created": created, "updated": updated}


@router.post("/admin/companies/{code}/sync-now")
def sync_now(code: str):
    co = _co(code)
    return workers.push_catalog(co["id"])


class FlagsReq(BaseModel):
    autoConfirm: bool | None = None
    autoProgress: bool | None = None


@router.patch("/admin/companies/{code}/flags")
def flags(code: str, req: FlagsReq):
    co = _co(code)
    db.execute("UPDATE companies SET auto_confirm=COALESCE(:a,auto_confirm), auto_progress=COALESCE(:p,auto_progress) WHERE id=:i", a=req.autoConfirm, p=req.autoProgress, i=co["id"])
    return {"status": "ok"}


# ------------------------------------------------------------------ demo scenarios
class StockoutReq(BaseModel):
    company: str | None = None
    sku: str | None = None


@router.post("/demo/stockout")
def stockout(req: StockoutReq):
    """Wipes available stock of one item (default: the most-ordered one of the given/first PATH_B company) and rejects pending orders for it."""
    cos = [_co(req.company)] if req.company else db.rows("SELECT * FROM companies ORDER BY id")
    out = []
    for co in cos:
        item = db.one("SELECT id, sku, name FROM items WHERE company_id=:c AND sku=:s", c=co["id"], s=req.sku) if req.sku else db.one(
            """SELECT i.id, i.sku, i.name FROM items i LEFT JOIN sales_order_lines l ON l.item_id=i.id WHERE i.company_id=:c AND i.active GROUP BY i.id ORDER BY count(l.id) DESC, i.id LIMIT 1""", c=co["id"])
        if not item:
            continue
        # 1) reject pending orders FIRST, each in its own transaction (they release their reservations);
        #    doing it inside a transaction that already locked the lots would self-deadlock
        for so in db.rows("""SELECT DISTINCT s.id FROM sales_orders s JOIN sales_order_lines l ON l.sales_order_id=s.id WHERE s.company_id=:c AND l.item_id=:i
                             AND s.status IN ('RECEIVED','CONFIRMED','PARTIALLY_CONFIRMED')""", c=co["id"], i=item["id"]):
            try:
                domain.reject_sales_order(co, so["id"], "OUT_OF_STOCK: supplier ran out of stock", "demo-stockout")
            except domain.ErpError:
                pass
        # 2) then wipe whatever is still sellable
        with db.tx() as c:
            db.execute("UPDATE stock_lots SET qty_on_hand = qty_reserved WHERE item_id=:i", c, i=item["id"])
            domain._emit_stock(c, co["id"], [item["id"]])
            domain.mark_dirty(c, co["id"])
        out.append({"company": co["code"], "sku": item["sku"], "name": item["name"]})
        if req.company:
            break
    return {"stockedOut": out}


class PriceReq(BaseModel):
    company: str | None = None
    sku: str | None = None
    pct: float = 12.0


@router.post("/demo/price-change")
def price_change(req: PriceReq):
    cos = [_co(req.company)] if req.company else db.rows("SELECT * FROM companies ORDER BY id")
    changed = []
    for co in cos:
        items = db.rows("SELECT id, sku FROM items WHERE company_id=:c AND active" + (" AND sku=:s" if req.sku else ""), c=co["id"], s=req.sku)
        for it in items:
            tiers = db.rows("SELECT min_qty, unit_price FROM item_prices WHERE item_id=:i", i=it["id"])
            new = [{"minQty": t["min_qty"], "unitPrice": str(domain.q2(domain.d(t["unit_price"]) * (1 + domain.d(req.pct) / 100)))} for t in tiers]
            domain.set_prices(co, it["id"], new)
            changed.append(it["sku"])
        if req.company:
            break
    return {"pct": req.pct, "itemsChanged": len(changed)}


class PartialReq(BaseModel):
    enabled: bool = True
    pct: int = 60


@router.post("/demo/partial-shipment")
def partial(req: PartialReq):
    domain.set_setting("partial_pct", str(req.pct if req.enabled else 0))
    return {"partialConfirmPct": req.pct if req.enabled else 0}


class ZohoTtlReq(BaseModel):
    ttlSeconds: int = 3600
    expireNow: bool = False


@router.post("/demo/zoho-token")
def zoho_token(req: ZohoTtlReq):
    domain.set_setting("zoho_token_ttl", str(req.ttlSeconds))
    n = db.execute("DELETE FROM oauth_tokens") if req.expireNow else 0
    return {"ttlSeconds": req.ttlSeconds, "tokensRevoked": n}
