"""E7c - a fairer CDIN test: 12 nodes, 210 days, a 30-day regional surge window, two growth definitions for the regional demand index.

    python -m scripts.bench.cdin_scale_eval --seeds 0-4

LOCAL vs FEDERATED LSTM (in-process replica of coordinator.aggregate + cdin_node, FedProx/FedAvg, share cap) at 12 nodes;
regional demand index (RDI) early warning with the PLATFORM growth definition (A: forecast/recent actual) and the SALES-VELOCITY definition
(B: last 7 d / previous 28 d); effect of the RDI forecast uplift on the late stores; transparent replenishment simulation.
"""
from __future__ import annotations

import argparse
import math
import os
import time
import warnings

import numpy as np
import torch
from scipy import stats

from app.config import settings
from app.forecasting import data as D
from app.forecasting import models as M
from scripts.bench import _common as C
from scripts.bench import world12 as Wd
from scripts.bench.prepare_forecasts import parse_seeds

warnings.filterwarnings("ignore", category=RuntimeWarning)
W, H = C.W, C.H
NS, ND, TR = Wd.N_STORES, Wd.N_DAYS, Wd.TRAIN_END
DOW = D.dow_features(Wd.START, ND)
T_ALL = list(range(TR, ND))                    # 150..209 daily origins (60)
T_ACC = list(range(TR, ND - H + 1))            # 150..196 origins with a full 14-day truth
T_PRE = [t for t in T_ACC if t < Wd.PRECURSOR_START]
T_UPL = list(range(168, ND - H + 1))           # 168..196: late stores in (or entering) the surge, truth inside the data
T_SIM = list(range(168, ND))                   # 168..209 replenishment simulation
RDI_THR = 0.6
VARIANTS = ["none", "A", "A3", "B", "oracle"]
VNAME = {"none": "no CDIN", "A": "A: platform growth, local LSTM", "A3": "A': platform growth, round-3 node model", "B": "B: sales velocity (last7/prev28)", "oracle": "oracle (true ramp)"}
L_LEAD, R_REV = 3, 7


class Node:
    def __init__(self, units: np.ndarray):
        self.units = units.astype(np.float32)
        tr = self.units[:, :TR]
        self.split = int(TR * 0.8)
        self.scales = D.fit_scales(tr, self.split)                         # local scaler, never shared
        active = tr[:, :self.split].sum(axis=1) > 0
        self.xtr, self.ytr, _ = D.make_windows(tr, self.scales, DOW, W, H, 0, self.split, active)
        self.xva, self.yva, _ = D.make_windows(tr, self.scales, DOW, W, H, self.split, TR, active)

    def predict(self, model, origins: list[int]) -> np.ndarray:
        x, _ = C.origin_inputs(self.units, self.scales, DOW, origins)
        p = M.predict(model, x).reshape(len(origins), self.units.shape[0], H)
        return np.clip(p, 0, None) * self.scales[None, :, None]


def state_bytes(model) -> int:
    return sum(v.numel() * 4 for v in model.state_dict().values())


def fedavg(states: list[dict], samples: list[int], cap: float) -> tuple[dict, list[float]]:
    share = np.array(samples, dtype=float)
    share = share / share.sum()
    if len(share) > 1 and share.max() > cap:
        over = share > cap
        free = 1.0 - cap * over.sum()
        rest = share[~over].sum()
        share = np.where(over, cap, share / rest * free if rest > 0 else 0.0)
    return {k: sum(float(sh) * st[k].float() for sh, st in zip(share, states)) for k in states[0]}, share.tolist()


# ----------------------------------------------------------------------------- RDI
def bucket(r: np.ndarray) -> np.ndarray:
    return np.round(np.round(r / 0.05) * 0.05, 2)


def growth_A(nodes: list[Node], fc: list[np.ndarray]) -> np.ndarray:
    """(NS, 60, P): platform definition, forecast next-14-day mean / last-14-day actual mean."""
    out = np.full((NS, len(T_ALL), nodes[0].units.shape[0]), np.nan)
    for s, n in enumerate(nodes):
        for oi, t in enumerate(T_ALL):
            recent = n.units[:, t - 14:t].mean(axis=1)
            r = bucket(np.clip(fc[s][oi, :, :14].mean(axis=1) / np.maximum(recent, 1e-9), 0.5, 2.0))
            out[s, oi] = np.where(recent >= 0.5, r, np.nan)
    return out


