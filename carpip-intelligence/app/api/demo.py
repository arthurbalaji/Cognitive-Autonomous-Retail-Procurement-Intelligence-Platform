from flask import Blueprint, jsonify, request

from .. import reschedule_mpi
from ..auth import internal_only
from ..cdin import coordinator
from ..config import settings
from ..llm.bedrock import llm

bp = Blueprint("demo", __name__)

FAULTS = {"none", "timeout", "throttle", "invalid_json", "out_of_bounds", "refusal", "bedrock_down"}


def _guard():
    if not settings.DEMO_MODE:
        r = jsonify({"status": 403, "code": "FORBIDDEN", "detail": "demo mode disabled"})
        r.status_code = 403
        return r
    return None


@bp.post("/api/demo/llm-fault")
@internal_only
def llm_fault():
    if (g := _guard()) is not None:
        return g
    mode = (request.get_json(silent=True) or {}).get("mode", "none")
    if mode not in FAULTS:
        r = jsonify({"status": 400, "code": "BAD_REQUEST", "detail": f"mode must be one of {sorted(FAULTS)}"})
        r.status_code = 400
        return r
    llm.fault = mode
    llm._failures.clear()
    llm._open_until = 0.0
    return jsonify({"fault": mode, "status": llm.status()})


@bp.put("/api/demo/time-scale")
@internal_only
def time_scale():
    scale = float((request.get_json(silent=True) or {}).get("scale", 1))
    return jsonify({"scale": scale, "mpiIntervalSeconds": reschedule_mpi(scale)})


@bp.post("/api/demo/cdin-offline")
@internal_only
def cdin_offline():
    if (g := _guard()) is not None:
        return g
    body = request.get_json(silent=True) or {}
    return jsonify(coordinator.set_offline(body.get("tenantId"), bool(body.get("offline", True))))
