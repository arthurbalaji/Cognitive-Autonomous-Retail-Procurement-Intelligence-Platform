import hashlib
import json

from flask import Blueprint, Response, g, jsonify, request

from ..auth import internal_only, node_or_internal
from ..cdin import coordinator

bp = Blueprint("cdin", __name__)


def _err(status, code, detail=""):
    r = jsonify({"type": "about:blank", "status": status, "code": code, "detail": detail})
    r.status_code = status
    return r


@bp.get("/api/cdin/rounds/current")
@node_or_internal
def current():
    if g.node_tenant is None:
        return jsonify(coordinator.status())
    coordinator.ensure_initial()
    return jsonify(coordinator.current_for(g.node_tenant))


@bp.get("/api/cdin/models/<int:version>")
@node_or_internal
def model(version):
    b = coordinator.global_bytes(version)
    if b is None:
        return _err(404, "NO_SUCH_MODEL")
    return Response(b, mimetype="application/octet-stream", headers={"X-Sha256": hashlib.sha256(b).hexdigest()})


@bp.post("/api/cdin/rounds/<round_id>/updates")
@node_or_internal
def update(round_id):
    if g.node_tenant is None:
        return _err(403, "FORBIDDEN", "updates must be uploaded by a node API key")
    f = request.files.get("weights")
    if f is None:
        return _err(400, "BAD_REQUEST", "multipart field 'weights' required")
    try:
        meta = json.loads(request.form.get("meta", "{}"))
    except ValueError:
        return _err(400, "BAD_REQUEST", "meta must be JSON")
    status, body = coordinator.receive_update(round_id, g.node_tenant, meta, f.read())
    r = jsonify(body)
    r.status_code = status
    return r


@bp.post("/api/cdin/rounds")
@internal_only
def open_round():
    return jsonify(coordinator.open_round()), 201


@bp.get("/api/cdin/status")
@internal_only
def status():
    return jsonify(coordinator.status())
