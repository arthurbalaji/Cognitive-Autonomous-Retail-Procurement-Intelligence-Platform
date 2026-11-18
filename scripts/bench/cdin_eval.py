"""E7(b): CDIN privacy/utility and early-warning evaluation.

    python -m scripts.bench.cdin_eval --seeds 0-4

Three nodes = the three stores. Compared on the same 17 test origins (days 120..136, horizon 14), LSTM architecture of the platform:
  LOCAL      one LSTM per store, trained only on that store's panel (12 epochs max, early stopping)
  FEDERATED  global LSTM from 3 FedProx/FedAvg rounds (3 local epochs, mu = CDIN_FEDPROX_MU, shares capped at CDIN_SHARE_CAP), in-process replica of
             app/cdin/coordinator.aggregate + cdin_node.do_round; each node scales with its own scaler (never shared)
  CENTRAL    one LSTM trained on the pooled windows of all stores (upper bound; needs raw data sharing)
Early warning: node growth ratios and the regional demand index (RDI) exactly as cdin_node/coordinator compute them, published from stores 1+2 only.
"""
from __future__ import annotations

import argparse
import os
import time

import numpy as np
import torch

from app.config import settings
from app.forecasting import data as D
from app.forecasting import models as M
from scripts.bench import _common as C
from scripts.bench import prepare_forecasts as PF

W, H = C.W, C.H
ORIGINS = list(range(C.TRAIN_END, C.N_DAYS - H + 1))        # 120..136 (full truth)
ALL_ORIGINS = list(range(C.TRAIN_END, C.N_DAYS))            # 120..149 (early-warning scan)
SURGE_STORE3_START = 148                                    # generate.history: store 3 ramps only in the last 2 days
SURGE_EARLY_START = 136                                     # stores 1 and 2 ramp linearly over the last 14 days
RDI_THRESHOLD = 0.6
DOW = D.dow_features(C.START, C.N_DAYS)


class Node:
    def __init__(self, units: np.ndarray):
        self.units = units
        tr = units[:, :C.TRAIN_END]
        self.split = int(C.TRAIN_END * 0.8)
        self.scales = D.fit_scales(tr, self.split)                       # local scaler, never shared
        active = tr[:, :self.split].sum(axis=1) > 0
        self.xtr, self.ytr, _ = D.make_windows(tr, self.scales, DOW, W, H, 0, self.split, active)
        self.xva, self.yva, _ = D.make_windows(tr, self.scales, DOW, W, H, self.split, C.TRAIN_END, active)

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
    out = {k: sum(float(sh) * st[k].float() for sh, st in zip(share, states)) for k in states[0]}
    return out, share.tolist()


