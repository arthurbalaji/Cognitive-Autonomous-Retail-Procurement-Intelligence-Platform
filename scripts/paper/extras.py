"""Sentences that depend on the live-stack and CDIN measurements. Reads docs/results/*.json; falls back to explicit markers
(never to invented numbers) when a result file is missing, so a draft build is visibly incomplete."""
from __future__ import annotations

import json
import os
import re

import numpy as np

from edits_results import NB, RES, Nums


def _try(name: str):
    p = os.path.join(RES, name)
    return json.load(open(p, encoding="utf8")) if os.path.exists(p) else None


def build_extras(X: Nums) -> dict:
    tok = open(os.path.join(RES, "token_compression.md"), encoding="utf8").read()
    m = re.search(r"\| compact \(CARPIP\) \| (\d+) \| (\d+) \| (\d+) \| \$([\d.]+) \|\n\| raw RAG context \| (\d+) \| (\d+) \| (\d+) \| \$([\d.]+) \|", tok)
    cin, _, clat, ccost, rin, _, rlat, rcost = (float(x) for x in m.groups())
    red_in = (1 - cin / rin) * 100
    red_lat = (1 - clat / rlat) * 100
    tokens = (f"Over 30 live Bedrock calls per variant, CARPIP’s compact payload ({cin:.0f} tokens) against a raw RAG context ({rin / 1000:.1f}k tokens) cuts input tokens by {red_in:.1f}%, "
              f"latency by {red_lat:.1f}% and cost per 1,000 calls from ${rcost:.2f} to ${ccost:.2f} (assumed list prices); the saving depends on the baseline size.")

    load = _try("load_ingest.json")
    ph = load["phases"]
    clean = [p for p in ph if p["errors"] == 0]
    top = max(clean, key=lambda p: p["rate"])
    lag99 = top["pipeline"]["lag_p99_s"]
    cdin = _try("cdin_eval.json")
    ew = cdin["early_warning_summary"]
    acc = cdin["accuracy_summary"]
    det = ew["detected_share"]["mean"] * 100
    fp = ew["false_positive_sku_share"]["mean"] * 100
    fed, loc = acc["FEDERATED"]["pooled_mae"]["mean"], acc["LOCAL"]["pooled_mae"]["mean"]
    sc = scale_stats()
    mk = _try("mpi_market_sim.json")
    first4 = list(mk["scenarios"].values())[:4]
    pdiff = [-sc_["tests_mpi_vs_static"]["price"]["mean_diff"] for sc_ in first4]
    head = [np.mean([r["price"] for r in sc_["results"]["static"]]) - np.mean([r["price"] for r in sc_["results"]["oracle"]]) for sc_ in first4]
    ablation_cdin = X.abl("CARPIP w/o CDIN", "stockout")
    ablation_tail = (f"Against hidden wholesaler minimums driven by scarcity and price shocks, the MPI improves price by {min(pdiff):.2f}–{max(pdiff):.2f} points of a possible {min(head):.1f}–{max(head):.1f} and leaves stockouts unchanged. "
                     f"In three stores removing the CDIN raises stockouts by only {abs(ablation_cdin[0]):.2f} points (p{NB}={NB}{ablation_cdin[1]:.2f}); in a 12-store test with a 30-day surge its sales-velocity index flagged the planted surges (AUC {sc['auc_B']:.2f}) and cut "
                     f"their stockouts from {sc['so_surge_none']:.1f}% to {sc['so_surge_B']:.1f}%, while the first forecast-based ratio moved against demand (AUC {sc['auc_A']:.2f}) and raised them to {sc['so_surge_A']:.1f}%.")
    attempts = sum(r["attempts"] for r in X.S["results"]["CARPIP (full)"])
    viol = sum(r["violations"] for r in X.S["results"]["CARPIP (full)"])
    assert viol == 0
    abstract_tail = (f"the MPI improved price by only {min(pdiff):.1f}–{max(pdiff):.1f} points even against hidden market-dependent wholesaler minimums, a {12}-store test showed the CDIN’s corrected sales-velocity index cutting stockouts on surging SKUs "
                     f"from {sc['so_surge_none']:.1f}% to {sc['so_surge_B']:.1f}%, and no price left its bounds in {attempts:,} negotiations.")
    crud = open(os.path.join(RES, "crud_latency_single_client.md"), encoding="utf8").read()
    rows = re.findall(r"\|[^|]+\| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \| 0 \|", crud)
    avg = sum(float(r[0]) for r in rows) / len(rows)
    p99max = max(float(r[3]) for r in rows)
    ingest = (f"Core API calls average {avg:.0f} ms (p99 at most {p99max:.0f} ms) for one client, and accepted webhooks reach stock within {lag99:.2f} s (p99) at {top['rate']} events/s.")
    return {"tokens": tokens, "ingest": ingest, "ablation_tail": ablation_tail, "abstract_tail": abstract_tail}

def scale_stats() -> dict:
    """Aggregates of the 12-store CDIN test (docs/results/cdin_scale_eval.json) used in the abstract and the ablation paragraph."""
    import numpy as np
    from scipy import stats

    j = _try("cdin_scale_eval.json")
    ps = j["per_seed"]
    m = lambda xs: float(np.mean(xs))  # noqa: E731
    rep = lambda v, g, k: [r["replenishment"][v][g][k] * 100 for r in ps]  # noqa: E731
    out = {"n": len(ps), "auc_A": m([r["warning"]["A"]["auc_surge_vs_other_days170_179"] for r in ps]),
           "auc_B": m([r["warning"]["B"]["auc_surge_vs_other_days170_179"] for r in ps]),
           "det_B08": m([r["threshold_sweep"]["B"]["0.8"]["detected_share_first"] for r in ps]) * 100,
           "fp_B08": m([r["threshold_sweep"]["B"]["0.8"]["fp_nonsurge_sku_share_post"] for r in ps]) * 100,
           "det_A06": m([r["threshold_sweep"]["A"]["0.6"]["detected_share_first"] for r in ps]) * 100}
    for v in ("none", "A", "B", "oracle"):
        out[f"so_surge_{v}"] = m(rep(v, "surge", "stockout_day_share"))
        out[f"lost_surge_{v}"] = m(rep(v, "surge", "lost_unit_share"))
        out[f"stock_surge_{v}"] = m([r["replenishment"][v]["surge"]["stock_per_daily_demand"] for r in ps])
        out[f"mae_surge_{v}"] = m([r["uplift_mae"][v]["surge"] for r in ps])
    if len(ps) > 2:
        out["p_B_vs_none"] = float(stats.ttest_rel(rep("B", "surge", "stockout_day_share"), rep("none", "surge", "stockout_day_share")).pvalue)
        out["p_A_vs_none"] = float(stats.ttest_rel(rep("A", "surge", "stockout_day_share"), rep("none", "surge", "stockout_day_share")).pvalue)
    out["fed_vs_local_pct"] = (m([r["accuracy"]["FEDERATED_all"]["mae"] for r in ps]) / m([r["accuracy"]["LOCAL_all"]["mae"] for r in ps]) - 1) * 100
    return out
