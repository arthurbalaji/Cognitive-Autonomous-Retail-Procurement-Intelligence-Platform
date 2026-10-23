from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import Header, HTTPException, Request

from . import config, db


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def password_hash(email: str, password: str) -> str:
    return sha256(f"{email.lower()}:{password}")


def sign_token(payload: dict, ttl: int = 8 * 3600) -> str:
    body = base64.urlsafe_b64encode(json.dumps({**payload, "exp": int(time.time()) + ttl}).encode()).decode().rstrip("=")
    sig = hmac.new(config.UI_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_token(token: str | None) -> dict | None:
    if not token or "." not in token:
        return None
    body, sig = token.split(".", 1)
    if not hmac.compare_digest(sig, hmac.new(config.UI_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()):
        return None
    try:
        p = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:  # noqa: BLE001
        return None
    return p if p.get("exp", 0) > time.time() else None


def current_user(authorization: str | None = Header(default=None)) -> dict:
    t = authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None
    p = verify_token(t)
    if not p:
        raise HTTPException(401, {"code": "UNAUTHORIZED", "detail": "sign in again"})
    return p


def admin_only(x_admin_token: str | None = Header(default=None)) -> None:
    if not config.ADMIN_TOKEN or not hmac.compare_digest(x_admin_token or "", config.ADMIN_TOKEN):
        raise HTTPException(401, {"code": "UNAUTHORIZED", "detail": "admin token required"})


# ------------------------------------------------------------------ CARPIP signature scheme
def carpip_sign(secret: str, ts: str, event_id: str, body: bytes) -> str:
    return "v1=" + hmac.new(secret.encode(), f"{ts}.{event_id}.".encode() + body, hashlib.sha256).hexdigest()


def carpip_verify(secret: str, header: str | None, ts: str | None, event_id: str | None, body: bytes) -> bool:
    if not (header and ts and event_id and secret):
        return False
    try:
        if abs(time.time() - float(ts)) > config.CARPIP_TOLERANCE_S:
            return False
    except ValueError:
        return False
    expected = carpip_sign(secret, ts, event_id, body)
    return any(hmac.compare_digest(p.strip(), expected) for p in header.split(","))


async def carpip_company(request: Request) -> dict:
    """Identifies the company from X-Carpip-Tenant and verifies the CARPIP signature over the RAW body."""
    tenant = request.headers.get("x-carpip-tenant", "")
    co = db.one("SELECT * FROM companies WHERE carpip_tenant_public_id = :t AND mode = 'PATH_B'", t=tenant)
    raw = await request.body()
    if not co or not carpip_verify(co["carpip_webhook_secret"], request.headers.get("x-carpip-signature"), request.headers.get("x-carpip-timestamp"),
                                   request.headers.get("x-carpip-event-id"), raw):
        db.execute("INSERT INTO integration_log(company_id, direction, method, path, status, note) VALUES (:c,'IN',:m,:p,401,'invalid CARPIP signature or unknown tenant')",
                   c=co["id"] if co else None, m=request.method, p=request.url.path)
        raise HTTPException(401, {"code": "INVALID_SIGNATURE", "detail": "signature missing, stale or invalid"})
    return co