def run_seed(seed: int, log) -> dict:
    t0 = time.time()
    w = C.build_world(seed)
    nodes = [Node(w.hist[s].astype(np.float32)) for s in range(C.N_STORES)]
    truth = [np.stack([n.units[:, t:t + H] for t in ORIGINS]) for n in nodes]          # (17, P, H) per store
    ep = settings.FORECAST_LSTM_EPOCHS

    local = []
    for s, n in enumerate(nodes):
        m = M.make("LSTM", H, W)
        M.fit(m, n.xtr, n.ytr, n.xva, n.yva, ep, seed=seed * 10 + s)
        local.append(m)
    xc, yc = np.concatenate([n.xtr for n in nodes]), np.concatenate([n.ytr for n in nodes])
    xv, yv = np.concatenate([n.xva for n in nodes]), np.concatenate([n.yva for n in nodes])
    central = M.make("LSTM", H, W)
    M.fit(central, xc, yc, xv, yv, ep, seed=seed)

    torch.manual_seed(seed)
    glob = M.make("LSTM", H, W)
    g_state = {k: v.detach().clone() for k, v in glob.state_dict().items()}
    size = state_bytes(glob)
    node_models: list = [None] * C.N_STORES
    shares = []
    for rnd in range(3):
        states = []
        for s, n in enumerate(nodes):
            m = M.make("LSTM", H, W)
            m.load_state_dict(g_state)
            M.fit(m, n.xtr, n.ytr, n.xva, n.yva, settings.CDIN_LOCAL_EPOCHS, prox_ref=dict(g_state), prox_mu=settings.CDIN_FEDPROX_MU,
                  patience=99, seed=seed * 100 + rnd * 10 + s)
            states.append({k: v.detach().clone() for k, v in m.state_dict().items()})
            node_models[s] = m
        g_state, sh = fedavg(states, [len(n.xtr) for n in nodes], settings.CDIN_SHARE_CAP)
        shares.append([round(x, 3) for x in sh])
    glob.load_state_dict(g_state)
    log(f"  [seed {seed}] trained local/central/federated in {time.time() - t0:.0f}s  shares={shares}")

    preds: dict[str, list[np.ndarray]] = {
        "LOCAL": [nodes[s].predict(local[s], ORIGINS) for s in range(C.N_STORES)],
        "FEDERATED": [nodes[s].predict(glob, ORIGINS) for s in range(C.N_STORES)],
        "CENTRAL": [nodes[s].predict(central, ORIGINS) for s in range(C.N_STORES)],
        "MOVING_AVG_7": [C.baselines(nodes[s].units, ORIGINS)["MOVING_AVG_7"] for s in range(C.N_STORES)],
    }
    acc: dict = {}
    for name, pl in preds.items():
        per_store = {f"store-{s + 1}": C.score(truth[s], pl[s]) for s in range(C.N_STORES)}
        pooled = C.score(np.concatenate(truth, axis=1), np.concatenate(pl, axis=1))
        acc[name] = {"per_store": per_store, "pooled": pooled}

    # ---------------------------------------------------------------- early warning (growth -> RDI) from the nodes' round-3 local models
    P = w.P
    growth = np.full((2, len(ALL_ORIGINS), P), np.nan)
    for s in (0, 1):
        n = nodes[s]
        pr = n.predict(node_models[s], ALL_ORIGINS)                                  # (30, P, H)
        for oi, t in enumerate(ALL_ORIGINS):
            recent = n.units[:, t - 14:t].mean(axis=1)
            ratio = np.clip(pr[oi, :, :14].mean(axis=1) / np.maximum(recent, 1e-9), 0.5, 2.0)
            ratio = np.round(np.round(ratio / 0.05) * 0.05, 2)
            growth[s, oi] = np.where(recent >= 0.5, ratio, np.nan)
    wts = np.array([len(nodes[0].xtr), len(nodes[1].xtr)], dtype=float)
    both = ~np.isnan(growth).any(axis=0)                                            # k-anonymity: >= 2 contributing nodes
    mean_g = np.where(both, (growth[0] * wts[0] + growth[1] * wts[1]) / wts.sum(), np.nan)
    rdi = 0.5 + 0.5 * np.tanh(3.0 * (mean_g - 1.0))                                 # (30, P)

    surge = np.array([p.surge for p in w.catalog])
    ns = ~surge
    oi_arr = np.array(ALL_ORIGINS)
    pre = oi_arr < SURGE_EARLY_START + 1                 # origins 120..136: no precursor has happened yet (any alarm here is spurious)
    post = ~pre                                          # origins 137..149: precursor is under way in stores 1 and 2
    above = np.nan_to_num(rdi, nan=0.0) > RDI_THRESHOLD   # (30, P)

    def first_day(mask: np.ndarray) -> np.ndarray:
        out = np.full(P, -1)
        for p in range(P):
            hit = np.nonzero(above[:, p] & mask)[0]
            if len(hit):
                out[p] = ALL_ORIGINS[hit[0]]
        return out

    first_post = first_day(post)
    first_any = first_day(np.ones(len(ALL_ORIGINS), bool))
    det = first_post[surge]
    detected = det >= 0
    lead = (SURGE_STORE3_START - det[detected]).tolist()
    delay = (det[detected] - SURGE_EARLY_START).tolist()
    published_ns = (~np.isnan(rdi[:, ns])).any(axis=0)
    published_s = (~np.isnan(rdi[:, surge])).any(axis=0)
    fp_sku_post = float(((first_post[ns] >= 0) & published_ns).sum() / max(published_ns.sum(), 1))
    fp_sku_any = float(((first_any[ns] >= 0) & published_ns).sum() / max(published_ns.sum(), 1))
    fp_day = float(np.nansum(rdi[:, ns] > RDI_THRESHOLD) / max((~np.isnan(rdi[:, ns])).sum(), 1))
    spurious_surge = float(((above[pre][:, surge]).any(axis=0) & published_s).sum() / max(published_s.sum(), 1))
    mean_rdi = lambda sel, m: float(np.nanmean(rdi[m][:, sel])) if np.isfinite(rdi[m][:, sel]).any() else None   # noqa: E731
    early = {"surge_skus": int(surge.sum()), "surge_published": int(published_s.sum()),
             "detected": int(detected.sum()), "detect_day": det[detected].tolist(),
             "lead_days_before_store3_surge": lead, "mean_lead_days": float(np.mean(lead)) if lead else None,
             "mean_delay_after_precursor_start": float(np.mean(delay)) if delay else None,
             "surge_alarm_before_precursor_share": spurious_surge,
             "non_surge_published": int(published_ns.sum()), "false_positive_sku_share": fp_sku_post, "false_positive_sku_share_whole_window": fp_sku_any,
             "false_positive_sku_day_share": fp_day,
             "rdi_mean_surge_pre": mean_rdi(surge, pre), "rdi_mean_nonsurge_pre": mean_rdi(ns, pre),
             "rdi_mean_surge_post": mean_rdi(surge, post), "rdi_mean_nonsurge_post": mean_rdi(ns, post),
             "rdi_mean_surge_last_day": float(np.nanmean(rdi[-1, surge])), "rdi_mean_nonsurge_last_day": float(np.nanmean(rdi[-1, ns])),
             "rdi_matrix_surge": np.round(np.nan_to_num(rdi[:, surge], nan=-1), 3).tolist(), "rdi_origins": ALL_ORIGINS}

    # ---------------------------------------------------------------- effect of the RDI forecast uplift on store 3 (partial horizon: truth ends day 149)
    n3 = nodes[2]
    pr3 = n3.predict(glob, ALL_ORIGINS)
    err_base = {"surge": [], "other": []}
    err_up = {"surge": [], "other": []}
    for oi, t in enumerate(ALL_ORIGINS):
        hl = min(H, C.N_DAYS - t)
        y = n3.units[:, t:t + hl]
        have = ~np.isnan(rdi[oi])
        u = np.where(have, np.clip(1.0 + 0.6 * (np.nan_to_num(rdi[oi], nan=0.5) - 0.5), 0.8, 1.3), 1.0)
        base = pr3[oi, :, :hl]
        up = base * u[:, None]
        for grp, sel in (("surge", surge & have), ("other", ns & have)):
            if sel.any():
                err_base[grp].append(np.abs(base[sel] - y[sel]).ravel())
                err_up[grp].append(np.abs(up[sel] - y[sel]).ravel())
    uplift = {g: {"mae_without_uplift": float(np.concatenate(err_base[g]).mean()) if err_base[g] else None,
                  "mae_with_uplift": float(np.concatenate(err_up[g]).mean()) if err_up[g] else None} for g in ("surge", "other")}

    return {"accuracy": acc, "early_warning": early, "uplift_store3": uplift,
            "bytes": {"state_bytes": size, "per_round_up": size * C.N_STORES, "per_round_down": size * C.N_STORES,
                      "per_round_total": 2 * size * C.N_STORES, "rounds": 3, "total": 3 * 2 * size * C.N_STORES},
            "shares_per_round": shares, "seconds": round(time.time() - t0, 1)}


