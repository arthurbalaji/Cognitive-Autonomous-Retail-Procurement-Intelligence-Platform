"""Authentication: internal service token (Java -> Flask) and CDIN node API keys."""
from __future__ import annotations

import hashlib
import hmac
from functools import wraps

from flask import g, jsonify, request

from . import db
from .config import settings


def _problem(status: int, code: str, detail: str):
    resp = jsonify({"type": "about:blank", "status": status, "code": code, "detail": detail})
    resp.status_code = status
    resp.mimetype = "application/problem+json"
    return resp


def internal_only(fn):
    """Requires X-Internal-Token equal to INTERNAL_SERVICE_TOKEN (constant-time compare)."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        presented = request.headers.get("X-Internal-Token", "")
        if not settings.INTERNAL_TOKEN or not hmac.compare_digest(presented, settings.INTERNAL_TOKEN):
            return _problem(401, "UNAUTHORIZED", "missing or invalid internal token")
        return fn(*args, **kwargs)

    return wrapper


def node_or_internal(fn):
    """CDIN endpoints: a node API key (scope cdin:node, resolves a tenant) or the internal token."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        presented = request.headers.get("X-Internal-Token", "")
        if settings.INTERNAL_TOKEN and hmac.compare_digest(presented, settings.INTERNAL_TOKEN):
            g.node_tenant = None
            g.internal = True
            return fn(*args, **kwargs)
        auth = request.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            return _problem(401, "UNAUTHORIZED", "node API key required")
        key = auth[7:].strip()
        tenant = resolve_api_key(key)
        if tenant is None:
            return _problem(401, "UNAUTHORIZED", "invalid node API key")
        g.node_tenant = tenant
        g.internal = False
        return fn(*args, **kwargs)

    return wrapper


def resolve_api_key(key: str) -> str | None:
    """Validates ck_live_<prefix8>_<secret> against api_key (sha256 hash, scope cdin:node). Returns tenant id."""
    if not key.startswith("ck_live_") or len(key) < 20 or key[16] != "_":
        return None
    prefix = key[8:16]
    row = db.one("SELECT tenant_id::text AS tenant_id, key_hash, scopes, status, expires_at FROM api_key WHERE prefix = :p", p=prefix)
    if not row or row["status"] == "REVOKED":
        return None
    digest = hashlib.sha256(key.encode()).hexdigest()
    if not hmac.compare_digest(digest, row["key_hash"]):
        return None
    if "cdin:node" not in (row["scopes"] or "").split(","):
        return None
    return row["tenant_id"]
