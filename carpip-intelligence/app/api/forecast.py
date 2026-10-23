from flask import Blueprint, jsonify, request

from ..auth import internal_only
from ..forecasting import service

bp = Blueprint("forecast", __name__)


@bp.post("/api/forecast/train")
@internal_only
def train():
    body = request.get_json(silent=True) or {}
    t = body.get("tenantId", "all")
    tenants = service.retail_tenants() if t in (None, "all") else [t]
    return jsonify(service.start_train(tenants)), 202


@bp.get("/api/forecast/status")
@internal_only
def status():
    return jsonify(service.status())


@bp.post("/api/forecast/infer")
@internal_only
def infer():
    body = request.get_json(silent=True) or {}
    t = body.get("tenantId", "all")
    tenants = service.retail_tenants() if t in (None, "all") else [t]
    return jsonify({x: service.infer_tenant(x) for x in tenants})