def growth_B(nodes: list[Node]) -> np.ndarray:
    """(NS, 60, P): sales velocity, mean(last 7 d) / mean(previous 28 d)."""
    out = np.full((NS, len(T_ALL), nodes[0].units.shape[0]), np.nan)
    for s, n in enumerate(nodes):
        for oi, t in enumerate(T_ALL):
            recent = n.units[:, t - 14:t].mean(axis=1)
            r = bucket(np.clip(n.units[:, t - 7:t].mean(axis=1) / np.maximum(n.units[:, t - 35:t - 7].mean(axis=1), 1e-9), 0.5, 2.0))
            out[s, oi] = np.where(recent >= 0.5, r, np.nan)
    return out


def rdi_of(growth: np.ndarray) -> np.ndarray:
    """(60, P): equal node weights, published only when >= 2 nodes report (k-anonymity)."""
    n = (~np.isnan(growth)).sum(axis=0)
    with np.errstate(all="ignore"):
        mean_g = np.nanmean(growth, axis=0)
    return np.where(n >= 2, np.clip(0.5 + 0.5 * np.tanh(3.0 * (mean_g - 1.0)), 0, 1), np.nan)


def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    r = stats.rankdata(np.concatenate([pos, neg]))
    return float((r[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def first_run(above: np.ndarray, k: int) -> int:
    """index of the first run of >= k consecutive True values (above is 1-D); -1 when none."""
    run = 0
    for i, v in enumerate(above):
        run = run + 1 if v else 0
        if run >= k:
            return i - k + 1
    return -1


def warning_metrics(rdi: np.ndarray, surge: np.ndarray, thr: float = RDI_THR) -> dict:
    T = np.array(T_ALL)
    above = np.nan_to_num(rdi, nan=0.0) > thr
    pub = ~np.isnan(rdi)
    post = T >= Wd.PRECURSOR_START
    pre = ~post
    sidx = np.nonzero(surge)[0]
    nidx = np.nonzero(~surge)[0]
    published_s = pub[:, sidx].any(axis=0)

    def detect(k: int):
        days = []
        for j, p in enumerate(sidx):
            if not published_s[j]:
                continue
            i = first_run(above[post, p], k)
            days.append(int(T[post][i]) if i >= 0 else -1)
        return days
    out: dict = {"surge_skus": int(len(sidx)), "surge_published": int(published_s.sum())}
    for name, k in (("first", 1), ("sustained3", 3)):
        days = detect(k)
        hit = [d for d in days if d >= 0]
        out[f"detected_share_{name}"] = len(hit) / max(len(days), 1)
        out[f"lead_days_{name}"] = [Wd.LATE_START - d for d in hit]                       # days before the late stores' surge starts
        out[f"delay_days_{name}"] = [d - Wd.PRECURSOR_START for d in hit]
    out["spurious_surge_before_precursor"] = float(np.mean([above[pre, p].any() for j, p in enumerate(sidx) if published_s[j]])) if published_s.any() else float("nan")
    pub_n = pub[:, nidx].any(axis=0)
    out["fp_nonsurge_sku_share_post"] = float(np.mean([above[post, p].any() for j, p in enumerate(nidx) if pub_n[j]]))
    out["fp_nonsurge_sku_share_whole"] = float(np.mean([above[:, p].any() for j, p in enumerate(nidx) if pub_n[j]]))
    out["fp_nonsurge_skuday_share_pre"] = float(above[np.ix_(pre, nidx)].sum() / max(pub[np.ix_(pre, nidx)].sum(), 1))
    out["fp_nonsurge_skuday_share_post"] = float(above[np.ix_(post, nidx)].sum() / max(pub[np.ix_(post, nidx)].sum(), 1))
    win = (T >= 170) & (T <= 179)
    sc = lambda idx: np.nan_to_num(np.nanmean(np.where(pub[np.ix_(win, idx)], rdi[np.ix_(win, idx)], np.nan), axis=0), nan=0.5)   # noqa: E731
    out["auc_surge_vs_other_days170_179"] = auc(sc(sidx), sc(nidx))
    traj = {}
    for d in (150, 159, 165, 170, 175, 180, 190, 200, 209):
        i = d - TR
        traj[d] = {"surge": float(np.nanmean(rdi[i, sidx])) if (~np.isnan(rdi[i, sidx])).any() else None,
                   "other": float(np.nanmean(rdi[i, nidx])) if (~np.isnan(rdi[i, nidx])).any() else None}
    out["trajectory"] = traj
    return out


# ----------------------------------------------------------------------------- uplift and replenishment
def uplift_of(rdi: np.ndarray | None, origins: list[int]) -> np.ndarray:
    """(len(origins), P) multiplicative uplift (platform rule); 1 where no RDI is published."""
    P = rdi.shape[1]
    out = np.ones((len(origins), P))
    for k, t in enumerate(origins):
        r = rdi[t - TR]
        out[k] = np.where(np.isnan(r), 1.0, np.clip(1.0 + 0.6 * (r - 0.5), 0.8, 1.3))
    return out


def oracle_uplift(w: Wd.World12, s: int, origins: list[int]) -> np.ndarray:
    out = np.ones((len(origins), w.P))
    for k, t in enumerate(origins):
        out[k] = np.clip(w.ramp[s, :, t:t + H].mean(axis=1) / np.maximum(w.ramp[s, :, t - 14:t].mean(axis=1), 1e-9), 0.8, 1.3)
    return out


def simulate_store(units: np.ndarray, fc: np.ndarray, u: np.ndarray) -> dict:
    """fc: (60, P, H) base forecast per origin day; u: (len(T_SIM), P) uplift. Per-SKU order-up-to policy over days 168..209."""
    P = units.shape[0]
    res = {"so_days": np.zeros(P), "dem_days": np.zeros(P), "lost": np.zeros(P), "demand": np.zeros(P), "stock_sum": np.zeros(P)}
    for p in range(P):
        stock = int(round(14 * units[p, 140:168].mean()))
        pipe: list[tuple[int, int]] = []
        for k, t in enumerate(T_SIM):
            stock += sum(q for a, q in pipe if a <= t)
            pipe = [(a, q) for a, q in pipe if a > t]
            f = fc[t - TR, p] * u[k, p]
            sd = float(units[p, t - 28:t].std())
            ss = 1.65 * sd * math.sqrt(L_LEAD)
            pos = stock + sum(q for _, q in pipe)
            if pos <= f[:L_LEAD + 3].sum() + ss:
                q = int(math.ceil(f[:L_LEAD + R_REV].sum() + ss - pos))
                if q > 0:
                    pipe.append((t + L_LEAD, q))
            d = float(units[p, t])
            sold = min(stock, d)
            stock -= int(sold)
            res["demand"][p] += d
            if d > 0:
                res["dem_days"][p] += 1
                if sold < d:
                    res["so_days"][p] += 1
            res["lost"][p] += d - sold
            res["stock_sum"][p] += stock
    return res


# ----------------------------------------------------------------------------- one seed
def run_seed(seed: int, log) -> dict:
    t0 = time.time()
    torch.set_num_threads(settings.TORCH_THREADS)
    w = Wd.build(seed)
    nodes = [Node(w.hist[s]) for s in range(NS)]
    P = w.P
    surge = w.surge_mask
    ep = settings.FORECAST_LSTM_EPOCHS
    local = []
    for s, n in enumerate(nodes):
        m = M.make("LSTM", H, W)
        M.fit(m, n.xtr, n.ytr, n.xva, n.yva, ep, seed=seed * 10 + s)
        local.append(m)
    t_local = time.time() - t0
    torch.manual_seed(seed)
    glob = M.make("LSTM", H, W)
    g_state = {k: v.detach().clone() for k, v in glob.state_dict().items()}
    size = state_bytes(glob)
    node_models: list = [None] * NS
    for rnd in range(3):
        states = []
        for s, n in enumerate(nodes):
            m = M.make("LSTM", H, W)
            m.load_state_dict(g_state)
            M.fit(m, n.xtr, n.ytr, n.xva, n.yva, settings.CDIN_LOCAL_EPOCHS, prox_ref=dict(g_state), prox_mu=settings.CDIN_FEDPROX_MU, patience=99, seed=seed * 100 + rnd * 10 + s)
            states.append({k: v.detach().clone() for k, v in m.state_dict().items()})
            node_models[s] = m
        g_state, _ = fedavg(states, [len(n.xtr) for n in nodes], settings.CDIN_SHARE_CAP)
    glob.load_state_dict(g_state)
    log(f"  [seed {seed}] trained 12 local + federated in {time.time() - t0:.0f}s (local part {t_local:.0f}s)")

    f_loc = [nodes[s].predict(local[s], T_ALL) for s in range(NS)]
    f_r3 = [nodes[s].predict(node_models[s], T_ALL) for s in range(NS)]
    f_glob = [nodes[s].predict(glob, T_ALL) for s in range(NS)]

    # ---- accuracy: local vs federated (LSTM only), pre-surge origins and all origins with full truth
    def truth(s, origins):
        return np.stack([nodes[s].units[:, t:t + H] for t in origins])

    acc: dict = {}
    for name, fl in (("LOCAL", f_loc), ("FEDERATED", f_glob)):
        for tag, origins in (("pre", T_PRE), ("all", T_ACC)):
            idx = [T_ALL.index(t) for t in origins]
            tr_all = np.concatenate([truth(s, origins) for s in range(NS)], axis=1)
            pr_all = np.concatenate([fl[s][idx] for s in range(NS)], axis=1)
            acc[f"{name}_{tag}"] = C.score(tr_all, pr_all)
            sm = np.tile(surge, NS)
            acc[f"{name}_{tag}_surge_skus"] = C.score(tr_all[:, sm], pr_all[:, sm])
            acc[f"{name}_{tag}_other_skus"] = C.score(tr_all[:, ~sm], pr_all[:, ~sm])
            acc[f"{name}_{tag}_per_store_mae"] = [C.score(truth(s, origins), fl[s][idx])["mae"] for s in range(NS)]
    ma_pool = np.concatenate([np.stack([nodes[s].units[:, t - 7:t].mean(axis=1)[:, None].repeat(H, 1) for t in T_ACC]) for s in range(NS)], axis=1)
    acc["MOVING_AVG_7_all"] = C.score(np.concatenate([truth(s, T_ACC) for s in range(NS)], axis=1), ma_pool)

    # ---- RDI under the growth definitions
    rdi = {"A": rdi_of(growth_A(nodes, f_loc)), "A3": rdi_of(growth_A(nodes, f_r3)), "B": rdi_of(growth_B(nodes))}
    warn = {k: warning_metrics(v, surge) for k, v in rdi.items()}
    sweep = {k: {str(th): {m: warning_metrics(v, surge, th)[m] for m in ('detected_share_first', 'detected_share_sustained3', 'spurious_surge_before_precursor', 'fp_nonsurge_sku_share_post', 'fp_nonsurge_skuday_share_post')} for th in (0.6, 0.7, 0.8)} for k, v in rdi.items()}

    # ---- uplift effect on forecast accuracy (late stores) and replenishment simulation
    up_idx = [T_ALL.index(t) for t in T_UPL]
    sim_idx = list(range(len(T_SIM)))
    uplift_mae = {v: {"surge": [], "other": []} for v in VARIANTS}
    sim_tot = {v: {g: {"so_days": 0.0, "dem_days": 0.0, "lost": 0.0, "demand": 0.0, "stock_sum": 0.0} for g in ("surge", "other")} for v in VARIANTS}
    for s in w.late:
        tr_s = truth(s, T_UPL)                                                  # (28, P, H)
        base = f_loc[s][up_idx]
        for v in VARIANTS:
            if v == "none":
                u_up = np.ones((len(T_UPL), P))
                u_sim = np.ones((len(T_SIM), P))
            elif v == "oracle":
                u_up, u_sim = oracle_uplift(w, s, T_UPL), oracle_uplift(w, s, T_SIM)
                u_up[:, ~surge] = 1.0
                u_sim[:, ~surge] = 1.0
            else:
                u_up, u_sim = uplift_of(rdi[v], T_UPL), uplift_of(rdi[v], T_SIM)
            err = np.abs(base * u_up[:, :, None] - tr_s)
            uplift_mae[v]["surge"].append(err[:, surge].mean())
            uplift_mae[v]["other"].append(err[:, ~surge].mean())
            r = simulate_store(nodes[s].units, f_loc[s], u_sim)
            for g, msk in (("surge", surge), ("other", ~surge)):
                for k in sim_tot[v][g]:
                    sim_tot[v][g][k] += float(r[k][msk].sum())
    uplift_out = {v: {g: float(np.mean(uplift_mae[v][g])) for g in ("surge", "other")} for v in VARIANTS}
    sim_out = {}
    for v in VARIANTS:
        sim_out[v] = {}
        for g in ("surge", "other"):
            a = sim_tot[v][g]
            sim_out[v][g] = {"stockout_day_share": a["so_days"] / max(a["dem_days"], 1), "lost_unit_share": a["lost"] / max(a["demand"], 1),
                             "stock_per_daily_demand": a["stock_sum"] / max(a["demand"], 1)}
    log(f"  [seed {seed}] done in {time.time() - t0:.0f}s: detect A/A'/B = " + "/".join(f"{warn[k]['detected_share_first']:.2f}" for k in ('A', 'A3', 'B'))
        + "  stockout(surge, late) none/A/B/oracle = " + "/".join(f"{sim_out[v]['surge']['stockout_day_share']:.3f}" for v in ('none', 'A', 'B', 'oracle')))
    return {"seed": seed, "early_stores": w.early, "late_stores": w.late, "surge_idx": w.surge_idx, "accuracy": acc, "warning": warn, "threshold_sweep": sweep, "uplift_mae": uplift_out, "replenishment": sim_out,
            "state_bytes": size, "seconds": round(time.time() - t0, 1)}


# ----------------------------------------------------------------------------- aggregation / report
def ms(xs) -> tuple[float, float]:
    a = np.asarray([x for x in xs if x is not None and x == x], dtype=float)
    return (float(a.mean()), float(a.std(ddof=1)) if len(a) > 1 else 0.0) if len(a) else (float("nan"), float("nan"))


def fmt(xs, nd=3, pct=False) -> str:
    m, s = ms(xs)
    if pct:
        return f"{m * 100:.1f} ± {s * 100:.1f} %"
    return f"{m:.{nd}f} ± {s:.{nd}f}"


def paired(a, b) -> str:
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 3 or np.allclose(a, b):
        return "n/a"
    t = stats.ttest_rel(b, a)
    try:
        wp = stats.wilcoxon(b, a).pvalue
    except ValueError:
        wp = float("nan")
    return f"diff {np.mean(b - a):+.4f}, t-test p={t.pvalue:.3g}, Wilcoxon p={wp:.3g}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="0-4")
    a = ap.parse_args()
    seeds = parse_seeds(a.seeds)
    T0 = time.time()
    res = []
    for sd in seeds:
        res.append(run_seed(sd, print))
        report(res, time.time() - T0, quiet=len(res) < len(seeds))
        print(f"  partial results written after {len(res)}/{len(seeds)} seeds", flush=True)


def report(res: list, secs: float, quiet: bool = False) -> None:
    seeds = [r["seed"] for r in res]
    n = len(seeds)

    md = [f"# E7c - CDIN at larger scale ({n} seeds)", "",
          f"World: {NS} stores x 120 SKUs x {ND} days (deterministic generator `scripts/bench/world12.py`); models see days 0-{TR - 1} only. Planted regional precursor on {Wd.N_SURGE} SKUs: "
          f"{Wd.N_EARLY} early stores ramp x1 -> x{Wd.MULT:g} over days {Wd.PRECURSOR_START}-{Wd.PRECURSOR_START + Wd.RAMP_LEN} and stay high; the other {NS - Wd.N_EARLY} 'late' stores do the same {Wd.LATE_START - Wd.PRECURSOR_START} days later "
          f"(days {Wd.LATE_START}-{Wd.LATE_START + Wd.RAMP_LEN}) and stay high until day {ND - 1} (a {ND - Wd.LATE_START}-day surge window). Daily origins {T_ALL[0]}-{T_ALL[-1]}; RDI threshold {RDI_THR}; equal node weights; "
          f"published only when >= 2 nodes report. Federated: {3} rounds x {settings.CDIN_LOCAL_EPOCHS} local epochs, FedProx mu={settings.CDIN_FEDPROX_MU}, FedAvg weighted by samples, share cap {settings.CDIN_SHARE_CAP} "
          "(the coordinator's norm-outlier rejection is not replicated). Mean ± std over seeds.", ""]

    md += ["## Accuracy: local-only vs federated LSTM (no ensemble)", "", "| Variant | origins | pooled MAE | pooled WAPE % | surge SKUs MAE | other SKUs MAE |", "|---|---|---|---|---|---|"]
    for nm in ("LOCAL", "FEDERATED"):
        for tag, lab in (("pre", f"{T_PRE[0]}-{T_PRE[-1]} (before precursor)"), ("all", f"{T_ACC[0]}-{T_ACC[-1]}")):
            md.append(f"| {nm} | {lab} | {fmt([r['accuracy'][f'{nm}_{tag}']['mae'] for r in res])} | {fmt([r['accuracy'][f'{nm}_{tag}']['wape'] for r in res], 1)} | "
                      f"{fmt([r['accuracy'][f'{nm}_{tag}_surge_skus']['mae'] for r in res])} | {fmt([r['accuracy'][f'{nm}_{tag}_other_skus']['mae'] for r in res])} |")
    md.append(f"| MOVING_AVG_7 | {T_ACC[0]}-{T_ACC[-1]} | {fmt([r['accuracy']['MOVING_AVG_7_all']['mae'] for r in res])} | {fmt([r['accuracy']['MOVING_AVG_7_all']['wape'] for r in res], 1)} | | |")
    md.append("")
    md.append("Federated minus local, pooled MAE (all origins): " + paired([r["accuracy"]["LOCAL_all"]["mae"] for r in res], [r["accuracy"]["FEDERATED_all"]["mae"] for r in res]))
    sb = res[0]["state_bytes"]
    md += ["", f"Communication: LSTM state {sb / 1024:.1f} KiB; per round {NS} nodes x (up + down) = {2 * NS * sb / 1024:.0f} KiB; 3 rounds {6 * NS * sb / 1024:.0f} KiB in total.", ""]

    md += ["## Early warning: regional demand index", "",
           "Detection = first daily origin >= day 160 with RDI > 0.6 (`sustained` = three consecutive origins). Lead = days before the late stores' surge starts (day 180). "
           "'Spurious' = surge SKUs above threshold before the precursor exists.", "",
           "| Metric | A: platform growth (local LSTM) | A': platform growth (round-3 node model) | B: sales velocity |", "|---|---|---|---|"]
    keys = ("A", "A3", "B")

    def row(label, f):
        md.append(f"| {label} | " + " | ".join(f(k) for k in keys) + " |")
    row("surge SKUs with an RDI published", lambda k: fmt([r["warning"][k]["surge_published"] for r in res], 1))
    row("detected after precursor start (first crossing)", lambda k: fmt([r["warning"][k]["detected_share_first"] for r in res], pct=True))
    row("detected, sustained 3 origins", lambda k: fmt([r["warning"][k]["detected_share_sustained3"] for r in res], pct=True))
    row("lead before late-store surge (days), mean over detected", lambda k: fmt([np.mean(r["warning"][k]["lead_days_first"]) if r["warning"][k]["lead_days_first"] else None for r in res], 1))
    row("delay after precursor start (days)", lambda k: fmt([np.mean(r["warning"][k]["delay_days_first"]) if r["warning"][k]["delay_days_first"] else None for r in res], 1))
    row("spurious: surge SKUs above threshold BEFORE the precursor", lambda k: fmt([r["warning"][k]["spurious_surge_before_precursor"] for r in res], pct=True))
    row("false positives: non-surge SKUs above threshold on/after day 160", lambda k: fmt([r["warning"][k]["fp_nonsurge_sku_share_post"] for r in res], pct=True))
    row("false positives: non-surge SKUs above threshold anywhere (150-209)", lambda k: fmt([r["warning"][k]["fp_nonsurge_sku_share_whole"] for r in res], pct=True))
    row("non-surge SKU-days above threshold, before day 160", lambda k: fmt([r["warning"][k]["fp_nonsurge_skuday_share_pre"] for r in res], pct=True))
    row("non-surge SKU-days above threshold, from day 160", lambda k: fmt([r["warning"][k]["fp_nonsurge_skuday_share_post"] for r in res], pct=True))
    row("AUC of mean RDI (days 170-179), surge vs other SKUs", lambda k: fmt([r["warning"][k]["auc_surge_vs_other_days170_179"] for r in res], 3))
    md += ["", "Mean RDI by origin day (surge SKUs / other SKUs):", "", "| Day | " + " | ".join(f"{k}" for k in keys) + " |", "|---|---|---|---|"]
    for d in (150, 159, 165, 170, 175, 180, 190, 200, 209):
        cells = []
        for k in keys:
            sv = np.nanmean([r["warning"][k]["trajectory"][d]["surge"] for r in res if r["warning"][k]["trajectory"][d]["surge"] is not None] or [np.nan])
            ov = np.nanmean([r["warning"][k]["trajectory"][d]["other"] for r in res if r["warning"][k]["trajectory"][d]["other"] is not None] or [np.nan])
            cells.append(f"{sv:.3f} / {ov:.3f}")
        md.append(f"| {d} | " + " | ".join(cells) + " |")

    md += ["", "## Effect of the RDI forecast uplift on the late stores (origins 168-196, MAE in units, 14-day horizon)", "",
           "Uplift u = clip(1 + 0.6 (RDI - 0.5), 0.8, 1.3) on the local LSTM forecast (platform rule); oracle = true ramp ratio clipped the same way.", "",
           "| Variant | surge SKUs MAE | other SKUs MAE (harm) |", "|---|---|---|"]
    for v in VARIANTS:
        md.append(f"| {VNAME[v]} | {fmt([r['uplift_mae'][v]['surge'] for r in res])} | {fmt([r['uplift_mae'][v]['other'] for r in res])} |")

    md += ["", f"## Replenishment simulation, late stores, days {T_SIM[0]}-{T_SIM[-1]}", "",
           f"Order-up-to policy per store x SKU: lead {L_LEAD} d, review {R_REV} d, safety 1.65 sigma(28 d) sqrt(L), reorder when position <= forecast over L+3 days + safety, order = forecast over L+R + safety - position; start stock = 14 days of pre-surge mean demand; lost sales when stock < demand.", "",
           "| Variant | group | stockout-day share | lost-unit share | stock per unit of daily demand |", "|---|---|---|---|---|"]
    for v in VARIANTS:
        for g in ("surge", "other"):
            md.append(f"| {VNAME[v]} | {g} SKUs | {fmt([r['replenishment'][v][g]['stockout_day_share'] for r in res], pct=True)} | {fmt([r['replenishment'][v][g]['lost_unit_share'] for r in res], pct=True)} | "
                      f"{fmt([r['replenishment'][v][g]['stock_per_daily_demand'] for r in res], 2)} |")
    md += ["", f"Paired tests over {n} seeds (variant minus no CDIN; low power at this n):", ""]
    for v in ("A", "A3", "B", "oracle"):
        for g, lab in (("surge", "surge SKUs"), ("other", "other SKUs")):
            for met, ml in (("stockout_day_share", "stockout-day share"), ("lost_unit_share", "lost-unit share")):
                md.append(f"* {VNAME[v]} - {lab}, {ml}: " + paired([r["replenishment"]["none"][g][met] for r in res], [r["replenishment"][v][g][met] for r in res]))
    md += ["", "## Operating point: RDI threshold sweep (first crossing from day 160)", "",
           "| Definition | threshold | surge SKUs detected | surge SKUs above threshold BEFORE the precursor | non-surge SKUs with a false alarm (from day 160) | non-surge SKU-days above threshold |", "|---|---|---|---|---|---|"]
    for k in keys:
        for th in ("0.6", "0.7", "0.8"):
            g = lambda m: fmt([r["threshold_sweep"][k][th][m] for r in res], pct=True)   # noqa: E731
            md.append(f"| {k} | {th} | {g('detected_share_first')} | {g('spurious_surge_before_precursor')} | {g('fp_nonsurge_sku_share_post')} | {g('fp_nonsurge_skuday_share_post')} |")
    md += ["", f"Hardware: {C.hardware()}", f"Run time: {secs:.0f} s ({n} seeds)."]
    os.makedirs(C.OUT, exist_ok=True)
    with open(os.path.join(C.OUT, "cdin_scale_eval.md"), "w", encoding="utf8") as f:
        f.write("\n".join(md))
    C.save_json("cdin_scale_eval.json", {"seeds": seeds, "world": {"stores": NS, "days": ND, "train_end": TR, "surge_skus": Wd.N_SURGE, "precursor_start": Wd.PRECURSOR_START, "late_start": Wd.LATE_START},
                                           "hardware": C.hardware(), "elapsed_s": round(secs, 1), "per_seed": res})
    print("\n".join(md))


if __name__ == "__main__":
    main()
