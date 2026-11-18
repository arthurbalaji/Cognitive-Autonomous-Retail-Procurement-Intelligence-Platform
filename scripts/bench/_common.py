"""Shared helpers for the paper experiments. Runs inside the engine image (PYTHONPATH=/srv:/work).

World = deterministic synthetic retail data (scripts/datagen/generate.py): 120 SKUs x 3 stores x 150 days.
Days [0,120) are the training region, days [120,150) are the 30-day evaluation window. Models are trained once on the
training region (no retraining inside the window) with the platform's own code (app.forecasting.{data,models}) and settings.
"""
from __future__ import annotations

import json
import os
import platform
import time
from dataclasses import dataclass
from datetime import date

import numpy as np
import xgboost
from sklearn.multioutput import MultiOutputRegressor
from xgboost import XGBRegressor

from app.config import settings
from app.forecasting import data as D
from app.forecasting import models as M
from scripts.datagen import generate as G

OUT = os.getenv("BENCH_OUT", "docs/results")
CACHE = os.getenv("BENCH_CACHE", ".demo/bench")
END = date(2026, 10, 31)          # last day of data (fixed so runs are reproducible)
N_DAYS, TRAIN_END, N_STORES = 150, 120, 3
W, H = settings.FORECAST_WINDOW, settings.FORECAST_HORIZON
START = date.fromordinal(END.toordinal() - (N_DAYS - 1))


@dataclass
class World:
    seed: int
    volatility: float
    catalog: list
    hist: np.ndarray            # (3, P, 150) int units

    @property
    def P(self) -> int:
        return len(self.catalog)

    @property
    def pooled(self) -> np.ndarray:          # (3P, 150): row = store * P + product
        return self.hist.reshape(N_STORES * self.P, N_DAYS).astype(np.float32)

    @property
    def cats(self) -> list[str]:
        return [p.category for _ in range(N_STORES) for p in self.catalog]

    @property
    def gtins(self) -> list[str]:
        return [p.gtin for _ in range(N_STORES) for p in self.catalog]


def build_world(seed: int, volatility: float = 0.0, n_sku: int = 120) -> World:
    cat = G.build_catalog(n_sku, seed)
    hist = np.stack([G.history(cat, s, N_DAYS, END, seed) for s in range(N_STORES)])
    if volatility > 0:      # extra multiplicative day-to-day noise (mean-preserving log-normal)
        rng = np.random.default_rng(seed + 7919)
        hist = np.rint(hist * rng.lognormal(-volatility ** 2 / 2, volatility, hist.shape)).astype(np.int64)
    return World(seed, volatility, cat, hist)


# ----------------------------------------------------------------------------- model training (mirrors service.train_tenant)
def _xgb() -> MultiOutputRegressor:
    return MultiOutputRegressor(XGBRegressor(n_estimators=settings.XGB_ESTIMATORS, max_depth=6, learning_rate=0.05, subsample=0.8,
                                             colsample_bytree=0.8, n_jobs=4, tree_method="hist", random_state=settings.SEED))


def origin_inputs(units: np.ndarray, scales: np.ndarray, dow: np.ndarray, origins: list[int]):
    """Network inputs and (series, origin) meta for forecasting days [t, t+H) from history < t, for every series and origin t."""
    scaled = units / scales[:, None]
    xs, meta = [], []
    for t in origins:
        for p in range(units.shape[0]):
            xs.append(np.concatenate([scaled[p, t - W:t, None], dow[t - W:t]], axis=1))
            meta.append((p, t))
    return np.asarray(xs, dtype=np.float32), meta


