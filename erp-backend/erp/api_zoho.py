"""Zoho Inventory style API (mimic): OAuth2 refresh-token flow, organization-scoped, JSON envelope {code, message, ...}.
Documented simplifications: custom item attributes travel in custom_field_hash; sales-order quantities in cf_*_qty;
reference_number is unique per organization (real Zoho allows duplicates) so that CARPIP retries are idempotent."""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse

from . import db, domain

router = APIRouter()


def zerr(status: int, code: int, message: str) -> JSONResponse:
    return JSONResponse({"code": code, "message": message}, status_code=status)


def _auth(authorization: str | None, organization_id: str | None):
    if not authorization or not authorization.startswith("Zoho-oauthtoken "):
        return None, zerr(401, 57, "You are not authorized to perform this operation")
    tok = db.one("SELECT company_id, expires_at FROM oauth_tokens WHERE access_token=:t", t=authorization[16:].strip())
    if not tok or tok["expires_at"] < datetime.now(timezone.utc):
        return None, zerr(401, 57, "The OAuth token is invalid or expired")
    co = db.one("SELECT * FROM companies WHERE id=:i AND mode='ZOHO'", i=tok["company_id"])
    if not co or (organization_id and organization_id != co["zoho_org_id"]):
        return None, zerr(400, 5, "Invalid value passed for organization_id")
    return co, None


@router.post("/oauth/v2/token")
async def token(refresh_token: str = Query(""), client_id: str = Query(""), client_secret: str = Query(""), grant_type: str = Query("")):
    co = db.one("SELECT * FROM companies WHERE oauth_refresh_token=:r AND oauth_client_id=:i AND oauth_client_secret=:s AND mode='ZOHO'", r=refresh_token, i=client_id, s=client_secret)
    if grant_type != "refresh_token" or not co:
        return JSONResponse({"error": "invalid_client"}, status_code=400)
    ttl = int(domain.get_setting("zoho_token_ttl", "3600"))
    access = "1000." + secrets.token_hex(16)
    db.execute("INSERT INTO oauth_tokens(access_token, company_id, expires_at) VALUES (:a,:c,:e)", a=access, c=co["id"], e=datetime.now(timezone.utc) + timedelta(seconds=ttl))
    db.execute("DELETE FROM oauth_tokens WHERE expires_at < now() - interval '1 day'")
    db.execute("INSERT INTO integration_log(company_id, direction, method, path, status, note) VALUES (:c,'IN','POST','/oauth/v2/token',200,'access token issued')", c=co["id"])
    return {"access_token": access, "expires_in": ttl, "token_type": "Bearer", "api_domain": "http://erp-backend:8000"}


@router.get("/inventory/v1/organizations")
async def organizations(authorization: str | None = Header(default=None), organization_id: str | None = Query(default=None)):
    co, err = _auth(authorization, organization_id)
    if err:
        return err
    return {"code": 0, "message": "success", "organizations": [{"organization_id": co["zoho_org_id"], "name": co["name"], "currency_code": "INR"}]}


@router.get("/inventory/v1/items")
async def items(authorization: str | None = Header(default=None), organization_id: str | None = Query(default=None), page: int = 1, per_page: int = 200):
    co, err = _auth(authorization, organization_id)
    if err:
        return err
    per_page = min(max(per_page, 1), 200)
    with db.engine.connect() as c:
        cat = domain.catalog(c, co["id"])
        ids = {r["sku"]: r["id"] for r in db.rows("SELECT id, sku FROM items WHERE company_id=:c", c, c=co["id"])}
    chunk = cat[(page - 1) * per_page: page * per_page]
    out = []
    for it in chunk:
        out.append({
            "item_id": str(ids.get(it["supplierSku"])), "name": it["name"], "sku": it["supplierSku"], "rate": float(it["listPrice"]), "unit": it["uom"],
            "category_name": it["category"], "status": "active", "stock_on_hand": it["availableQty"], "available_stock": it["availableQty"],
            "custom_field_hash": {
                "cf_gtin": it["gtin"], "cf_moq": it["moq"], "cf_pack_size": it["packSize"], "cf_lead_time_days": it["leadTimeDays"],
                "cf_reliability": it["shippingReliability"], "cf_max_discount": it["maxDiscountPct"], "cf_nearest_expiry": it["nearestExpiry"],
                "cf_shelf_life_days": it["shelfLifeDays"], "cf_price_tiers": json.dumps(it["priceTiers"]),
            },
        })
    return {"code": 0, "message": "success", "items": out, "page_context": {"page": page, "per_page": per_page, "has_more_page": page * per_page < len(cat)}}


