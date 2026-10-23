import time

from flask import Blueprint, jsonify

from ..auth import internal_only
from ..llm.bedrock import TEXT_SCHEMA, LlmError, llm

bp = Blueprint("llm", __name__)


@bp.get("/api/llm/status")
@internal_only
def status():
    return jsonify(llm.status())


@bp.post("/api/llm/check")
@internal_only
def check():
    """Live connectivity check: one minimal structured call to Bedrock. Maps the failure to an actionable fix."""
    t0 = time.time()
    usage: dict = {}
    hints = {
        "auth": "AWS credentials missing/expired. Run scripts/aws-creds.sh (or `aws login`) and retry.",
        "no_credentials": "No AWS credentials found. Run scripts/aws-creds.sh to export them for the container.",
        "model_not_found": "Model id not valid in this region. Check BEDROCK_MODEL_ID / AWS_REGION and Bedrock model access.",
        "throttle": "Bedrock throttled the request; retry shortly or lower LLM_MAX_CONCURRENCY.",
        "timeout": "Bedrock call timed out; check network/VPN.",
        "connection": "Cannot reach Bedrock; check internet access from the container.",
        "bad_request": "Bedrock rejected the request (see detail).",
    }
    try:
        out = llm.complete_json("Reply with JSON {\"text\": \"pong\"}.", {"ping": True}, TEXT_SCHEMA, usage, max_tokens=60)
        return jsonify({"ok": True, "reply": out, "latencyMs": int((time.time() - t0) * 1000), "usage": usage, "status": llm.status()})
    except LlmError as e:
        r = jsonify({"ok": False, "kind": e.kind, "detail": e.detail, "hint": hints.get(e.kind, "See detail."), "status": llm.status()})
        r.status_code = 200
        return r
