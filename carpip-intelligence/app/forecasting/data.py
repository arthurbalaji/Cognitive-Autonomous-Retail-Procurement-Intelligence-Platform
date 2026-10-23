"""Sales history -> supervised windows. Chronological 80/20 split, scalers fit on the TRAIN region only (no look-ahead)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from .. import db
from ..config import settings

CAT_CODES = {"ELECTRONICS": 0, "FOOD_BEVERAGE": 1, "OFFICE": 2, "LIFESTYLE": 3}


@dataclass
class Panel:
    product_ids: list[str]
    gtins: list[str | None]
    categories: list[str]
    units: np.ndarray            # (P, D) raw daily units, zero-filled
    start: date
    end: date                    # last day with data (yesterday at most)
    split_day: int               # index of first validation day

    @property
    def n_days(self) -> int:
        return self.units.shape[1]


def load_panel(tenant_id: str, history_days: int = 400) -> Panel | None:
    prods = db.rows("SELECT id::text AS id, gtin, category FROM product WHERE tenant_id = CAST(:t AS uuid) AND active ORDER BY id", t=tenant_id)
    if not prods:
        return None
    rows = db.rows("""SELECT product_id::text AS id, day, units FROM sales_daily
                      WHERE tenant_id = CAST(:t AS uuid) AND day >= current_date - :d AND day < current_date""", t=tenant_id, d=history_days)
    if not rows:
        return None
    start = min(r["day"] for r in rows)
    end = max(r["day"] for r in rows)
    n = (end - start).days + 1
    idx = {p["id"]: i for i, p in enumerate(prods)}
    units = np.zeros((len(prods), n), dtype=np.float32)
    for r in rows:
        i = idx.get(r["id"])
        if i is not None:
            units[i, (r["day"] - start).days] = max(float(r["units"]), 0.0)
    return Panel([p["id"] for p in prods], [p["gtin"] for p in prods], [p["category"] for p in prods], units, start, end, int(n * 0.8))


def dow_features(start: date, n_days: int) -> np.ndarray:
    d = np.array([(start + timedelta(days=i)).weekday() for i in range(n_days)], dtype=np.float32)
    return np.stack([np.sin(2 * np.pi * d / 7), np.cos(2 * np.pi * d / 7)], axis=1)   # (D, 2)


def fit_scales(units: np.ndarray, split_day: int) -> np.ndarray:
    """Per-product MinMax scale (min is 0): max over the TRAIN region only. Floor of 1 to avoid division by ~0."""
    return np.maximum(units[:, :split_day].max(axis=1), 1.0)


def make_windows(units: np.ndarray, scales: np.ndarray, dow: np.ndarray, window: int, horizon: int, t_from: int, t_to: int,
                 active: np.ndarray | None = None):
    """Windows whose target block [t, t+H) lies fully inside [t_from, t_to).  x: (N, W, 3)  y: (N, H) scaled."""
    xs, ys, meta = [], [], []
    P, D = units.shape
    scaled = units / scales[:, None]
    for p in range(P):
        if active is not None and not active[p]:
            continue
        for t in range(max(window, t_from), t_to - horizon + 1):
            xs.append(np.concatenate([scaled[p, t - window:t, None], dow[t - window:t]], axis=1))
            ys.append(scaled[p, t:t + horizon])
            meta.append((p, t))
    if not xs:
        return np.zeros((0, window, 3), np.float32), np.zeros((0, horizon), np.float32), []
    return np.asarray(xs, dtype=np.float32), np.asarray(ys, dtype=np.float32), meta


def last_window(units: np.ndarray, scales: np.ndarray, dow_all: np.ndarray, window: int) -> np.ndarray:
    """Input for inference: the final `window` days of every product. dow_all covers the same D days."""
    scaled = units / scales[:, None]
    D = units.shape[1]
    return np.stack([np.concatenate([scaled[p, D - window:, None], dow_all[D - window:]], axis=1) for p in range(units.shape[0])]).astype(np.float32)


def tabular(units: np.ndarray, scales: np.ndarray, cats: list[str], start: date, meta: list[tuple[int, int]]) -> np.ndarray:
    """Hand-built features for XGBoost: lags 1..7,14,21,28, rolling mean 7/14/28, std 7, dow of target day, category, log scale."""
    scaled = units / scales[:, None]
    rows = []
    for p, t in meta:
        s = scaled[p]
        lag = [s[t - k] if t - k >= 0 else 0.0 for k in (1, 2, 3, 4, 5, 6, 7, 14, 21, 28)]
        m7, m14, m28 = s[max(t - 7, 0):t].mean(), s[max(t - 14, 0):t].mean(), s[max(t - 28, 0):t].mean()
        sd7 = s[max(t - 7, 0):t].std()
        rows.append(lag + [m7, m14, m28, sd7, (start + timedelta(days=t)).weekday(), CAT_CODES.get((cats[p] or "").upper(), 3), float(np.log1p(scales[p]))])
    return np.asarray(rows, dtype=np.float32) if rows else np.zeros((0, 17), np.float32)


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """MAE, RMSE (units), MAPE over days with actual > 0 only, plus sMAPE."""
    if y_true.size == 0:
        return {"mae": None, "rmse": None, "mape": None, "smape": None}
    err = y_pred - y_true
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    nz = y_true > 0
    mape = float(np.mean(np.abs(err[nz]) / y_true[nz]) * 100) if nz.any() else None
    denom = (np.abs(y_true) + np.abs(y_pred))
    smape = float(np.mean(np.where(denom > 0, 2 * np.abs(err) / np.where(denom == 0, 1, denom), 0)) * 100)
    return {"mae": round(mae, 4), "rmse": round(rmse, 4), "mape": None if mape is None else round(mape, 3), "smape": round(smape, 3)}
