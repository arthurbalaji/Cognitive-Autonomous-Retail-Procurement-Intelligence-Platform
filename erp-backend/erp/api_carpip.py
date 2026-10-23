"""CARPIP -> ERP inbound API (Path B). Every call is signed (X-Carpip-Signature) and idempotent (Idempotency-Key / unique po_number)."""
from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse

from . import db, domain
from .security import carpip_company

router = APIRouter()


@router.get("/api/v1/carpip/ping")
async def ping(co: dict = Depends(carpip_company)):
    return {"ok": True, "system": "wholesale-erp", "company": co["name"], "code": co["code"], "mode": co["mode"]}


@router.post("/api/v1/carpip/purchase-orders")
async def receive_po(request: Request, co: dict = Depends(carpip_company), idempotency_key: str | None = Header(default=None)):
    raw = await request.body()
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        return JSONResponse({"code": "BAD_JSON", "detail": "body is not valid JSON"}, status_code=400)
    h = hashlib.sha256(raw).hexdigest()
    if idempotency_key:
        prev = db.one("SELECT request_hash, response, status FROM inbound_requests WHERE company_id=:c AND idempotency_key=:k", c=co["id"], k=idempotency_key)
        if prev:
            if prev["request_hash"] != h:
                return JSONResponse({"code": "IDEMPOTENCY_KEY_MISMATCH", "detail": "key reused with a different body"}, status_code=422)
            return JSONResponse(json.loads(prev["response"]), status_code=prev["status"] or 200, headers={"X-Idempotent-Replay": "true"})
    retailer = body.get("retailer") or {}
    try:
        so_id, created = domain.create_sales_order(co, retailer.get("name") or "Unknown retailer", retailer.get("tenantPublicId"), body.get("poNumber", ""),
                                                  body.get("lines") or [], "CARPIP", body.get("quoteRef"))
    except domain.ErpError as e:
        return JSONResponse({"code": e.code, "detail": e.detail}, status_code=e.status)
    if created and co["auto_confirm"]:
        try:
            domain.confirm_sales_order(co, so_id, None, "auto-confirm")
        except domain.ErpError:
            pass     # outcome (reject / partial) is reported through the webhook outbox
    status = db.scalar("SELECT status FROM sales_orders WHERE id=:i", i=so_id)
    resp = {"salesOrderId": str(so_id), "status": status, "created": created}
    code = 201 if created else 200
    if idempotency_key:
        db.execute("INSERT INTO inbound_requests(company_id, idempotency_key, request_hash, response, status) VALUES (:c,:k,:h,:r,:s) ON CONFLICT DO NOTHING",
                   c=co["id"], k=idempotency_key, h=h, r=json.dumps(resp), s=code)
    db.execute("INSERT INTO integration_log(company_id, direction, method, path, status, note) VALUES (:c,'IN','POST','/api/v1/carpip/purchase-orders',:s,:n)",
               c=co["id"], s=code, n=f"{body.get('poNumber')} {'created' if created else 'duplicate'} -> {status}")
    return JSONResponse(resp, status_code=code)


@router.post("/api/v1/carpip/purchase-orders/{po_number}/cancel")
async def cancel_po(po_number: str, co: dict = Depends(carpip_company)):
    try:
        out = domain.cancel_by_carpip(co, po_number)
    except domain.ErpError as e:
        return JSONResponse({"code": e.code, "detail": e.detail}, status_code=e.status)
    db.execute("INSERT INTO integration_log(company_id, direction, method, path, status, note) VALUES (:c,'IN','POST',:p,200,'cancelled by buyer')", c=co["id"], p=f"/purchase-orders/{po_number}/cancel")
    return out