def ms(xs) -> dict:
    xs = [x for x in xs if x is not None]
    mean, sd, lo, hi = C.mean_ci(xs)
    return {"mean": round(mean, 4), "std": round(sd, 4), "ci95": [round(lo, 4), round(hi, 4)], "n": len(xs)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="0-4")
    a = ap.parse_args()
    seeds = PF.parse_seeds(a.seeds)
    t0 = time.time()
    res = {}
    for s in seeds:
        res[s] = run_seed(s, print)
        r = res[s]
        print(f"[seed {s}] pooled MAE " + ", ".join(f"{k}={v['pooled']['mae']}" for k, v in r["accuracy"].items()) +
              f" | detected {r['early_warning']['detected']}/{r['early_warning']['surge_skus']} lead {r['early_warning']['mean_lead_days']} | {r['seconds']}s", flush=True)
    names = ["LOCAL", "FEDERATED", "CENTRAL", "MOVING_AVG_7"]
    acc = {n: {"pooled_mae": ms([res[s]["accuracy"][n]["pooled"]["mae"] for s in seeds]), "pooled_wape": ms([res[s]["accuracy"][n]["pooled"]["wape"] for s in seeds]),
               "pooled_rmse": ms([res[s]["accuracy"][n]["pooled"]["rmse"] for s in seeds]),
               **{f"store-{k}_mae": ms([res[s]["accuracy"][n]["per_store"][f"store-{k}"]["mae"] for s in seeds]) for k in (1, 2, 3)},
               **{f"store-{k}_wape": ms([res[s]["accuracy"][n]["per_store"][f"store-{k}"]["wape"] for s in seeds]) for k in (1, 2, 3)}} for n in names}
    g = lambda k: ms([res[s]["early_warning"][k] for s in seeds])   # noqa: E731
    ew = {"detected_share": ms([res[s]["early_warning"]["detected"] / max(res[s]["early_warning"]["surge_published"], 1) for s in seeds]),
          "mean_lead_days": g("mean_lead_days"), "mean_delay_after_precursor_start": g("mean_delay_after_precursor_start"),
          "surge_alarm_before_precursor_share": g("surge_alarm_before_precursor_share"),
          "false_positive_sku_share": g("false_positive_sku_share"), "false_positive_sku_share_whole_window": g("false_positive_sku_share_whole_window"),
          "false_positive_sku_day_share": g("false_positive_sku_day_share"),
          "rdi_surge_pre": g("rdi_mean_surge_pre"), "rdi_nonsurge_pre": g("rdi_mean_nonsurge_pre"),
          "rdi_surge_post": g("rdi_mean_surge_post"), "rdi_nonsurge_post": g("rdi_mean_nonsurge_post"),
          "rdi_surge_last_day": g("rdi_mean_surge_last_day"), "rdi_nonsurge_last_day": g("rdi_mean_nonsurge_last_day")}
    upl = {g: {k: ms([res[s]["uplift_store3"][g][k] for s in seeds]) for k in ("mae_without_uplift", "mae_with_uplift")} for g in ("surge", "other")}
    out = {"seeds": seeds, "accuracy_summary": acc, "early_warning_summary": ew, "uplift_store3_summary": upl, "bytes": res[seeds[0]]["bytes"],
           "per_seed": res, "hardware": C.hardware(), "elapsed_s": round(time.time() - t0, 1),
           "config": {"rounds": 3, "local_epochs": settings.CDIN_LOCAL_EPOCHS, "fedprox_mu": settings.CDIN_FEDPROX_MU, "share_cap": settings.CDIN_SHARE_CAP,
                      "rdi_threshold": RDI_THRESHOLD, "store3_surge_start_day": SURGE_STORE3_START, "precursor_start_day": SURGE_EARLY_START}}
    C.save_json("cdin_eval.json", out)
    write_md(out)
    print("wrote cdin_eval.json / .md", flush=True)


