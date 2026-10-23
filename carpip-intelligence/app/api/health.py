from flask import Blueprint, jsonify

from .. import db
from ..config import settings

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    return jsonify({"status": "UP", "service": "carpip-intelligence", "model": settings.BEDROCK_MODEL_ID,
                    "features": {"mpi": settings.FEATURE_MPI, "cdin": settings.FEATURE_CDIN}})


@bp.get("/ready")
def ready():
    try:
        db.scalar("SELECT 1")
        return jsonify({"status": "READY"})
    except Exception as e:  # noqa: BLE001
        r = jsonify({"status": "NOT_READY", "detail": str(e)[:200]})
        r.status_code = 503
        return r
