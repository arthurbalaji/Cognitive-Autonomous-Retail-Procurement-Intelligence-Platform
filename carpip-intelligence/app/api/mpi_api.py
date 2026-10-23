from flask import Blueprint, jsonify, request

from ..auth import internal_only
from ..mpi import engine

bp = Blueprint("mpi", __name__)


@bp.post("/api/mpi/recompute")
@internal_only
def recompute():
    body = request.get_json(silent=True) or {}
    ids = body.get("productIds")
    if ids:
        r = engine.compute(ids, force=True)
        return jsonify({"products": len(r), "results": r})
    return jsonify(engine.run_job())
