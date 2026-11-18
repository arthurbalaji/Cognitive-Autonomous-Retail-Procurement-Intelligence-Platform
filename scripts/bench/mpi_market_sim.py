"""E2b - a fairer test of the Market Pulse Index: wholesalers with a HIDDEN market-dependent reservation price.

    python -m scripts.bench.mpi_market_sim --seeds 0-9

Why: in the main simulation the wholesaler IS the protocol, so its floor equals whatever the platform computes and the MPI can only move
prices by ~0.15 points. Here each wholesaler has its own hidden minimum acceptable unit price
        R_j = floor_price(base, M_true, maxDiscount_j)             (same functional form as the platform's floor)
        M_true = clip(0.15 + 0.45 * s_j + 0.30 * DPagg + 2.0 * shock_t, 0, 1)
with s_j = the supplier's own scarcity (1 - stock / full stock), DPagg = the average demand pressure of the three retail stores for the SKU
(order flow the wholesaler can see) and shock_t = a market-wide AR(1) price shock. The retailer's platform does NOT know R_j: it only sees the
observable signals that feed the MPI (offer availability, supplier price history / dispersion, competitor price drift, its own stock position).
The negotiation protocol runs with the platform's bounds; if the agreed price is below R_j the wholesaler DECLINES (the platform then tries the
next ranked quote; if all decline, no order that day). Three ways to set the platform's floor estimate:
    mpi     floor from the live MPI_j           (CARPIP as designed)
    static  MPI fixed at 0.5                    (ablation: w/o MPI)
    oracle  floor = R_j                         (upper bound: perfect knowledge of the wholesaler's minimum)
Scenarios vary supply tightness (supplier stock = k x MOQ, depleting with other retailers' demand and restocked every 10 days) and price
volatility (shock sigma). This is a stress test built on an ASSUMED wholesaler behaviour, not evidence about real markets.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import time
from dataclasses import dataclass, replace
from datetime import timedelta
from decimal import ROUND_CEILING, Decimal

import numpy as np
from scipy import stats

from app.config import settings
from app.mpi import factors as F
from app.negotiation import bounds as B
from app.negotiation import quantity as Q
from app.negotiation.protocol import RuleVoice, negotiate
from scripts.bench import _common as C
from scripts.bench.prepare_forecasts import ensure, parse_seeds
from scripts.bench.procurement_sim import (HOLD_RATE, REVIEW, SAFETY, T0, T1, TARGET_MARGIN, Market, cand, dyn_rop, holm, paired)


@dataclass
class Mkt:
    name: str
    tight: float | None          # supplier stock = tight x MOQ x U(0.8,1.2); None = catalog stock (weeks of cover)
    vol: float                   # daily innovation sigma of the market price shock
    restock_days: int = 10
    exo_share: float = 0.5       # other retailers' daily drain = exo_share x mean daily demand of our three stores
    span: float = 0.10           # hidden minimum = base x (0.80 + span x M_true); 0.10 = the platform's own floor range, 0.20 = wider than the platform can express


SCENARIOS = [Mkt("normal supply, calm prices", None, 0.005), Mkt("tight supply", 4.0, 0.005), Mkt("volatile prices", None, 0.03),
             Mkt("tight supply + volatile prices", 4.0, 0.03),
             Mkt("tight + volatile, wider hidden range", 4.0, 0.03, span=0.20)]
MODES = ["mpi", "static", "oracle"]


def reservation(base: Decimal, mt: float, max_disc: float, span: float) -> Decimal:
    frac = min(1.0, max(0.80 + span * mt, 1.0 - max_disc))
    return min(B.q2(base * Decimal(str(round(frac, 6))), ROUND_CEILING), base)


def m_true(scar: float, dpagg: float, shock: float) -> float:
    return float(np.clip(0.15 + 0.45 * scar + 0.30 * dpagg + 2.0 * shock, 0.0, 1.0))


def simulate_market(world: C.World, fc: dict, market: Market, mk: Mkt, mode: str) -> dict:
    P, hist, cat = world.P, world.hist, world.catalog
    from scripts.datagen import generate as G
    rng_late = np.random.default_rng(world.seed * 31 + 5)
    late_u = rng_late.random((C.N_STORES, P, C.N_DAYS))
    late_d = rng_late.integers(1, 4, (C.N_STORES, P, C.N_DAYS))
    rng_m = np.random.default_rng(world.seed * 97 + 11)
    shock = np.zeros(C.N_DAYS + 1)
    for t in range(1, C.N_DAYS + 1):
        shock[t] = 0.9 * shock[t - 1] + rng_m.normal(0, mk.vol)
    rng_x = np.random.default_rng(world.seed * 53 + 7)
    stock0 = [G.initial_stock(cat, hist[s][:, :T0], s, world.seed, set()) for s in range(C.N_STORES)]
    lots = [[[[10 ** 9, stock0[s][cat[p].sku]]] if stock0[s][cat[p].sku] > 0 else [] for p in range(P)] for s in range(C.N_STORES)]
    pipe = [[[] for _ in range(P)] for _ in range(C.N_STORES)]
    A0, avail, offs = {}, {}, {}
    for p in range(P):
        offs[p] = {}
        for o in market.offers[p]:
            a0 = (mk.tight * o.moq * rng_x.uniform(0.8, 1.2)) if mk.tight else float(o.avail)
            A0[(p, o.code)] = max(a0, o.moq)
            avail[(p, o.code)] = A0[(p, o.code)]
            offs[p][o.code] = o
    zero = lambda: np.zeros(T1 - T0)  # noqa: E731
    d = dict(stockout=zero(), active=zero(), unmet=zero(), demand=zero(), hold=zero(), orders=0, attempts=0, accepted=0, declines=0, no_order=0,
             spend=0.0, list_spend=0.0, over_num=0.0, over_den=0.0, mhat=[], mtrue=[], comp=[], n_dec=0)
    for t in range(T0, T1):
        today = C.START + timedelta(days=t)
        # supplier stock dynamics
        for (p, code), a in list(avail.items()):
            drain = rng_x.poisson(mk.exo_share * max(float(hist[:, p, t - 28:t].mean()), 0.0) * C.N_STORES)
            avail[(p, code)] = max(a - drain, 0.0)
            if (t + p + hash(code) % mk.restock_days) % mk.restock_days == 0:
                avail[(p, code)] = A0[(p, code)]
        # day-start receipts and positions of every store
        pos = np.zeros((C.N_STORES, P))
        onhand = np.zeros((C.N_STORES, P))
        for s in range(C.N_STORES):
            for p in range(P):
                keep = []
                for a, q, rem in pipe[s][p]:
                    if a <= t:
                        lots[s][p].append([a + rem if rem is not None else 10 ** 9, q])
                    else:
                        keep.append((a, q, rem))
                pipe[s][p] = keep
                lots[s][p].sort()
                onhand[s, p] = sum(x[1] for x in lots[s][p])
                pos[s, p] = onhand[s, p] + sum(q for _, q, _ in keep)
        dpagg = np.zeros(P)
        for p in range(P):
            if not market.offers[p]:
                continue
            lead_min = min(o.lead for o in market.offers[p])
            vals = []
            for s in range(C.N_STORES):
                m28 = float(hist[s, p, t - 28:t].mean())
                vals.append(F.demand_pressure(pos[s, p], dyn_rop(m28, float(hist[s, p, t - 28:t].std()), lead_min), m28, lead_min, SAFETY)[0])
            dpagg[p] = (float(np.mean(vals)) - 0.10) / 0.85
        for s in range(C.N_STORES):
            for p in range(P):
                L = lots[s][p]
                position, on_hand = pos[s, p], onhand[s, p]
                offers = market.offers[p]
                if offers:
                    m28, sd28 = hist[s, p, t - 28:t].mean(), hist[s, p, t - 28:t].std()
                    order = _decide_market(world, fc, market, mk, mode, s, p, t, today, position, on_hand, m28, sd28, avail, A0, dpagg[p], shock, d)
                    if order:
                        o, q, price, base_p = order
                        avail[(p, o.code)] = max(avail[(p, o.code)] - q, 0.0)
                        late = late_u[s, p, t] > o.p_ontime
                        arrive = t + o.lead + (int(late_d[s, p, t]) if late else 0)
                        rem = max(int(o.exp_days) - o.lead, 3) if (o.exp_days and cat[p].shelf_life) else None
                        pipe[s][p].append((arrive, q, rem))
                        d["orders"] += 1
                        d["spend"] += q * float(price)
                        d["list_spend"] += q * float(o.list_price)
                dem = int(hist[s, p, t])
                sold = 0
                for x in L:
                    take = min(x[1], dem - sold)
                    x[1] -= take
                    sold += take
                    if sold >= dem:
                        break
                lots[s][p] = L = [x for x in L if x[1] > 0]
                i = t - T0
                d["demand"][i] += dem
                if dem > 0:
                    d["active"][i] += 1
                    if sold < dem:
                        d["stockout"][i] += 1
                        d["unmet"][i] += dem - sold
                lots[s][p] = L = [x for x in L if x[0] > t]
                d["hold"][i] += sum(x[1] for x in L) * cat[p].cost * HOLD_RATE / 365.0
    return d


def _decide_market(world, fc, market, mk, mode, s, p, t, today, position, on_hand, m28, sd28, avail, A0, dpagg, shock, d):
    cat = world.catalog[p]
    offers = [replace(o, avail=int(avail[(p, o.code)])) for o in market.offers[p]]
    i = s * world.P + p
    lead_min = min(o.lead for o in offers)
    rop = dyn_rop(m28, sd28, lead_min)
    if rop <= 0 or position > rop:
        return None
    f = fc["ENSEMBLE"][t - T0, i, :].astype(float)
    demand = Q.Demand(float(f[:7].mean()), float(sd28), f.tolist(), "forecast")
    q_paper = Q.paper_quantity(rop, position)
    perishable = cat.shelf_life is not None
    plans = {}
    for o in offers:
        c = cand(o, today)
        plans[o.code] = (o, c, Q.plan_quantity(c, position, q_paper, demand, REVIEW, perishable, cat.shelf_life, today))
    feas = {k: v for k, v in plans.items() if v[2].feasible}
    if not feas:
        return None
    sh = shock[t - 14:t]
    comp = [1.0 + float(x) for x in sh]
    prices = [float(B.tier_price(o.list_price, o.tiers, q_paper)) * (1.0 + float(shock[t])) for o in offers]
    hist_prices = [float(B.tier_price(offers[0].list_price, offers[0].tiers, q_paper)) * c for c in comp]
    dp, _ = F.demand_pressure(position, rop, demand.daily_mean, lead_min, SAFETY)
    pv, _ = F.price_volatility(prices, hist_prices)
    si, _ = F.seasonal_index(cat.category, float(f[:14].sum()), float(world.hist[s, p, max(t - 56, 0):t].mean()))
    cs, _ = F.competitive_signal(None, 0.5, comp)
    days_cover = on_hand / demand.daily_mean if demand.daily_mean and demand.daily_mean > 0 else None
    rank_in, quotes = [], {}
    for code, (o, c, qp) in feas.items():
        q = qp.quantity
        base = B.tier_price(o.list_price, o.tiers, q)
        scar = float(np.clip(1.0 - avail[(p, code)] / A0[(p, code)], 0.0, 1.0))
        mt = m_true(scar, dpagg, float(shock[t]))
        r_true = reservation(base, mt, o.max_disc, mk.span)
        sa_j = F.supplier_coverage(o.rel, o.avail, q)
        mhat = F.combine(dp, sa_j, pv, si, cs, settings.MPI_WEIGHTS)
        d["mhat"].append(mhat)
        d["mtrue"].append(mt)
        d["comp"].append((dp, 1.0 - sa_j, pv, si, cs))
        urg = B.urgency(days_cover, o.lead, SAFETY)
        if mode == "oracle":
            bnd = B.make_bounds(base, 0.5, o.max_disc, cat.retail, TARGET_MARGIN, urg)
            bnd = replace(bnd, floor=min(r_true, bnd.ceiling), mpi=mt)
        else:
            bnd = B.make_bounds(base, mhat if mode == "mpi" else 0.5, o.max_disc, cat.retail, TARGET_MARGIN, urg)
        res = negotiate(bnd, RuleVoice(), settings.LLM_PRICE_FLEX_PCT, {"quantity": q, "name": cat.name})
        d["attempts"] += 1
        if res.status != "ACCEPTED":
            continue
        d["accepted"] += 1
        tl = Q.timeline(position, demand, o.lead, o.rel, SAFETY, today)
        quotes[code] = (o, q, res.final_price, base, tl, r_true)
        rank_in.append({"id": code, "price": res.final_price, "reliability": o.rel, "expiry_risk": qp.expiry_risk, "l_eff": tl["effectiveLeadDays"],
                        "after_depletion": tl["effectiveLeadDays"] > tl["depletionInDays"] and tl["depletionInDays"] < 60})
    if not rank_in:
        d["no_order"] += 1
        return None
    order_ = {"ORDER_NOW": 0, "SOON": 1, "PLANNED": 2}
    urg_c = min((quotes[x["id"]][4]["urgency"] for x in rank_in), key=lambda k: order_[k])
    for r in Q.rank_suppliers(rank_in, urg_c, settings.RANKING_WEIGHTS):          # try quotes in ranked order; the wholesaler declines below its hidden minimum
        o, q, price, base, _, r_true = quotes[r["id"]]
        if price >= r_true:
            d["over_num"] += q * float(price - r_true)
            d["over_den"] += q * float(base)
            return o, q, price, base
        d["declines"] += 1
    d["no_order"] += 1
    return None


def summarise_market(d: dict) -> dict:
    act = d["active"].sum()
    mh, mt = np.array(d["mhat"]), np.array(d["mtrue"])
    cm = np.array(d["comp"]) if d["comp"] else np.zeros((0, 5))
    ccorr = [float(np.corrcoef(cm[:, j], mt)[0, 1]) if len(mt) > 2 and cm[:, j].std() > 0 and mt.std() > 0 else float("nan") for j in range(5)]
    corr = float(np.corrcoef(mh, mt)[0, 1]) if len(mh) > 2 and mh.std() > 0 and mt.std() > 0 else float("nan")
    return {"stockout": 100 * d["stockout"].sum() / max(act, 1), "hold": d["hold"].sum() / (C.N_STORES * len(d["hold"])),
            "price": 100 * d["spend"] / d["list_spend"] if d["list_spend"] else float("nan"), "lost": 100 * d["unmet"].sum() / max(d["demand"].sum(), 1),
            "decline_rate": 100 * d["declines"] / max(d["declines"] + d["orders"], 1), "no_order": d["no_order"], "orders": d["orders"],
            "overpay": 100 * d["over_num"] / d["over_den"] if d["over_den"] else float("nan"),
            "corr_mpi_vs_true": corr, "mae_mpi": float(np.abs(mh - mt).mean()) if len(mh) else float("nan"),
            "mae_static": float(np.abs(0.5 - mt).mean()) if len(mt) else float("nan"), "mean_mtrue": float(mt.mean()) if len(mt) else float("nan"), "comp_corr": ccorr}


METRICS = [("stockout", "Stockout rate (%)"), ("lost", "Lost sales (%)"), ("price", "Price (% of list)"), ("overpay", "Overpay above hidden minimum (% of list)"),
           ("decline_rate", "Wholesaler declines (% of order attempts)"), ("hold", "Holding cost (INR/store-day)")]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="0-9")
    ap.add_argument("--scenarios", default="0,1,2,3,4")
    a = ap.parse_args()
    seeds = parse_seeds(a.seeds)
    scen = [SCENARIOS[int(i)] for i in a.scenarios.split(",")]
    t_start = time.time()
    res = {mk.name: {m: [] for m in MODES} for mk in scen}
    for sd in seeds:
        fc = ensure(sd, 0.0)
        world = fc.pop("world")
        market = Market(world)
        for mk in scen:
            t0 = time.time()
            row = {}
            for m in MODES:
                row[m] = summarise_market(simulate_market(world, fc, market, mk, m))
                res[mk.name][m].append(row[m])
            print(f"seed {sd} | {mk.name:32s} " + "  ".join(f"{m}: so={row[m]['stockout']:.2f} price={row[m]['price']:.1f} dec={row[m]['decline_rate']:.1f}" for m in MODES) + f"  ({time.time() - t0:.0f}s)", flush=True)
    md = ["# E2b - MPI under a hidden market-dependent wholesaler minimum (assumed model; see script docstring)", "",
          f"{len(seeds)} seeds, same 120 SKUs x 3 stores and 30-day window as the main simulation (forecasts from the cached ensemble); CDIN off. Cells: mean ± std over seeds. "
          "`mpi` = floor from the live MPI; `static` = MPI fixed at 0.5 (w/o MPI); `oracle` = floor equals the wholesaler's hidden minimum.", ""]
    out = {"seeds": seeds, "scenarios": {}, "hardware": C.hardware()}
    for mk in scen:
        md += [f"## {mk.name}  (supplier stock {'catalog' if mk.tight is None else f'{mk.tight:g} x MOQ'}, price-shock sigma {mk.vol})", "",
               "| mode | " + " | ".join(m[1] for m in METRICS) + " | corr(MPI, M_true) | MAE of floor index |", "|---|" + "---|" * (len(METRICS) + 2)]
        for m in MODES:
            cells = []
            for k, _ in METRICS:
                xs = [r[k] for r in res[mk.name][m] if r[k] == r[k]]
                cells.append(f"{np.mean(xs):.2f} ± {np.std(xs, ddof=1):.2f}" if len(xs) > 1 else "n/a")
            corr = [r["corr_mpi_vs_true"] for r in res[mk.name][m]]
            mae = [r["mae_mpi"] if m == "mpi" else r["mae_static"] if m == "static" else 0.0 for r in res[mk.name][m]]
            md.append(f"| {m} | " + " | ".join(cells) + f" | {np.nanmean(corr):.2f} | {np.mean(mae):.3f} |")
        cc = np.nanmean([r["comp_corr"] for r in res[mk.name]["mpi"]], axis=0)
        md += ["", "Correlation with the hidden pressure M_true of each MPI input (mean over seeds): DP " + f"{cc[0]:.2f}, 1-SA {cc[1]:.2f}, PV {cc[2]:.2f}, SI {cc[3]:.2f}, CS {cc[4]:.2f}.",
               "", f"Headroom: static-to-oracle price gap {np.mean([r['price'] for r in res[mk.name]['static']]) - np.mean([r['price'] for r in res[mk.name]['oracle']]):.2f} points; the MPI captures {np.mean([r['price'] for r in res[mk.name]['static']]) - np.mean([r['price'] for r in res[mk.name]['mpi']]):.2f} of it.", "",
               "Paired differences, mpi minus static (per-seed means; paired t / Wilcoxon, Holm over the metrics of this scenario):", "",
               "| metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z |", "|---|---|---|---|---|---|---|"]
        tests = {k: paired([r[k] for r in res[mk.name]["mpi"]], [r[k] for r in res[mk.name]["static"]]) for k, _ in METRICS}
        adj = holm([tests[k]["p_t"] if tests[k]["p_t"] == tests[k]["p_t"] else 1.0 for k, _ in METRICS])
        for (k, lab), pa in zip(METRICS, adj):
            tt = tests[k]
            md.append(f"| {lab} | {tt['mean_diff']:.3f} | {tt['t']:.2f} | {tt['p_t']:.3g} | {pa:.3g} | {tt['p_wilcoxon']:.3g} | {tt['cohens_dz']:.2f} |")
        md.append("")
        out["scenarios"][mk.name] = {"results": res[mk.name], "tests_mpi_vs_static": tests, "holm": dict(zip([k for k, _ in METRICS], adj))}
    md.append(f"_Runtime {time.time() - t_start:.0f}s._")
    os.makedirs(C.OUT, exist_ok=True)
    open(os.path.join(C.OUT, "mpi_market_sim.md"), "w", encoding="utf8").write("\n".join(md))
    C.save_json("mpi_market_sim.json", out)
    print("\n".join(md))


if __name__ == "__main__":
    main()