def train_ensemble(units: np.ndarray, cats: list[str], seed: int, lstm_epochs: int | None = None, trf_epochs: int | None = None,
                   log=print) -> dict:
    """Train LSTM + Transformer + XGBoost on units[:, :TRAIN_END] exactly like the platform (chronological 80/20, train-only scaling,
    early stopping on the validation windows, ensemble weights proportional to 1/validation-MAE, residual quantiles for the 80 % band)."""
    torch_seed = seed
    t0 = time.time()
    tr = units[:, :TRAIN_END]
    split = int(TRAIN_END * 0.8)
    dow = D.dow_features(START, N_DAYS)
    scales = D.fit_scales(tr, split)
    active = tr[:, :split].sum(axis=1) > 0
    xtr, ytr, mtr = D.make_windows(tr, scales, dow, W, H, 0, split, active)
    xva, yva, mva = D.make_windows(tr, scales, dow, W, H, split, TRAIN_END, active)
    sc_va = np.array([scales[p] for p, _ in mva])
    y_true = yva * sc_va[:, None]
    lstm = M.make("LSTM", H, W)
    info_l = M.fit(lstm, xtr, ytr, xva, yva, lstm_epochs or settings.FORECAST_LSTM_EPOCHS, seed=torch_seed)
    trf = M.make("TRANSFORMER", H, W)
    info_t = M.fit(trf, xtr, ytr, xva, yva, trf_epochs or settings.FORECAST_TRANSFORMER_EPOCHS, cosine=True, seed=torch_seed)
    xgb = _xgb()
    xgb.fit(D.tabular(tr, scales, cats, START, mtr), ytr)
    val = {"LSTM": M.predict(lstm, xva), "TRANSFORMER": M.predict(trf, xva), "XGBOOST": xgb.predict(D.tabular(tr, scales, cats, START, mva))}
    mae = {k: D.metrics(y_true, np.clip(v, 0, None) * sc_va[:, None])["mae"] for k, v in val.items()}
    w = {k: 1.0 / max(m, 1e-6) for k, m in mae.items()}
    s = sum(w.values())
    w = {k: v / s for k, v in w.items()}
    ens_val = sum(w[k] * val[k] for k in val)
    resid = yva - ens_val
    log(f"  trained in {time.time() - t0:.0f}s  epochs L/T={info_l['epochs']}/{info_t['epochs']}  val-MAE={mae}  weights={ {k: round(v, 3) for k, v in w.items()} }")
    return {"lstm": lstm, "trf": trf, "xgb": xgb, "scales": scales, "weights": w, "val_mae": mae,
            "q10": np.quantile(resid, 0.10, axis=0), "q90": np.quantile(resid, 0.90, axis=0),
            "train_windows": len(xtr), "val_windows": len(xva), "epochs": (info_l["epochs"], info_t["epochs"]),
            "train_seconds": round(time.time() - t0, 1)}


def predict_origins(model: dict, units: np.ndarray, cats: list[str], origins: list[int]) -> dict[str, np.ndarray]:
    """Per-model forecasts in units, shape (n_origins, n_series, H), for each origin day t (history < t only)."""
    dow = D.dow_features(START, N_DAYS)
    sc = model["scales"]
    x, meta = origin_inputs(units, sc, dow, origins)
    n_s = units.shape[0]
    xt = D.tabular(units, sc, cats, START, meta)
    scale_rows = np.array([sc[p] for p, _ in meta])[:, None]
    out = {"LSTM": M.predict(model["lstm"], x), "TRANSFORMER": M.predict(model["trf"], x), "XGBOOST": model["xgb"].predict(xt)}
    w = model["weights"]
    out["ENSEMBLE"] = sum(w[k] * out[k] for k in w)
    res = {k: (np.clip(v, 0, None) * scale_rows).reshape(len(origins), n_s, H) for k, v in out.items()}
    lo = np.clip(out["ENSEMBLE"] + model["q10"][None, :], 0, None) * scale_rows
    hi = np.clip(out["ENSEMBLE"] + model["q90"][None, :], 0, None) * scale_rows
    res["LO"], res["HI"] = lo.reshape(res["ENSEMBLE"].shape), hi.reshape(res["ENSEMBLE"].shape)
    return res


def baselines(units: np.ndarray, origins: list[int]) -> dict[str, np.ndarray]:
    n_s = units.shape[0]
    ma = np.zeros((len(origins), n_s, H), np.float32)
    sn = np.zeros((len(origins), n_s, H), np.float32)
    for oi, t in enumerate(origins):
        ma[oi] = units[:, t - 7:t].mean(axis=1)[:, None]
        for h in range(H):
            sn[oi, :, h] = units[:, t - 7 + (h % 7)]
    return {"MOVING_AVG_7": ma, "SEASONAL_NAIVE": sn}


def truth(units: np.ndarray, origins: list[int]) -> tuple[np.ndarray, list[int]]:
    """Actuals (n_ok, n_series, H) for origins whose full horizon lies inside the data."""
    ok = [i for i, t in enumerate(origins) if t + H <= N_DAYS]
    return np.stack([units[:, origins[i]:origins[i] + H] for i in ok]), ok


def score(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    m = D.metrics(y_true, y_pred)
    m["wape"] = round(float(np.abs(y_pred - y_true).sum() / max(y_true.sum(), 1e-9) * 100), 3)
    return m


def hardware() -> dict:
    cpu = platform.processor() or "x86_64"
    try:
        for line in open("/proc/cpuinfo"):
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    return {"cpu": cpu, "container_cpus": os.cpu_count(), "torch_threads": settings.TORCH_THREADS, "python": platform.python_version(),
            "torch": __import__("torch").__version__, "xgboost": xgboost.__version__, "numpy": np.__version__}


def save_json(name: str, obj) -> str:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf8") as f:
        json.dump(obj, f, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    return path


def mean_ci(xs, n_boot: int = 2000, seed: int = 0) -> tuple[float, float, float, float]:
    """mean, std, 95 % bootstrap CI of the mean."""
    a = np.asarray(xs, dtype=float)
    rng = np.random.default_rng(seed)
    boots = rng.choice(a, size=(n_boot, len(a)), replace=True).mean(axis=1) if len(a) > 1 else a
    return float(a.mean()), float(a.std(ddof=1)) if len(a) > 1 else 0.0, float(np.quantile(boots, 0.025)), float(np.quantile(boots, 0.975))
