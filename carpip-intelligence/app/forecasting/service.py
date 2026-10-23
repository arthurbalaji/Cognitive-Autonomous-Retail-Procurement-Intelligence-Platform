"""Training + inference of the demand-forecasting ensemble (LSTM + Transformer + XGBoost) per retail tenant.

* one model set per tenant, shared across all of its SKUs (per-SKU max scaling makes windows comparable)
* chronological 80/20 split, scalers fit on the train region only; early stopping on the validation split
* ensemble weights proportional to 1/validation-MAE over members with finite error
* the LSTM member is the CDIN federated global LSTM when FEATURE_CDIN is on and a global model exists
* fallbacks: no history -> zero demand; every member non-finite -> seasonal-naive; cold-start SKUs -> flat recent mean
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import numpy as np
import torch
from sklearn.multioutput import MultiOutputRegressor
from xgboost import XGBRegressor

from .. import db
from ..config import settings
from . import data as D
from . import models as M

log = logging.getLogger(__name__)
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="forecast")
_jobs: dict[str, dict] = {}
_cache: dict[str, dict] = {}
_job_lock = threading.Lock()


def jobs() -> dict:
    return {k: dict(v) for k, v in _jobs.items()}


def retail_tenants() -> list[str]:
    return [r["id"] for r in db.rows("SELECT id::text AS id FROM tenant WHERE type='RETAILER' AND status='ACTIVE' ORDER BY name")]


def start_train(tenant_ids: list[str]) -> dict:
    out = {}
    with _job_lock:
        for t in tenant_ids:
            if _jobs.get(t, {}).get("status") in ("QUEUED", "RUNNING"):
                out[t] = {"status": "ALREADY_RUNNING"}
                continue
            _jobs[t] = {"status": "QUEUED", "queuedAt": time.time()}
            _pool.submit(_run_job, t)
            out[t] = {"status": "QUEUED"}
    return out


def _run_job(tenant_id: str) -> None:
    _jobs[tenant_id].update(status="RUNNING", startedAt=time.time())
    try:
        res = train_tenant(tenant_id)
        _jobs[tenant_id].update(status="DONE" if res.get("trained") else "SKIPPED", finishedAt=time.time(), result=res)
        if res.get("trained"):
            infer_tenant(tenant_id)
    except Exception as e:  # noqa: BLE001
        log.exception("forecast training for %s failed", tenant_id)
        _jobs[tenant_id].update(status="FAILED", finishedAt=time.time(), error=str(e)[:300])


# ----------------------------------------------------------------------------- training
def _units(pred_scaled: np.ndarray, scales_rows: np.ndarray) -> np.ndarray:
    return np.clip(pred_scaled, 0, None) * scales_rows[:, None]


def _xgb_model() -> MultiOutputRegressor:
    return MultiOutputRegressor(XGBRegressor(n_estimators=settings.XGB_ESTIMATORS, max_depth=6, learning_rate=0.05, subsample=0.8,
                                             colsample_bytree=0.8, n_jobs=2, tree_method="hist", random_state=settings.SEED))


def _global_lstm(horizon: int, window: int):
    if not settings.FEATURE_CDIN:
        return None, None
    from ..cdin import coordinator

    got = coordinator.latest_global()
    if not got:
        return None, None
    version, state = got
    try:
        m = M.make("LSTM", horizon, window)
        m.load_state_dict(state)
        return m, version
    except Exception as e:  # noqa: BLE001
        log.warning("global CDIN model incompatible, ignoring: %s", e)
        return None, None


def train_tenant(tenant_id: str) -> dict:
    t0 = time.time()
    torch.set_num_threads(settings.TORCH_THREADS)
    W, H = settings.FORECAST_WINDOW, settings.FORECAST_HORIZON
    panel = D.load_panel(tenant_id)
    if panel is None or panel.n_days < W + H + 25:
        return {"trained": False, "reason": f"not enough history ({0 if panel is None else panel.n_days} days)"}
    dow = D.dow_features(panel.start, panel.n_days)
    scales = D.fit_scales(panel.units, panel.split_day)
    active = panel.units[:, :panel.split_day].sum(axis=1) > 0
    xtr, ytr, mtr = D.make_windows(panel.units, scales, dow, W, H, 0, panel.split_day, active)
    xva, yva, mva = D.make_windows(panel.units, scales, dow, W, H, panel.split_day, panel.n_days, active)
    if len(xtr) < 200 or len(xva) < 20:
        return {"trained": False, "reason": f"too few windows (train={len(xtr)}, val={len(xva)})"}
    sc_va = np.array([scales[p] for p, _ in mva])
    y_true = yva * sc_va[:, None]
    members: dict[str, np.ndarray] = {}
    trained: dict[str, object] = {}
    info: dict[str, dict] = {}

    lstm = M.make("LSTM", H, W)
    info["LSTM"] = M.fit(lstm, xtr, ytr, xva, yva, settings.FORECAST_LSTM_EPOCHS, seed=settings.SEED)
    trf = M.make("TRANSFORMER", H, W)
    info["TRANSFORMER"] = M.fit(trf, xtr, ytr, xva, yva, settings.FORECAST_TRANSFORMER_EPOCHS, cosine=True, seed=settings.SEED)
    xt_tab = D.tabular(panel.units, scales, panel.categories, panel.start, mtr)
    xv_tab = D.tabular(panel.units, scales, panel.categories, panel.start, mva)
    xgb = _xgb_model()
    xgb.fit(xt_tab, ytr)

    local = {"LSTM": M.predict(lstm, xva), "TRANSFORMER": M.predict(trf, xva), "XGBOOST": xgb.predict(xv_tab)}
    lstm_source, lstm_version = "LOCAL", None
    glob, gver = _global_lstm(H, W)
    if glob is not None:
        gp = M.predict(glob, xva)
        if np.isfinite(gp).all():
            local["LSTM"] = gp
            lstm_source, lstm_version = "CDIN_GLOBAL", gver
            lstm = glob
    metrics_by: dict[str, dict] = {}
    for name, p in local.items():
        if np.isfinite(p).all():
            members[name] = p
            metrics_by[name] = D.metrics(y_true, _units(p, sc_va))
    # statistical baselines on the same validation windows
    ma = np.array([[panel.units[p, max(t - 7, 0):t].mean()] * H for p, t in mva])
    sn = np.array([[panel.units[p, t - 7 + (h % 7)] if t - 7 + (h % 7) >= 0 else 0.0 for h in range(H)] for p, t in mva])
    metrics_by["MOVING_AVG_7"] = D.metrics(y_true, ma)
    metrics_by["SEASONAL_NAIVE"] = D.metrics(y_true, sn)

    weights = {k: 1.0 / max(metrics_by[k]["mae"] or 1e-6, 1e-6) for k in members}
    wsum = sum(weights.values())
    weights = {k: v / wsum for k, v in weights.items()} if wsum > 0 else {}
    if members:
        ens = sum(weights[k] * members[k] for k in members)
        metrics_by["ENSEMBLE"] = D.metrics(y_true, _units(ens, sc_va))
        resid = yva - ens
        q10, q90 = np.quantile(resid, 0.10, axis=0), np.quantile(resid, 0.90, axis=0)
    else:
        q10 = q90 = np.zeros(H)

    version = (db.scalar("SELECT COALESCE(MAX(version),0) FROM intel_model_registry WHERE tenant_id = CAST(:t AS uuid) AND kind='ENSEMBLE'", t=tenant_id) or 0) + 1
    folder = os.path.join(settings.MODEL_DIR, tenant_id, f"v{version}")
    os.makedirs(folder, exist_ok=True)
    torch.save(lstm.state_dict(), os.path.join(folder, "lstm.pt"))
    torch.save(trf.state_dict(), os.path.join(folder, "transformer.pt"))
    with open(os.path.join(folder, "xgb.pkl"), "wb") as f:
        pickle.dump(xgb, f)
    meta = {"version": version, "window": W, "horizon": H, "weights": weights, "lstmSource": lstm_source, "cdinVersion": lstm_version,
            "scales": {pid: float(scales[i]) for i, pid in enumerate(panel.product_ids)}, "q10": q10.tolist(), "q90": q90.tolist(),
            "metrics": metrics_by, "trainWindows": len(xtr), "valWindows": len(xva), "trainSeconds": round(time.time() - t0, 1),
            "history": {"start": panel.start.isoformat(), "end": panel.end.isoformat(), "days": panel.n_days}}
    with open(os.path.join(folder, "meta.json"), "w") as f:
        json.dump(meta, f)
    db.execute("UPDATE intel_model_registry SET status='ARCHIVED' WHERE tenant_id = CAST(:t AS uuid) AND kind='ENSEMBLE' AND status='ACTIVE'", t=tenant_id)
    db.execute("""INSERT INTO intel_model_registry(id, tenant_id, kind, version, path, arch_hash, metrics, status)
                  VALUES (CAST(:id AS uuid), CAST(:t AS uuid), 'ENSEMBLE', :v, :p, :a, CAST(:m AS jsonb), 'ACTIVE')""",
               id=str(uuid.uuid4()), t=tenant_id, v=version, p=folder, a=M.arch_hash("ENSEMBLE", H, W), m=json.dumps(metrics_by))
    _cache[tenant_id] = {"version": version, "meta": meta, "lstm": lstm, "trf": trf, "xgb": xgb}
    log.info("tenant %s trained v%d in %.1fs: %s", tenant_id, version, time.time() - t0, {k: v["mae"] for k, v in metrics_by.items()})
    return {"trained": True, "version": version, "seconds": meta["trainSeconds"], "metrics": metrics_by, "lstmSource": lstm_source}


# ----------------------------------------------------------------------------- inference
def _load(tenant_id: str) -> dict | None:
    row = db.one("""SELECT version, path FROM intel_model_registry WHERE tenant_id = CAST(:t AS uuid) AND kind='ENSEMBLE' AND status='ACTIVE'
                    ORDER BY version DESC LIMIT 1""", t=tenant_id)
    if not row:
        return None
    c = _cache.get(tenant_id)
    if c and c["version"] == row["version"]:
        return c
    folder = row["path"]
    try:
        with open(os.path.join(folder, "meta.json")) as f:
            meta = json.load(f)
        H, W = meta["horizon"], meta["window"]
        lstm = M.make("LSTM", H, W)
        lstm.load_state_dict(torch.load(os.path.join(folder, "lstm.pt"), map_location="cpu"))
        trf = M.make("TRANSFORMER", H, W)
        trf.load_state_dict(torch.load(os.path.join(folder, "transformer.pt"), map_location="cpu"))
        with open(os.path.join(folder, "xgb.pkl"), "rb") as f:
            xgb = pickle.load(f)
        _cache[tenant_id] = {"version": row["version"], "meta": meta, "lstm": lstm, "trf": trf, "xgb": xgb}
        return _cache[tenant_id]
    except Exception as e:  # noqa: BLE001
        log.warning("cannot load model %s: %s", folder, e)
        return None


def infer_tenant(tenant_id: str) -> dict:
    torch.set_num_threads(settings.TORCH_THREADS)
    bundle = _load(tenant_id)
    if bundle is None:
        return {"inferred": False, "reason": "no trained model"}
    meta = bundle["meta"]
    W, H = meta["window"], meta["horizon"]
    panel = D.load_panel(tenant_id)
    if panel is None or panel.n_days < W:
        return {"inferred": False, "reason": "no recent history"}
    P = len(panel.product_ids)
    scales = np.array([meta["scales"].get(pid, max(float(panel.units[i].max()), 1.0)) for i, pid in enumerate(panel.product_ids)], dtype=np.float32)
    dow_all = D.dow_features(panel.start, panel.n_days)
    x_nn = D.last_window(panel.units, scales, dow_all, W)
    x_tab = D.tabular(panel.units, scales, panel.categories, panel.start, [(p, panel.n_days) for p in range(P)])
    preds = {"LSTM": M.predict(bundle["lstm"], x_nn), "TRANSFORMER": M.predict(bundle["trf"], x_nn), "XGBOOST": bundle["xgb"].predict(x_tab)}
    w = meta["weights"]
    live = {k: p for k, p in preds.items() if k in w and np.isfinite(p).all()}
    if live:
        tot = sum(w[k] for k in live)
        ens = sum(w[k] / tot * live[k] for k in live)
    else:   # every member failed -> seasonal naive
        ens = np.stack([[panel.units[p, panel.n_days - 7 + (h % 7)] / scales[p] for h in range(H)] for p in range(P)])
    q10, q90 = np.array(meta["q10"]), np.array(meta["q90"])
    yhat = np.clip(ens, 0, None) * scales[:, None]
    lo = np.clip(ens + q10[None, :], 0, None) * scales[:, None]
    hi = np.clip(ens + q90[None, :], 0, None) * scales[:, None]

    rdi = {}
    if settings.FEATURE_CDIN:
        rdi = {r["gtin"]: float(r["rdi"]) for r in db.rows("SELECT gtin, rdi::float8 AS rdi FROM intel_rdi")}
    first_sale = np.array([(np.nonzero(panel.units[i])[0][0] if panel.units[i].any() else panel.n_days) for i in range(P)])
    recent_sum = panel.units[:, -28:].sum(axis=1)
    rows = []
    for i, pid in enumerate(panel.product_ids):
        if recent_sum[i] <= 0:
            yv, lv, hv = np.zeros(H), np.zeros(H), np.zeros(H)       # NO_DEMAND
        elif panel.n_days - first_sale[i] < 14:                        # cold start: flat recent mean
            m = float(panel.units[i, first_sale[i]:].mean())
            yv, lv, hv = np.full(H, m), np.full(H, m * 0.5), np.full(H, m * 1.5)
        else:
            yv, lv, hv = yhat[i], lo[i], hi[i]
        g = panel.gtins[i]
        if g in rdi:
            u = float(np.clip(1.0 + 0.6 * (rdi[g] - 0.5), 0.8, 1.3))   # regional uplift from the CDIN demand index
            yv, lv, hv = yv * u, lv * u, hv * u
        for h in range(H):
            rows.append({"t": tenant_id, "p": pid, "d": panel.end + timedelta(days=h + 1), "y": float(yv[h]), "lo": float(lv[h]),
                         "hi": float(hv[h]), "v": f"v{bundle['version']}"})
    db.execute("DELETE FROM intel_forecast WHERE tenant_id = CAST(:t AS uuid)", t=tenant_id)
    db.executemany("""INSERT INTO intel_forecast(tenant_id, product_id, target_date, yhat, yhat_lo, yhat_hi, model_version)
                      VALUES (CAST(:t AS uuid), CAST(:p AS uuid), :d, :y, :lo, :hi, :v)""", rows)
    return {"inferred": True, "products": P, "horizon": H, "version": bundle["version"]}


def status() -> dict:
    out = {"jobs": jobs(), "models": []}
    for r in db.rows("""SELECT t.name, r.tenant_id::text AS tenant_id, r.version, r.metrics, r.created_at
                        FROM intel_model_registry r JOIN tenant t ON t.id = r.tenant_id WHERE r.kind='ENSEMBLE' AND r.status='ACTIVE' ORDER BY t.name"""):
        out["models"].append(r)
    return out