def f(d: dict, nd=3) -> str:
    return f"{d['mean']:.{nd}f} ± {d['std']:.{nd}f}"


def write_md(o: dict) -> None:
    A, E, U, B = o["accuracy_summary"], o["early_warning_summary"], o["uplift_store3_summary"], o["bytes"]
    L = [f"# E7b - CDIN privacy/utility and early warning ({len(o['seeds'])} seeds)", "",
         f"3 nodes = 3 stores, 120 SKUs each, models trained on days 0-119, tested on {17} daily origins (days 120-136, horizon 14). Mean ± std over seeds {o['seeds'][0]}-{o['seeds'][-1]}. "
         f"Federated: {o['config']['rounds']} rounds x {o['config']['local_epochs']} local epochs, FedProx mu={o['config']['fedprox_mu']}, FedAvg weighted by samples, share cap {o['config']['share_cap']}; "
         "LOCAL/CENTRAL use the platform's LSTM budget (12 epochs max, early stopping). All three are the same 64-32 LSTM; nothing but weights leaves a node in FEDERATED.", "",
         "## Accuracy (LSTM only, no ensemble)", "", "| Variant | pooled MAE | pooled RMSE | pooled WAPE % | store-1 MAE | store-2 MAE | store-3 MAE |", "|---|---|---|---|---|---|---|"]
    for n, a in A.items():
        L.append(f"| {n} | {f(a['pooled_mae'])} | {f(a['pooled_rmse'])} | {f(a['pooled_wape'], 1)} | {f(a['store-1_mae'])} | {f(a['store-2_mae'])} | {f(a['store-3_mae'])} |")
    L += ["", "## Communication cost", "",
          f"LSTM state = {B['state_bytes'] / 1024:.1f} KiB (float32). Per round, 3 nodes: {B['per_round_up'] / 1024:.1f} KiB up + {B['per_round_down'] / 1024:.1f} KiB down = {B['per_round_total'] / 1024:.1f} KiB. "
          f"{B['rounds']} rounds: {B['total'] / 1024:.1f} KiB total, versus sharing the raw panels (3 stores x 120 SKUs x 120 days) in CENTRAL.", "",
          f"## Early warning (RDI from stores 1+2 only, threshold {o['config']['rdi_threshold']})", "",
          f"Planted regional precursor: stores 1 and 2 ramp from day {o['config']['precursor_start_day']}, store 3 only from day {o['config']['store3_surge_start_day']} (end of the window). "
          "Detection day = first daily forecast origin AFTER the precursor has started (day 137 onward) whose RDI exceeds the threshold; an alarm before day 137 is spurious by construction.", "",
          "| Metric | mean ± std over seeds |", "|---|---|",
          f"| Surge SKUs (RDI published) detected after the precursor starts | {E['detected_share']['mean'] * 100:.0f} % ± {E['detected_share']['std'] * 100:.0f} % |",
          f"| Lead before store 3's surge (days) | {f(E['mean_lead_days'], 1)} |",
          f"| Delay after precursor starts (days) | {f(E['mean_delay_after_precursor_start'], 1)} |",
          f"| Surge SKUs already above threshold BEFORE the precursor (spurious) | {E['surge_alarm_before_precursor_share']['mean'] * 100:.1f} % ± {E['surge_alarm_before_precursor_share']['std'] * 100:.1f} % |",
          f"| False positives: non-surge SKUs above threshold after day 137 | {E['false_positive_sku_share']['mean'] * 100:.1f} % ± {E['false_positive_sku_share']['std'] * 100:.1f} % |",
          f"| False positives: non-surge SKUs above threshold anywhere in the window | {E['false_positive_sku_share_whole_window']['mean'] * 100:.1f} % ± {E['false_positive_sku_share_whole_window']['std'] * 100:.1f} % |",
          f"| False positives: non-surge SKU-days above threshold | {E['false_positive_sku_day_share']['mean'] * 100:.1f} % |",
          f"| Mean RDI before / after the precursor, surge SKUs | {E['rdi_surge_pre']['mean']:.3f} / {E['rdi_surge_post']['mean']:.3f} |",
          f"| Mean RDI before / after the precursor, non-surge SKUs | {E['rdi_nonsurge_pre']['mean']:.3f} / {E['rdi_nonsurge_post']['mean']:.3f} |",
          f"| RDI on the last day, surge / non-surge SKUs | {E['rdi_surge_last_day']['mean']:.3f} / {E['rdi_nonsurge_last_day']['mean']:.3f} |", "",
          "## Effect of the RDI forecast uplift on store 3 (partial horizon, truth ends day 149)", "",
          "| Group | MAE without uplift | MAE with uplift |", "|---|---|---|"]
    for g, d in U.items():
        L.append(f"| {g} SKUs | {f(d['mae_without_uplift'])} | {f(d['mae_with_uplift'])} |")
    L += ["", "Store 3's own surge is only x1.1 / x1.2 on the last two days of the window, so the uplift cannot show a large accuracy gain inside the available truth; "
          "the signal is the early RDI itself.", "", f"Hardware: {o['hardware']}", f"Run time: {o['elapsed_s']} s"]
    with open(os.path.join(C.OUT, "cdin_eval.md"), "w", encoding="utf8") as fh:
        fh.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
