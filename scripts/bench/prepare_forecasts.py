"""Train the platform's forecasting ensemble once per (seed, volatility) world and cache the 30 daily-origin forecasts.

    python prepare_forecasts.py --seeds 0-4 [--vol 0.0]

Cache: /cache/fc_seed{S}_vol{V}.npz  with  LSTM/TRANSFORMER/XGBOOST/ENSEMBLE/LO/HI  (30 origins x 3P series x 14 days, units)
plus weights/val metrics in the sidecar .json. Reused by forecast_eval.py, cdin_eval.py and procurement_sim.py.
"""
from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np

from scripts.bench import _common as C

ORIGINS = list(range(C.TRAIN_END, C.N_DAYS))     # one forecast per day of the evaluation window


def path(seed: int, vol: float) -> str:
    return os.path.join(C.CACHE, f"fc_seed{seed}_vol{vol}.npz")


def parse_seeds(s: str) -> list[int]:
    if "-" in s:
        a, b = s.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in s.split(",")]


def ensure(seed: int, vol: float = 0.0, log=print) -> dict:
    p = path(seed, vol)
    w = C.build_world(seed, vol)
    if os.path.exists(p):
        z = np.load(p)
        return {k: z[k] for k in z.files} | {"world": w}
    os.makedirs(C.CACHE, exist_ok=True)
    log(f"[seed {seed} vol {vol}] training")
    m = C.train_ensemble(w.pooled, w.cats, seed, log=log)
    pr = C.predict_origins(m, w.pooled, w.cats, ORIGINS)
    np.savez_compressed(p, **pr)
    with open(p.replace(".npz", ".json"), "w") as f:
        json.dump({"weights": m["weights"], "val_mae": m["val_mae"], "epochs": m["epochs"], "train_windows": m["train_windows"],
                   "val_windows": m["val_windows"], "train_seconds": m["train_seconds"], "q10": m["q10"].tolist(), "q90": m["q90"].tolist()}, f)
    return pr | {"world": w}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="0-4")
    ap.add_argument("--vol", type=float, nargs="+", default=[0.0])
    a = ap.parse_args()
    t0 = time.time()
    for v in a.vol:
        for s in parse_seeds(a.seeds):
            ensure(s, v)
            print(f"done seed {s} vol {v}  elapsed {time.time() - t0:.0f}s", flush=True)
