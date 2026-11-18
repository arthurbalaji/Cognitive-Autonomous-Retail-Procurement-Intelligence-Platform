"""12-store, 210-day synthetic world for the larger CDIN test (deterministic per seed).

Same demand model as scripts/datagen/generate.history (weekly seasonality, slow trends, two promotions per SKU, Poisson noise) but:
  * 12 stores with log-normal(0, 0.25) store scales (non-IID), no built-in surge;
  * a planted regional precursor on 16 non-intermittent SKUs (lam > 2): 4 'early' stores ramp x1 -> x2 over days 160-180 and stay at x2,
    8 'late' stores ramp x1 -> x2 over days 180-200 (20 days later) and stay at x2 until day 209 (a 30-day surge window).
Models are trained on days [0, 150) only.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from scripts.datagen import generate as G

N_STORES, N_DAYS, TRAIN_END = 12, 210, 150
PRECURSOR_START, LATE_START, RAMP_LEN, MULT = 160, 180, 20, 2.0
N_SURGE, N_EARLY = 16, 4
END = date(2026, 10, 31)
START = END - timedelta(days=N_DAYS - 1)


@dataclass
class World12:
    seed: int
    catalog: list
    hist: np.ndarray            # (12, P, 210) integer units
    ramp: np.ndarray            # (12, P, 210) true demand multiplier (1 outside the surge)
    surge_idx: list[int]
    early: list[int]
    late: list[int]

    @property
    def P(self) -> int:
        return len(self.catalog)

    @property
    def surge_mask(self) -> np.ndarray:
        m = np.zeros(self.P, bool)
        m[self.surge_idx] = True
        return m


def ramp_curve(start: int) -> np.ndarray:
    t = np.arange(N_DAYS)
    return np.where(t < start, 1.0, np.where(t >= start + RAMP_LEN, MULT, 1.0 + (MULT - 1.0) * (t - start) / RAMP_LEN))


def build(seed: int, n_sku: int = 120) -> World12:
    cat = G.build_catalog(n_sku, seed)
    rng = np.random.default_rng(seed * 7919 + 11)
    scale = rng.lognormal(0.0, 0.25, N_STORES)
    perm = rng.permutation(N_STORES)
    early, late = sorted(int(x) for x in perm[:N_EARLY]), sorted(int(x) for x in perm[N_EARLY:])
    base = [p.idx for p in cat if p.surge]
    cand = [p.idx for p in cat if (not p.intermittent) and p.lam > 2.0 and not p.surge]
    extra = [int(x) for x in rng.permutation(cand)][: max(N_SURGE - len(base), 0)]
    surge_idx = sorted((base + extra)[:N_SURGE])
    dates = [START + timedelta(days=i) for i in range(N_DAYS)]
    dow = np.array([G.DOW[d.weekday()] for d in dates])
    P = len(cat)
    hist = np.zeros((N_STORES, P, N_DAYS), dtype=np.int64)
    ramp = np.ones((N_STORES, P, N_DAYS))
    for s in range(N_STORES):
        r = np.random.default_rng(seed * 1009 + 100 + s)
        start = PRECURSOR_START if s in early else LATE_START
        curve = ramp_curve(start)
        for p in cat:
            trend = 1.0 + np.linspace(-0.10, 0.10, N_DAYS) * r.choice([-1, 1])
            promo = np.ones(N_DAYS)
            for _ in range(2):
                st = int(r.integers(5, N_DAYS - 8))
                promo[st:st + int(r.integers(3, 6))] = 1.6
            mean = p.lam * scale[s] * dow * trend * promo
            if p.idx in surge_idx:
                ramp[s, p.idx] = curve
                mean = mean * curve
            hist[s, p.idx] = r.poisson(np.maximum(mean, 0))
    return World12(seed, cat, hist, ramp, surge_idx, early, late)
