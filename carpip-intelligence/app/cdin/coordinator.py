"""Cooperative Demand Intelligence Network - coordinator side.

Privacy model: nodes keep raw sales local; only LSTM weights, a sample count and coarse per-GTIN growth ratios are uploaded.
Aggregation: FedAvg weighted by sample count (share capped at 0.6, stale-by-one updates at x0.5), quorum + deadline,
update validation (architecture, finiteness, staleness, norm outliers).  A regional demand index (RDI) is published only for
GTINs reported by >= 2 nodes (k-anonymity).  Pull-based: nodes poll, no inbound connectivity to nodes is needed.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import os
import statistics
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import torch
from safetensors.torch import load as st_load
from safetensors.torch import save as st_save

from .. import db
from ..config import settings
from ..forecasting import models as M

log = logging.getLogger(__name__)
_lock = threading.RLock()
_alive: dict[str, float] = {}
_offline: set[str] = set()
ALIVE_TTL = 90.0


def _dir(*parts) -> str:
    p = os.path.join(settings.MODEL_DIR, "cdin", *parts)
    os.makedirs(os.path.dirname(p) if "." in os.path.basename(p) else p, exist_ok=True)
    return p


def arch() -> str:
    return M.arch_hash("LSTM", settings.FORECAST_HORIZON, settings.FORECAST_WINDOW)


# ----------------------------------------------------------------------------- global model storage
def _save_global(version: int, state: dict, metrics: dict | None = None) -> str:
    path = _dir(f"global_v{version}.safetensors")
    with open(path, "wb") as f:
        f.write(st_save({k: v.contiguous() for k, v in state.items()}))
    db.execute("UPDATE intel_model_registry SET status='ARCHIVED' WHERE kind='CDIN_GLOBAL' AND status='ACTIVE'")
    db.execute("""INSERT INTO intel_model_registry(id, tenant_id, kind, version, path, arch_hash, metrics, status)
                  VALUES (CAST(:id AS uuid), NULL, 'CDIN_GLOBAL', :v, :p, :a, CAST(:m AS jsonb), 'ACTIVE')""",
               id=str(uuid.uuid4()), v=version, p=path, a=arch(), m=json.dumps(metrics or {}))
    return path


def latest_global() -> tuple[int, dict] | None:
    row = db.one("SELECT version, path FROM intel_model_registry WHERE kind='CDIN_GLOBAL' AND status='ACTIVE' ORDER BY version DESC LIMIT 1")
    if not row or not os.path.exists(row["path"]):
        return None
    with open(row["path"], "rb") as f:
        return row["version"], st_load(f.read())


def global_bytes(version: int) -> bytes | None:
    row = db.one("SELECT path FROM intel_model_registry WHERE kind='CDIN_GLOBAL' AND version = :v LIMIT 1", v=version)
    if not row or not os.path.exists(row["path"]):
        return None
    with open(row["path"], "rb") as f:
        return f.read()


def ensure_initial() -> int:
    """Version 1 = seeded random initialisation (every node starts from the same weights)."""
    with _lock:
        got = latest_global()
        if got:
            return got[0]
        torch.manual_seed(settings.SEED)
        _save_global(1, M.make("LSTM", settings.FORECAST_HORIZON, settings.FORECAST_WINDOW).state_dict(), {"note": "initial"})
        return 1


# ----------------------------------------------------------------------------- rounds
def node_tenants() -> list[dict]:
    return db.rows("""SELECT DISTINCT t.id::text AS id, t.name FROM api_key k JOIN tenant t ON t.id = k.tenant_id
                      WHERE k.status <> 'REVOKED' AND k.scopes LIKE '%cdin:node%' AND t.type='RETAILER' AND t.status='ACTIVE' ORDER BY t.name""")


def open_round() -> dict:
    with _lock:
        cur = db.one("SELECT * FROM intel_cdin_round WHERE status = 'OPEN' ORDER BY round_no DESC LIMIT 1")
        if cur:
            return _view(cur)
        base = ensure_initial()
        no = (db.scalar("SELECT COALESCE(MAX(round_no),0) FROM intel_cdin_round") or 0) + 1
        rid = str(uuid.uuid4())
        db.execute("""INSERT INTO intel_cdin_round(id, round_no, base_version, status, quorum, deadline_at)
                      VALUES (CAST(:id AS uuid), :no, :b, 'OPEN', :q, now() + make_interval(secs => :s))""",
                   id=rid, no=no, b=base, q=settings.CDIN_MIN_QUORUM, s=settings.CDIN_ROUND_DEADLINE_S)
        log.info("CDIN round %d opened (base v%d)", no, base)
        return _view(db.one("SELECT * FROM intel_cdin_round WHERE id = CAST(:id AS uuid)", id=rid))


def _view(r: dict) -> dict:
    return {"id": str(r["id"]), "roundNo": r["round_no"], "baseVersion": r["base_version"], "status": r["status"], "quorum": r["quorum"],
            "deadlineAt": r["deadline_at"].isoformat(), "participants": r["participants"], "archHash": arch(), "horizon": settings.FORECAST_HORIZON,
            "window": settings.FORECAST_WINDOW, "epochs": settings.CDIN_LOCAL_EPOCHS, "mu": settings.CDIN_FEDPROX_MU, "metrics": r.get("metrics")}


def current_for(tenant_id: str) -> dict:
    paused = tenant_id in _offline
    if not paused:
        _alive[tenant_id] = time.time()
    r = db.one("SELECT * FROM intel_cdin_round WHERE status = 'OPEN' ORDER BY round_no DESC LIMIT 1")
    done = None
    if r:
        done = db.one("SELECT 1 AS x FROM intel_cdin_update WHERE round_id = :r AND tenant_id = CAST(:t AS uuid)", r=r["id"], t=tenant_id) is not None
    return {"round": _view(r) if r and not paused else None, "paused": paused, "alreadySubmitted": bool(done)}


def set_offline(tenant_id: str | None, offline: bool = True) -> dict:
    nodes = node_tenants()
    if tenant_id is None and nodes:
        tenant_id = nodes[-1]["id"]
    if tenant_id is None:
        return {"error": "no CDIN nodes registered"}
    (_offline.add if offline else _offline.discard)(tenant_id)
    return {"tenantId": tenant_id, "offline": tenant_id in _offline, "offlineNodes": sorted(_offline)}


def receive_update(round_id: str, tenant_id: str, meta: dict, blob: bytes) -> tuple[int, dict]:
    with _lock:
        r = db.one("SELECT * FROM intel_cdin_round WHERE id = CAST(:id AS uuid)", id=round_id)
        if not r:
            return 404, {"code": "NO_SUCH_ROUND"}
        if r["status"] != "OPEN":
            return 409, {"code": "ROUND_CLOSED", "detail": f"round is {r['status']}"}
        digest = hashlib.sha256(blob).hexdigest()
        if meta.get("sha256") and meta["sha256"] != digest:
            return 422, {"code": "CHECKSUM_MISMATCH"}
        reason = None
        try:
            state = st_load(blob)
        except Exception as e:  # noqa: BLE001
            return 422, {"code": "BAD_WEIGHTS", "detail": str(e)[:100]}
        glob_bytes = global_bytes(r["base_version"])
        ref = st_load(glob_bytes)
        if set(state) != set(ref) or any(state[k].shape != ref[k].shape for k in ref):
            return 422, {"code": "ARCH_MISMATCH"}
        if not all(torch.isfinite(v).all() for v in state.values()):
            reason = "NON_FINITE_WEIGHTS"
        base_v = int(meta.get("baseVersion", -1))
        weight_mult = 1.0
        if reason is None:
            if base_v == r["base_version"]:
                pass
            elif base_v == r["base_version"] - 1:
                weight_mult = 0.5
            else:
                reason = "STALE_BASE_VERSION"
        n = int(meta.get("numSamples", 0))
        if reason is None and n <= 0:
            reason = "NO_SAMPLES"
        l2 = math.sqrt(sum(float(((state[k].float() - ref[k].float()) ** 2).sum()) for k in ref)) if reason is None else None
        path = _dir("rounds", round_id, f"{tenant_id}.safetensors")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(blob)
        db.execute("DELETE FROM intel_cdin_update WHERE round_id = CAST(:r AS uuid) AND tenant_id = CAST(:t AS uuid)", r=round_id, t=tenant_id)  # re-submit replaces
        db.execute("""INSERT INTO intel_cdin_update(id, round_id, tenant_id, num_samples, base_version, sha256, l2_delta, accepted, reject_reason, growth, val_loss)
                      VALUES (CAST(:id AS uuid), CAST(:r AS uuid), CAST(:t AS uuid), :n, :bv, :sha, :l2, :acc, :rej, CAST(:g AS jsonb), :vl)""",
                   id=str(uuid.uuid4()), r=round_id, t=tenant_id, n=n, bv=base_v, sha=digest, l2=l2, acc=reason is None, rej=reason,
                   g=json.dumps(meta.get("growth") or {}), vl=meta.get("valLoss"))
        _stash_mult(round_id, tenant_id, weight_mult)
        out = {"accepted": reason is None, "reason": reason, "l2": l2}
    _maybe_aggregate(round_id)
    return 200, out


_mults: dict[tuple[str, str], float] = {}


def _stash_mult(round_id: str, tenant_id: str, m: float) -> None:
    _mults[(round_id, tenant_id)] = m


def _expected(round_id: str) -> set[str]:
    now = time.time()
    alive = {t for t, ts in _alive.items() if now - ts < ALIVE_TTL and t not in _offline}
    done = {r["t"] for r in db.rows("SELECT tenant_id::text AS t FROM intel_cdin_update WHERE round_id = CAST(:r AS uuid)", r=round_id)}
    return alive | done


def _maybe_aggregate(round_id: str) -> None:
    done = {r["t"] for r in db.rows("SELECT tenant_id::text AS t FROM intel_cdin_update WHERE round_id = CAST(:r AS uuid)", r=round_id)}
    r = db.one("SELECT quorum FROM intel_cdin_round WHERE id = CAST(:r AS uuid) AND status='OPEN'", r=round_id)
    if r and len(done) >= r["quorum"] and _expected(round_id) <= done:
        aggregate(round_id)


def tick() -> None:
    """Deadline handling (called every few seconds by the scheduler)."""
    r = db.one("SELECT id::text AS id, quorum, (deadline_at < now()) AS expired FROM intel_cdin_round WHERE status='OPEN' ORDER BY round_no DESC LIMIT 1")
    if not r:
        return
    n = db.scalar("SELECT count(*) FROM intel_cdin_update WHERE round_id = CAST(:r AS uuid)", r=r["id"]) or 0
    if r["expired"]:
        if n >= r["quorum"]:
            aggregate(r["id"])
        else:
            db.execute("UPDATE intel_cdin_round SET status='FAILED_QUORUM', completed_at=now(), participants=:n, metrics=CAST(:m AS jsonb) WHERE id = CAST(:r AS uuid)",
                       n=n, r=r["id"], m=json.dumps({"reason": f"only {n} of {r['quorum']} required updates arrived before the deadline"}))
            log.warning("CDIN round FAILED_QUORUM (%d/%d)", n, r["quorum"])
    elif n >= r["quorum"]:
        _maybe_aggregate(r["id"])


def aggregate(round_id: str) -> dict | None:
    with _lock:
        r = db.one("SELECT * FROM intel_cdin_round WHERE id = CAST(:r AS uuid) AND status='OPEN'", r=round_id)
        if not r:
            return None
        ups = db.rows("""SELECT tenant_id::text AS t, num_samples, l2_delta::float8 AS l2, accepted, growth, val_loss::float8 AS vl
                         FROM intel_cdin_update WHERE round_id = CAST(:r AS uuid) AND accepted""", r=round_id)
        # norm outlier rejection
        if len(ups) >= 3:
            med = statistics.median(u["l2"] for u in ups)
            bad = [u["t"] for u in ups if u["l2"] > max(3 * med, 1e-6)]
        elif len(ups) == 2:
            lo, hi = sorted(u["l2"] for u in ups)
            bad = [u["t"] for u in ups if u["l2"] > 10 * max(lo, 1e-6) and u["l2"] == hi]
        else:
            bad = []
        for t in bad:
            db.execute("UPDATE intel_cdin_update SET accepted=false, reject_reason='NORM_OUTLIER' WHERE round_id = CAST(:r AS uuid) AND tenant_id = CAST(:t AS uuid)", r=round_id, t=t)
        ups = [u for u in ups if u["t"] not in bad]
        if len(ups) < r["quorum"]:
            db.execute("UPDATE intel_cdin_round SET status='FAILED_QUORUM', completed_at=now(), participants=:n, metrics=CAST(:m AS jsonb) WHERE id = CAST(:r AS uuid)",
                       n=len(ups), r=round_id, m=json.dumps({"reason": "quorum lost after validation", "rejected": bad}))
            return None
        # FedAvg with capped shares
        raw = {u["t"]: u["num_samples"] * _mults.get((round_id, u["t"]), 1.0) for u in ups}
        tot = sum(raw.values())
        share = {t: v / tot for t, v in raw.items()}
        cap = settings.CDIN_SHARE_CAP
        if len(share) > 1 and max(share.values()) > cap:
            over = {t for t, s in share.items() if s > cap}
            free = 1.0 - cap * len(over)
            rest = sum(s for t, s in share.items() if t not in over)
            share = {t: (cap if t in over else (share[t] / rest * free if rest > 0 else 0.0)) for t in share}
        acc: dict[str, torch.Tensor] = {}
        for u in ups:
            with open(_dir("rounds", round_id, f"{u['t']}.safetensors"), "rb") as f:
                st = st_load(f.read())
            for k, v in st.items():
                acc[k] = acc.get(k, 0) + v.float() * share[u["t"]]
        new_version = (db.scalar("SELECT MAX(version) FROM intel_model_registry WHERE kind='CDIN_GLOBAL'") or 1) + 1
        vls = [u["vl"] for u in ups if u["vl"] is not None]
        metrics = {"round": r["round_no"], "participants": len(ups), "shares": {t: round(s, 3) for t, s in share.items()},
                   "meanValLoss": round(float(np.mean(vls)), 6) if vls else None, "rejected": bad}
        _save_global(new_version, {k: v for k, v in acc.items()}, metrics)
        _publish_rdi(ups)
        db.execute("UPDATE intel_cdin_round SET status='COMPLETED', completed_at=now(), participants=:n, metrics=CAST(:m AS jsonb) WHERE id = CAST(:r AS uuid)",
                   n=len(ups), m=json.dumps(metrics), r=round_id)
        log.info("CDIN round %d complete -> global v%d (%d nodes)", r["round_no"], new_version, len(ups))
        threading.Thread(target=_refresh_forecasts, daemon=True).start()
        return metrics


def _publish_rdi(ups: list[dict]) -> None:
    """RDI per GTIN = 0.5 + 0.5*tanh(3*(weighted mean growth - 1)); published only if >= 2 nodes contributed (k-anonymity)."""
    by_gtin: dict[str, list[tuple[float, int]]] = {}
    for u in ups:
        g = u["growth"] if isinstance(u["growth"], dict) else json.loads(u["growth"] or "{}")
        for gtin, ratio in g.items():
            if isinstance(ratio, (int, float)) and math.isfinite(ratio):
                by_gtin.setdefault(gtin, []).append((float(ratio), u["num_samples"]))
    rows = []
    for gtin, vals in by_gtin.items():
        if len(vals) < 2:
            continue
        mean = sum(r * n for r, n in vals) / sum(n for _, n in vals)
        rows.append({"g": gtin, "rdi": float(np.clip(0.5 + 0.5 * math.tanh(3.0 * (mean - 1.0)), 0, 1)), "n": len(vals)})
    db.executemany("""INSERT INTO intel_rdi(gtin, rdi, n_nodes, computed_at) VALUES (:g, :rdi, :n, now())
                      ON CONFLICT (gtin) DO UPDATE SET rdi = EXCLUDED.rdi, n_nodes = EXCLUDED.n_nodes, computed_at = now()""", rows)


def _refresh_forecasts() -> None:
    try:
        from ..forecasting import service

        for t in service.retail_tenants():
            service.infer_tenant(t)
    except Exception:  # noqa: BLE001
        log.exception("forecast refresh after CDIN round failed")


def status() -> dict:
    rounds = db.rows("""SELECT round_no, base_version, status, quorum, participants, metrics, created_at, completed_at FROM intel_cdin_round ORDER BY round_no DESC LIMIT 12""")
    now = time.time()
    nodes = []
    for n in node_tenants():
        nodes.append({**n, "alive": now - _alive.get(n["id"], 0) < ALIVE_TTL, "offline": n["id"] in _offline})
    g = db.one("SELECT version, created_at FROM intel_model_registry WHERE kind='CDIN_GLOBAL' AND status='ACTIVE' ORDER BY version DESC LIMIT 1")
    return {"enabled": settings.FEATURE_CDIN, "nodes": nodes, "rounds": rounds, "globalVersion": g["version"] if g else None,
            "rdiGtins": db.scalar("SELECT count(*) FROM intel_rdi") or 0, "quorum": settings.CDIN_MIN_QUORUM}
