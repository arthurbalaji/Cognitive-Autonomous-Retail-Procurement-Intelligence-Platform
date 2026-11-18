"""E1 + E7(a): forecasting accuracy of the platform ensemble vs baselines over several seeds, rolling origins and a real SARIMA baseline.

    python -m scripts.bench.forecast_eval --seeds 0-9 [--sarima-per-store 0]   # 0 = all series

Reads the cached forecasts written by prepare_forecasts.py (waits for them; never retrains here).
Evaluation: origins t = 120..136 (each with a full 14-day truth), all 3 x 120 pooled series. Models were trained on days < 120 only.
SARIMA(1,0,1)(1,0,1)_7 is fitted once per series on days < 120 and then re-filtered (fixed parameters) at each later origin.
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import time
import warnings

import numpy as np
from scipy import stats

from scripts.bench import _common as C
from scripts.bench import prepare_forecasts as PF

ORIGINS = list(range(C.TRAIN_END, C.N_DAYS - C.H + 1))          # 120..136
ROLL5 = [120, 124, 128, 132, 136]
MODELS = ["SARIMA", "MOVING_AVG_7", "SEASONAL_NAIVE", "LSTM", "TRANSFORMER", "XGBOOST", "ENSEMBLE"]
SINGLE = ["LSTM", "TRANSFORMER", "XGBOOST"]
H = C.H


# ----------------------------------------------------------------------------- SARIMA
def _sarima_one(args):
    p, y, origins = args
    warnings.simplefilter("ignore")
    out = np.zeros((len(origins), H), np.float32)
    if y[:C.TRAIN_END].sum() <= 0:
        return p, out, "zero"
    try:
        from statsmodels.tsa.statespace.sarimax import SARIMAX
        res = SARIMAX(y[:C.TRAIN_END].astype(float), order=(1, 0, 1), seasonal_order=(1, 0, 1, 7), trend="c",
                      enforce_stationarity=False, enforce_invertibility=False).fit(disp=False, maxiter=60)
        for i, t in enumerate(origins):
            out[i] = np.clip(res.apply(y[:t].astype(float), refit=False).forecast(H), 0, None)
        return p, out, "ok"
    except Exception as e:  # noqa: BLE001
        for i, t in enumerate(origins):      # fallback: 7-day moving average, flagged
            out[i] = y[t - 7:t].mean()
        return p, out, f"fallback:{type(e).__name__}"


def sarima_forecasts(units: np.ndarray, series: list[int], procs: int) -> tuple[np.ndarray, dict]:
    jobs = [(p, units[p], ORIGINS) for p in series]
    preds = np.zeros((len(ORIGINS), units.shape[0], H), np.float32)
    status: dict[str, int] = {}
    with mp.get_context("fork").Pool(procs) as pool:
        for p, out, st in pool.imap_unordered(_sarima_one, jobs, chunksize=4):
            preds[:, p, :] = out
            status[st.split(":")[0]] = status.get(st.split(":")[0], 0) + 1
    return preds, status


# ----------------------------------------------------------------------------- stats helpers
def dm_timeseries(l_a: np.ndarray, l_b: np.ndarray, h: int) -> dict:
    """Classic DM on an origin-indexed loss differential (HAC, lag h-1) with the Harvey-Leybourne-Newbold small-sample correction."""
    d = l_a - l_b
    n = len(d)
    dbar = d.mean()
    gam = [np.sum((d[k:] - dbar) * (d[:n - k] - dbar)) / n for k in range(h)]
    var = (gam[0] + 2 * sum(gam[1:])) / n
    if var <= 0:
        return {"dm": None, "p": None, "n": n}
    dm = dbar / np.sqrt(var)
    corr = (n + 1 - 2 * h + h * (h - 1) / n) / n
    if corr <= 0:
        return {"dm": None, "p": None, "n": n}
    dm_star = dm * np.sqrt(corr)
    return {"dm": float(dm_star), "p": float(2 * stats.t.sf(abs(dm_star), n - 1)), "n": n}


def dm_cross(l_a: np.ndarray, l_b: np.ndarray) -> dict:
    """Cross-sectional DM: one loss differential per series (averaged over origins and horizon steps); t-test over series."""
    d = (l_a - l_b)
    t = stats.ttest_1samp(d, 0.0)
    return {"mean_diff": float(d.mean()), "t": float(t.statistic), "p": float(t.pvalue), "n": int(len(d)), "a_better_share": float((d < 0).mean())}


# ----------------------------------------------------------------------------- main
def wait_for(seed: int, vol: float, timeout_min: float) -> None:
    p = PF.path(seed, vol).replace(".npz", ".json")
    t0 = time.time()
    while not os.path.exists(p):
        if time.time() - t0 > timeout_min * 60:
            raise TimeoutError(f"forecast cache for seed {seed} not produced within {timeout_min} min")
        time.sleep(20)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="0-9")
    ap.add_argument("--sarima-per-store", type=int, default=0, help="0 = all 120 series per store, else a fixed subset (first N non-intermittent-sampled)")
    ap.add_argument("--procs", type=int, default=3)
    ap.add_argument("--wait-min", type=float, default=90)
    a = ap.parse_args()
    seeds = PF.parse_seeds(a.seeds)
    t_start = time.time()
    per_seed: dict[int, dict] = {}
    for seed in seeds:
        wait_for(seed, 0.0, a.wait_min)
        time.sleep(2)
        z = PF.ensure(seed, 0.0)
        w = z.pop("world")
        units = w.pooled
        P = w.P
        n_s = units.shape[0]
        truth, _ = C.truth(units, ORIGINS)                                 # (17, n_s, H)
        pred = {k: z[k][:len(ORIGINS)] for k in ("LSTM", "TRANSFORMER", "XGBOOST", "ENSEMBLE")}
        pred.update(C.baselines(units, ORIGINS))
        # SARIMA (all series, or a fixed subset per store)
        if a.sarima_per_store and a.sarima_per_store < P:
            rng = np.random.default_rng(1000 + seed)
            subset = sorted(int(s * P + p) for s in range(C.N_STORES) for p in rng.choice(P, a.sarima_per_store, replace=False))
        else:
            subset = list(range(n_s))
        t0 = time.time()
        pred["SARIMA"], st = sarima_forecasts(units, subset, a.procs)
        sar_s = round(time.time() - t0, 1)
        mask = np.zeros(n_s, bool)
        mask[subset] = True
        cats = np.array(w.cats)
        peri = cats == "FOOD_BEVERAGE"
        rec: dict = {"sarima_seconds": sar_s, "sarima_status": st, "n_series": n_s, "n_sarima_series": len(subset)}

        def sc(model: str, sel: np.ndarray, origins_idx=None) -> dict:
            oi = list(range(len(ORIGINS))) if origins_idx is None else origins_idx
            return C.score(truth[oi][:, sel, :], pred[model][oi][:, sel, :])

        rec["all"] = {m: sc(m, np.ones(n_s, bool)) for m in MODELS if m != "SARIMA"}
        rec["sarima_subset"] = {m: sc(m, mask) for m in MODELS}
        rec["perishable"] = {m: sc(m, peri & mask) for m in MODELS}
        rec["non_perishable"] = {m: sc(m, ~peri & mask) for m in MODELS}
        rec["rolling"] = {str(t): {m: sc(m, mask, [ORIGINS.index(t)])["mae"] for m in MODELS} for t in ROLL5}
        lo, hi = z["LO"][:len(ORIGINS)], z["HI"][:len(ORIGINS)]
        rec["band80"] = {"coverage_pct": round(float(((truth >= lo) & (truth <= hi)).mean() * 100), 2),
                         "coverage_pct_demand_days": round(float(((truth >= lo) & (truth <= hi))[truth > 0].mean() * 100), 2),
                         "mean_width_units": round(float((hi - lo).mean()), 3)}
        # loss tensors for DM tests (on the SARIMA subset so all models are comparable)
        def loss(m: str, kind: str) -> np.ndarray:
            e = (pred[m][:, mask, :] - truth[:, mask, :])
            return (e ** 2 if kind == "sq" else np.abs(e))
        best_single = min(SINGLE, key=lambda m: rec["sarima_subset"][m]["mae"])
        rec["best_single"] = best_single
        rec["dm"] = {}
        for other in ("SARIMA", best_single, "MOVING_AVG_7"):
            for kind in ("sq", "abs"):
                la, lb = loss("ENSEMBLE", kind), loss(other, kind)
                rec["dm"][f"ENSEMBLE_vs_{other}_{kind}"] = {
                    "cross_section": dm_cross(la.mean(axis=(0, 2)), lb.mean(axis=(0, 2))),
                    "timeseries_hac": dm_timeseries(la.mean(axis=(1, 2)), lb.mean(axis=(1, 2)), H)}
        per_seed[seed] = rec
        # keep per-series mean losses for the seed-level pooling
        rec["_loss"] = {f"{m}_{k}": loss(m, k).mean() for m in MODELS for k in ("sq", "abs")}
        print(f"[seed {seed}] SARIMA {sar_s}s {st}  MAE(all)  " + "  ".join(f"{m}={rec['all'][m]['mae']}" for m in rec["all"]) +
              f"  SARIMA(sub)={rec['sarima_subset']['SARIMA']['mae']}  elapsed {time.time() - t_start:.0f}s", flush=True)

    # ---------------------------------------------------------------- aggregate over seeds
    def agg(key: str, metric: str, models=MODELS) -> dict:
        out = {}
        for m in models:
            vals = [per_seed[s][key][m][metric] for s in seeds if per_seed[s][key].get(m, {}).get(metric) is not None]
            if vals:
                mean, sd, lo, hi = C.mean_ci(vals)
                out[m] = {"mean": round(mean, 4), "std": round(sd, 4), "ci95": [round(lo, 4), round(hi, 4)], "n": len(vals)}
        return out

    metrics = ("mae", "rmse", "mape", "smape", "wape")
    summary = {
        "sarima_subset": {mt: agg("sarima_subset", mt) for mt in metrics},
        "all_series_no_sarima": {mt: agg("all", mt, [m for m in MODELS if m != "SARIMA"]) for mt in metrics},
        "perishable": {mt: agg("perishable", mt) for mt in ("mae", "wape")},
        "non_perishable": {mt: agg("non_perishable", mt) for mt in ("mae", "wape")},
    }
    roll = {}
    for t in ROLL5:
        roll[str(t)] = {m: round(float(np.mean([per_seed[s]["rolling"][str(t)][m] for s in seeds])), 4) for m in MODELS}
    cov = [per_seed[s]["band80"]["coverage_pct"] for s in seeds]
    cov_d = [per_seed[s]["band80"]["coverage_pct_demand_days"] for s in seeds]
    wid = [per_seed[s]["band80"]["mean_width_units"] for s in seeds]
    band = {"coverage_pct": dict(zip(("mean", "std", "lo", "hi"), map(lambda x: round(x, 3), C.mean_ci(cov)))),
            "coverage_pct_demand_days": dict(zip(("mean", "std", "lo", "hi"), map(lambda x: round(x, 3), C.mean_ci(cov_d)))),
            "mean_width_units": round(float(np.mean(wid)), 3)}
    # seed-level paired tests (loss averaged over series, origins and horizon)
    seed_dm = {}
    sm = summary["sarima_subset"]["mae"]
    best_single_overall = min(SINGLE, key=lambda m: sm[m]["mean"])
    for other in ("SARIMA", best_single_overall, "MOVING_AVG_7"):
        for kind in ("sq", "abs"):
            a_ = np.array([per_seed[s]["_loss"][f"ENSEMBLE_{kind}"] for s in seeds])
            b_ = np.array([per_seed[s]["_loss"][f"{other}_{kind}"] for s in seeds])
            d = a_ - b_
            tt = stats.ttest_1samp(d, 0.0) if len(d) > 1 else None
            try:
                wp = float(stats.wilcoxon(d).pvalue) if len(d) > 5 else None
            except ValueError:
                wp = None
            seed_dm[f"ENSEMBLE_vs_{other}_{kind}"] = {"mean_diff": float(d.mean()), "t": None if tt is None else float(tt.statistic),
                                                      "p_ttest": None if tt is None else float(tt.pvalue), "p_wilcoxon": wp,
                                                      "ensemble_better_in_seeds": int((d < 0).sum()), "n_seeds": len(d)}
    for s in seeds:
        per_seed[s].pop("_loss")
    rel = {}
    for m in MODELS:
        if m != "ENSEMBLE":
            rel[m] = round((1 - sm["ENSEMBLE"]["mean"] / sm[m]["mean"]) * 100, 2)
    result = {"seeds": seeds, "origins": [ORIGINS[0], ORIGINS[-1]], "n_origins": len(ORIGINS), "horizon": H, "series": 3 * 120,
              "training_region_days": C.TRAIN_END, "ensemble_mae_reduction_pct_vs": rel, "summary": summary, "rolling_mae_mean_over_seeds": roll,
              "band80": band, "best_single_member": best_single_overall, "dm_seed_level": seed_dm, "per_seed": per_seed,
              "hardware": C.hardware(), "elapsed_s": round(time.time() - t_start, 1),
              "sarima": {"spec": "SARIMAX(1,0,1)(1,0,1,7), trend=c, fixed parameters re-filtered at each origin",
                         "series_per_seed": per_seed[seeds[0]]["n_sarima_series"], "status_per_seed": {s: per_seed[s]["sarima_status"] for s in seeds}}}
    C.save_json("forecast_eval.json", result)
    write_md(result)
    print("wrote forecast_eval.json / .md", flush=True)


def fmt(d: dict, nd=2) -> str:
    return f"{d['mean']:.{nd}f} ± {d['std']:.{nd}f}"


def write_md(r: dict) -> None:
    S = r["summary"]["sarima_subset"]
    L = [f"# E1/E7a - Forecast accuracy ({len(r['seeds'])} seeds, rolling origins)", "",
         f"Synthetic Dunnhumby-shaped data: 120 SKUs x 3 stores x 150 days per seed (deterministic generator, seeds {r['seeds'][0]}-{r['seeds'][-1]}). "
         f"Models trained on days 0-119 only (chronological 80/20 split, train-only scaling, early stopping, platform hyper-parameters: LSTM 64-32, Transformer 2 layers/4 heads, XGBoost 120 trees; epochs 12/10 max). "
         f"Evaluation: {r['n_origins']} daily forecast origins (days {r['origins'][0]}-{r['origins'][1]}), horizon {r['horizon']} days, {r['series']} pooled series; every figure is mean ± std over seeds. "
         f"SARIMA: {r['sarima']['spec']}, fitted on {r['sarima']['series_per_seed']} series per seed (status {r['sarima']['status_per_seed'][r['seeds'][0]]}). "
         "MAPE is computed only on days with actual demand > 0 (count data, so it is large; WAPE = sum|err| / sum(actual) is the more robust figure).", "",
         "## Table 1.1 source - all models on the same series", "",
         "| Model | MAE (units) | RMSE (units) | MAPE (%) | sMAPE (%) | WAPE (%) |", "|---|---|---|---|---|---|"]
    for m in MODELS:
        L.append(f"| {m} | {fmt(S['mae'][m], 3)} | {fmt(S['rmse'][m], 3)} | {fmt(S['mape'][m], 1)} | {fmt(S['smape'][m], 1)} | {fmt(S['wape'][m], 1)} |")
    L += ["", "95 % bootstrap CI of the mean MAE: " + "; ".join(f"{m} [{S['mae'][m]['ci95'][0]:.3f}, {S['mae'][m]['ci95'][1]:.3f}]" for m in MODELS), "",
          "Ensemble MAE reduction vs: " + ", ".join(f"{k} {v:+.1f} %" for k, v in r["ensemble_mae_reduction_pct_vs"].items()), "",
          "## Perishable (FOOD_BEVERAGE) vs other categories (MAE / WAPE %)", "", "| Model | perishable MAE | perishable WAPE | other MAE | other WAPE |", "|---|---|---|---|---|"]
    for m in MODELS:
        pm, pn = r["summary"]["perishable"], r["summary"]["non_perishable"]
        L.append(f"| {m} | {fmt(pm['mae'][m], 3)} | {fmt(pm['wape'][m], 1)} | {fmt(pn['mae'][m], 3)} | {fmt(pn['wape'][m], 1)} |")
    L += ["", "## Rolling-origin MAE (mean over seeds)", "", "| Origin day | " + " | ".join(MODELS) + " |", "|---|" + "---|" * len(MODELS)]
    for t, row in r["rolling_mae_mean_over_seeds"].items():
        L.append(f"| {t} | " + " | ".join(f"{row[m]:.3f}" for m in MODELS) + " |")
    b = r["band80"]
    L += ["", "## 80 % prediction band (residual quantiles of the ensemble)", "",
          f"Empirical coverage {b['coverage_pct']['mean']:.1f} ± {b['coverage_pct']['std']:.1f} % (nominal 80 %); on days with demand > 0: {b['coverage_pct_demand_days']['mean']:.1f} %; mean width {b['mean_width_units']} units.", "",
          f"## Diebold-Mariano style tests (best single member = {r['best_single_member']})", "",
          "Seed-level paired test: loss differential (Ensemble minus other) averaged over series, origins and horizon, one value per seed. Negative = ensemble better.", "",
          "| Comparison | loss | mean diff | t | p (t-test) | p (Wilcoxon) | ensemble better in |", "|---|---|---|---|---|---|---|"]
    def f4(x, nd=4):
        return "n/a" if x is None else f"{x:.{nd}f}"

    for k, v in r["dm_seed_level"].items():
        loss_name = "squared" if k.endswith("sq") else "absolute"
        L.append(f"| {k.rsplit('_', 1)[0]} | {loss_name} | {v['mean_diff']:.4f} | {f4(v['t'], 2)} | {f4(v['p_ttest'])} | {f4(v['p_wilcoxon'])} | "
                 f"{v['ensemble_better_in_seeds']}/{v['n_seeds']} seeds |")
    L += ["", "Per-seed cross-sectional DM (one loss differential per series, t-test over 120x3 series) and the classic time-series DM with the Harvey correction (17 overlapping origins, h=14, so it is low-powered and often undefined) are in `forecast_eval.json` under `per_seed[*].dm`.", "",
          f"Hardware: {r['hardware']}", f"Run time: {r['elapsed_s']} s"]
    with open(os.path.join(C.OUT, "forecast_eval.md"), "w", encoding="utf8") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
