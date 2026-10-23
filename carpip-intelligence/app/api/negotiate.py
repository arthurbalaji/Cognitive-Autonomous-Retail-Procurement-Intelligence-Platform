from flask import Blueprint, jsonify, request

from ..auth import internal_only
from ..negotiation import pipf

bp = Blueprint("negotiate", __name__)


def _validate(body):
    if not isinstance(body, dict):
        return "JSON object required"
    for k in ("tenantId", "productId", "context", "candidates"):
        if k not in body:
            return f"missing '{k}'"
    for k in ("sku", "currentStock", "reorderPoint"):
        if k not in body["context"]:
            return f"missing context.{k}"
    return None


@bp.post("/api/negotiate")
@internal_only
def negotiate():
    body = request.get_json(silent=True)
    err = _validate(body)
    if err:
        return jsonify({"type": "about:blank", "status": 400, "code": "BAD_REQUEST", "detail": err}), 400
    return jsonify(pipf.run(body))


@bp.post("/api/procure/plan")
@internal_only
def plan():
    body = request.get_json(silent=True)
    err = _validate(body)
    if err:
        return jsonify({"type": "about:blank", "status": 400, "code": "BAD_REQUEST", "detail": err}), 400
    body.setdefault("options", {})["mode"] = "plan"
    return jsonify(pipf.run(body))
