"""Coarse per-product demand-growth ratios shared by a CDIN node (the only demand signal that leaves the node besides LSTM weights).

Sales velocity = mean(last 7 days) / mean(previous 28 days), clipped to [0.5, 2] and bucketed to 0.05; products with a recent
14-day mean below 0.5 units/day are not reported. The first prototype computed forecast/recent-sales instead; a forecast model
mean-reverts after a spike, so that ratio FELL when real demand surged (see docs/results/cdin_scale_eval.md), hence this definition.
"""
from __future__ import annotations

import numpy as np

RECENT_DAYS, PREV_DAYS, MIN_MEAN = 7, 28, 0.5


def velocity_growth(units: np.ndarray, gtins: list[str | None]) -> dict[str, float]:
    """units: (products, days) raw daily units, last column = most recent day. Returns {gtin: bucketed ratio}."""
    out: dict[str, float] = {}
    if units.shape[1] < RECENT_DAYS + PREV_DAYS:
        return out
    last = units[:, -RECENT_DAYS:].mean(axis=1)
    prev = units[:, -(RECENT_DAYS + PREV_DAYS):-RECENT_DAYS].mean(axis=1)
    recent14 = units[:, -14:].mean(axis=1)
    for i, g in enumerate(gtins):
        if g is None or recent14[i] < MIN_MEAN:
            continue
        ratio = float(np.clip(last[i] / max(float(prev[i]), 1e-9), 0.5, 2.0))
        out[g] = round(round(ratio / 0.05) * 0.05, 2)
    return out