_STATUS = {"RECEIVED": "draft", "CONFIRMED": "confirmed", "PARTIALLY_CONFIRMED": "confirmed", "PARTIALLY_SHIPPED": "partially_shipped",
           "SHIPPED": "shipped", "DELIVERED": "fulfilled", "REJECTED": "void", "CANCELLED": "void"}


def _so_json(so_id: int) -> dict:
    with db.engine.connect() as c:
        so = domain.sales_order_view(c, db.one("SELECT company_id FROM sales_orders WHERE id=:i", i=so_id)["company_id"], so_id)
    lines = so["lines"]
    return {
        "salesorder_id": str(so["id"]), "salesorder_number": f"SO-{so['id']:05d}", "reference_number": so["po_number"], "status": _STATUS.get(so["status"], "draft"),
        "customer_name": so["customer"], "date": so["created_at"].date().isoformat(), "delivery_date": so["promised_eta"].isoformat() if so["promised_eta"] else None,
        "line_items": [{"sku": l["sku"], "name": l["name"], "quantity": l["qty_ordered"], "rate": float(l["unit_price"])} for l in lines],
        "custom_field_hash": {
            "cf_confirmed_qty": sum(l["qty_confirmed"] for l in lines), "cf_shipped_qty": sum(l["qty_shipped"] for l in lines),
            "cf_delivered_qty": sum(l["qty_delivered"] for l in lines), "cf_reason": so["reject_reason"],
        },
    }


@router.post("/inventory/v1/salesorders")
async def create_salesorder(request: Request, authorization: str | None = Header(default=None), organization_id: str | None = Query(default=None)):
    co, err = _auth(authorization, organization_id)
    if err:
        return err
    try:
        body = await request.json()
    except ValueError:
        return zerr(400, 2, "Invalid JSON")
    ref = body.get("reference_number")
    if not ref or not body.get("line_items"):
        return zerr(400, 1001, "reference_number and line_items are required")
    cf = body.get("custom_field_hash") or {}
    try:
        so_id, created = domain.create_sales_order(
            co, body.get("customer_name") or "Unknown customer", cf.get("cf_carpip_tenant"), ref,
            [{"sku": l.get("sku"), "gtin": l.get("gtin"), "quantity": l.get("quantity"), "unitPrice": l.get("rate")} for l in body["line_items"]], "CARPIP")
    except domain.ErpError as e:
        return zerr(e.status if e.status != 422 else 400, 1001, f"{e.code}: {e.detail}")
    if created and co["auto_confirm"]:
        try:
            domain.confirm_sales_order(co, so_id, None, "auto-confirm")
        except domain.ErpError:
            pass
    db.execute("INSERT INTO integration_log(company_id, direction, method, path, status, note) VALUES (:c,'IN','POST','/inventory/v1/salesorders',201,:n)", c=co["id"], n=f"{ref} {'created' if created else 'duplicate'}")
    return JSONResponse({"code": 0, "message": "The sales order has been created." if created else "The sales order already exists.", "salesorder": _so_json(so_id)}, status_code=201 if created else 200)


@router.get("/inventory/v1/salesorders/{so_id}")
async def get_salesorder(so_id: int, authorization: str | None = Header(default=None), organization_id: str | None = Query(default=None)):
    co, err = _auth(authorization, organization_id)
    if err:
        return err
    if not db.one("SELECT 1 AS x FROM sales_orders WHERE id=:i AND company_id=:c", i=so_id, c=co["id"]):
        return zerr(404, 2, "The sales order does not exist.")
    return {"code": 0, "message": "success", "salesorder": _so_json(so_id)}


@router.get("/inventory/v1/salesorders")
async def list_salesorders(authorization: str | None = Header(default=None), organization_id: str | None = Query(default=None), reference_number: str | None = None):
    co, err = _auth(authorization, organization_id)
    if err:
        return err
    q = "SELECT id FROM sales_orders WHERE company_id=:c" + (" AND po_number=:r" if reference_number else "") + " ORDER BY id DESC LIMIT 200"
    ids = db.rows(q, c=co["id"], r=reference_number)
    return {"code": 0, "message": "success", "salesorders": [_so_json(r["id"]) for r in ids]}


@router.post("/inventory/v1/salesorders/{so_id}/status/void")
async def void_salesorder(so_id: int, authorization: str | None = Header(default=None), organization_id: str | None = Query(default=None)):
    co, err = _auth(authorization, organization_id)
    if err:
        return err
    so = db.one("SELECT po_number FROM sales_orders WHERE id=:i AND company_id=:c", i=so_id, c=co["id"])
    if not so:
        return zerr(404, 2, "The sales order does not exist.")
    try:
        domain.cancel_by_carpip(co, so["po_number"], "voided by buyer")
    except domain.ErpError as e:
        return zerr(400, 1002, e.detail)
    return {"code": 0, "message": "The sales order has been marked as void."}
