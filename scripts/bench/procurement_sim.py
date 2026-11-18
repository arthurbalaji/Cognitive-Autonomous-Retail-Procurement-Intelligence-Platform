"""E2 / E3 / E6 - 30-day procurement simulation (policies, ablations, multi-seed statistics, sensitivity).

    python -m scripts.bench.procurement_sim --seeds 0-9 [--sensitivity]

World: 120 SKUs x 3 stores x 150 days of deterministic synthetic demand (scripts/datagen). Models are trained on days [0,120) and
never retrained; the policies then run for the 30 days [120,150) against the SAME realised demand and the SAME random supplier delays
(common random numbers), so policy differences are paired.

Policies (all use the inventory position = on-hand + on-order and place at most one order at a time per SKU):
  B1  static EOQ/ROP      ROP and EOQ frozen from the training region, cheapest-list supplier, tier price, no negotiation
  B2  isolated ML         rolling dynamic ROP + forecast-based quantity (app.negotiation.quantity), cheapest-list supplier, tier price
  CARPIP                  B2's trigger and quantity + CDIN regional uplift + MPI + bounded 3-turn negotiation with every supplier
                          (rule voice, i.e. the deterministic protocol) + supplier ranking - the engine's own functions, unchanged
Ablations: CARPIP without MPI (MPI_j fixed 0.5), without CDIN (no RDI uplift, neutral CS), without negotiation (pay tier price).
"""
from __future__ import annotations

import argparse
import math
import random
import warnings
import time
from dataclasses import dataclass, field, replace
from datetime import timedelta
from decimal import Decimal

import numpy as np
from scipy import stats

from app.config import settings
from app.mpi import factors as F
from app.negotiation import bounds as B
from app.negotiation import quantity as Q
from app.negotiation.protocol import RuleVoice, VoiceOut, negotiate
from scripts.bench import _common as C
from scripts.bench.prepare_forecasts import ensure, parse_seeds
from scripts.datagen import generate as G

warnings.filterwarnings("ignore", category=RuntimeWarning)
HOLD_RATE = 0.20           # annual inventory holding rate (of wholesale cost)
ORDER_COST = 400.0          # INR per order, used by the static EOQ only
TARGET_MARGIN = 0.25        # platform default retailer target margin
SAFETY, REVIEW = settings.SAFETY_DAYS, settings.REVIEW_DAYS
T0, T1 = C.TRAIN_END, C.N_DAYS


@dataclass
class Cfg:
    name: str
    policy: str                       # B1 | B2 | CARPIP
    mpi: bool = True
    cdin: bool = True
    negotiate: bool = True
    weights: tuple = tuple(settings.MPI_WEIGHTS)
    flex: float = settings.LLM_PRICE_FLEX_PCT
    voice: str = "rule"               # rule | noisy (adversarial +-5 % proposals, clamped by the protocol)
    ontime: float | None = None       # override every supplier's on-time probability
    rank: bool = True                 # False: take the cheapest accepted quote instead of the API ranking
    cdin_growth: str = "velocity"      # node growth ratio: velocity (last7/prev28, current code) | forecast (first prototype: forecast/recent)
    cover: float = 1.0                # scale of the initial stock (1.0 = generator default 12-30 days of cover; 0.4 = tight start)


class NoisyVoice(RuleVoice):
    """Stands in for a misbehaving LLM: proposes a price up to 5 % away from the deterministic one. The protocol must clamp it."""
    def __init__(self, rng: random.Random):
        self.rng = rng

    def speak(self, **kw) -> VoiceOut:
        out = super().speak(**kw)
        det = kw["det_price"]
        if det is not None:
            out.proposed_price = B.q2(det * Decimal(str(1 + self.rng.uniform(-0.05, 0.05))))
        return out


@dataclass
class Offer:
    code: str
    name: str
    list_price: Decimal
    tiers: list
    avail: int
    moq: int
    pack: int
    lead: int
    rel: float
    p_ontime: float
    max_disc: float
    shelf: int | None
    exp_days: float | None


class Market:
    def __init__(self, world: C.World, ontime: float | None = None):
        self.offers: list[list[Offer]] = [[] for _ in world.catalog]
        by_gtin = {p.gtin: p.idx for p in world.catalog}
        for code, w in G.WHOLESALERS.items():
            for it in G.wholesaler_catalog(world.catalog, code, world.seed, C.END):
                p = by_gtin[it["gtin"]]
                lots = it["lots"]
                exp = [l["expiryDays"] for l in lots if "expiryDays" in l]
                po = w["ontime"][0] / w["ontime"][1]
                self.offers[p].append(Offer(code, w["name"], B.d(it["tiers"][0]["unitPrice"]), it["tiers"], sum(l["qty"] for l in lots), it["moq"], it["packSize"],
                                            it["leadTimeDays"], (w["ontime"][0] + 2) / (w["ontime"][1] + 3) if ontime is None else ontime,
                                            po if ontime is None else ontime, it["maxDiscountPct"], it["shelfLifeDays"], float(np.mean(exp)) if exp else None))


def cand(o: Offer, today) -> Q.Candidate:
    return Q.Candidate(o.code, o.name, None, o.list_price, o.tiers, o.avail, o.moq, o.pack, o.lead, o.rel,
                       today + timedelta(days=int(min(o.exp_days, o.shelf or 9999))) if o.exp_days else None, o.shelf, o.max_disc)


def dyn_rop(mean28: float, sd28: float, lead: int) -> int:
    return 0 if mean28 <= 0 else int(math.ceil(mean28 * (lead + 3) + 1.65 * sd28 * math.sqrt(lead)))


def rdi_table(fc_ens: np.ndarray, hist: np.ndarray, t: int, P: int, mode: str = "velocity") -> np.ndarray:
    """Regional demand index per product on day t (NaN when < 2 nodes report): the CDIN procedure with equal node weights."""
    out = np.full(P, np.nan)
    growth = np.full((C.N_STORES, P), np.nan)
    for s in range(C.N_STORES):
        recent = hist[s, :, t - 14:t].mean(axis=1)
        ok = recent >= 0.5
        if mode == "velocity":
            num = hist[s, :, t - 7:t].mean(axis=1)
            den = hist[s, :, t - 35:t - 7].mean(axis=1)
        else:
            num = fc_ens[t - T0, s * P:(s + 1) * P, :14].mean(axis=1)
            den = recent
        r = np.clip(np.where(ok, num / np.maximum(den, 1e-9), np.nan), 0.5, 2.0)
        growth[s] = np.round(np.round(r / 0.05) * 0.05, 2)
    n = np.sum(~np.isnan(growth), axis=0)
    mean = np.nanmean(np.where(np.isnan(growth), np.nan, growth), axis=0)
    ok = n >= 2
    out[ok] = np.clip(0.5 + 0.5 * np.tanh(3.0 * (mean[ok] - 1.0)), 0, 1)
    return out


def simulate(world: C.World, fc: dict, market: Market, cfg: Cfg) -> dict:
    P, hist, cat = world.P, world.hist, world.catalog
    ens = fc["ENSEMBLE"]
    rng_late = np.random.default_rng(world.seed * 31 + 5)
    late_u = rng_late.random((C.N_STORES, P, C.N_DAYS))
    late_d = rng_late.integers(1, 4, (C.N_STORES, P, C.N_DAYS))
    voice_rng = random.Random(world.seed * 17 + 3)
    stock0 = [{k: int(round(v * cfg.cover)) for k, v in G.initial_stock(cat, hist[s][:, :T0], s, world.seed, set()).items()} for s in range(C.N_STORES)]
    lots = [[[[10 ** 9, stock0[s][cat[p].sku]]] if stock0[s][cat[p].sku] > 0 else [] for p in range(P)] for s in range(C.N_STORES)]
    pipe: list[list[list]] = [[[] for _ in range(P)] for _ in range(C.N_STORES)]       # (arrive_day, qty, shelf_remaining|None)
    cheapest = [min(o, key=lambda x: x.list_price) if (o := market.offers[p]) else None for p in range(P)]
    # static B1 parameters from the training region
    b1 = {}
    for s in range(C.N_STORES):
        for p in range(P):
            o = cheapest[p]
            if o is None:
                continue
            m, sd = hist[s, p, :T0].mean(), hist[s, p, :T0].std()
            rop = dyn_rop(m, sd, o.lead)
            eoq = math.sqrt(2 * m * 365 * ORDER_COST / (HOLD_RATE * float(o.list_price))) if m > 0 else 0
            q = max(int(math.ceil(eoq)), o.moq)
            q = int(math.ceil(q / o.pack)) * o.pack
            b1[(s, p)] = (rop, min(q, (o.avail // o.pack) * o.pack))
    z = lambda: np.zeros(T1 - T0)
    d = dict(stockout=z(), active=z(), unmet=z(), demand=z(), hold=z(), orders=0, attempts=0, accepted=0, rejected_po=0, spend=0.0, list_spend=0.0, tier_spend=0.0,
             units_in=0.0, expired=0.0, violations=0, interventions=0)
    for t in range(T0, T1):
        today = C.START + timedelta(days=t)
        rdi = rdi_table(ens, hist, t, P, cfg.cdin_growth) if cfg.cdin and cfg.policy == "CARPIP" else None
        for s in range(C.N_STORES):
            for p in range(P):
                L = lots[s][p]
                # 1) receive
                keep = []
                for a, q, rem in pipe[s][p]:
                    if a <= t:
                        L.append([a + rem if rem is not None else 10 ** 9, q])
                        d["units_in"] += q
                    else:
                        keep.append((a, q, rem))
                pipe[s][p] = keep
                L.sort()
                on_hand = sum(x[1] for x in L)
                on_order = sum(q for _, q, _ in keep)
                position = on_hand + on_order
                # 2) order decision (information up to day t-1)
                offers = market.offers[p]
                if offers:
                    m28, sd28 = hist[s, p, t - 28:t].mean(), hist[s, p, t - 28:t].std()
                    order = _decide(world, fc, market, cfg, s, p, t, today, position, on_hand, m28, sd28, rdi, b1, cheapest, voice_rng, d)
                    if order:
                        o, q, price, tier_price = order
                        late = late_u[s, p, t] > o.p_ontime
                        arrive = t + o.lead + (int(late_d[s, p, t]) if late else 0)
                        rem = max(int(o.exp_days) - o.lead, 3) if (o.exp_days and cat[p].shelf_life) else None
                        pipe[s][p].append((arrive, q, rem))
                        d["orders"] += 1
                        d["spend"] += q * float(price)
                        d["list_spend"] += q * float(o.list_price)
                        d["tier_spend"] += q * float(tier_price)
                # 3) sell (FEFO)
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
                # 4) expire, hold
                for x in L:
                    if x[0] <= t:
                        d["expired"] += x[1]
                lots[s][p] = L = [x for x in L if x[0] > t]
                d["hold"][i] += sum(x[1] for x in L) * cat[p].cost * HOLD_RATE / 365.0
    return d


def _decide(world, fc, market, cfg, s, p, t, today, position, on_hand, m28, sd28, rdi, b1, cheapest, voice_rng, d):
    cat = world.catalog[p]
    offers = market.offers[p]
    i = s * world.P + p
    if cfg.policy == "B1":
        rop, q = b1[(s, p)]
        if rop > 0 and position <= rop and q > 0:
            o = cheapest[p]
            tp = B.tier_price(o.list_price, o.tiers, q)
            return o, q, tp, tp
        return None
    lead_min = min(o.lead for o in offers)
    rop = dyn_rop(m28, sd28, lead_min)
    if rop <= 0 or position > rop:
        return None
    f = fc["ENSEMBLE"][t - T0, i, :].astype(float)
    u = 1.0
    r = None
    if cfg.policy == "CARPIP" and cfg.cdin and rdi is not None and not math.isnan(rdi[p]):
        r = float(rdi[p])
        u = float(np.clip(1.0 + 0.6 * (r - 0.5), 0.8, 1.3))
    f = f * u
    demand = Q.Demand(float(f[:7].mean()), float(sd28), f.tolist(), "forecast")
    q_paper = Q.paper_quantity(rop, position)
    perishable = cat.shelf_life is not None
    plans = {}
    for o in offers:
        c = cand(o, today)
        qp = Q.plan_quantity(c, position, q_paper, demand, REVIEW, perishable, cat.shelf_life, today)
        plans[o.code] = (o, c, qp)
    if cfg.policy == "B2":
        o, c, qp = plans[cheapest[p].code]
        if not qp.feasible:
            return None
        tp = B.tier_price(o.list_price, o.tiers, qp.quantity)
        return o, qp.quantity, tp, tp
    # ---- CARPIP: MPI -> per-supplier bounds -> bounded negotiation -> ranking
    feas = {k: v for k, v in plans.items() if v[2].feasible}
    if not feas:
        return None
    prices = [float(B.tier_price(o.list_price, o.tiers, q_paper)) for o in offers]
    dp, _ = F.demand_pressure(position, rop, demand.daily_mean, lead_min, SAFETY)
    pv, _ = F.price_volatility(prices, [])
    trailing = world.hist[s, p, max(t - 56, 0):t].mean()
    si, _ = F.seasonal_index(cat.category, float(f[:14].sum()), float(trailing))
    cs, _ = F.competitive_signal(r, 0.5, None)
    days_cover = on_hand / demand.daily_mean if demand.daily_mean and demand.daily_mean > 0 else None
    rank_in, quotes = [], {}
    for code, (o, c, qp) in feas.items():
        q = qp.quantity
        base = B.tier_price(o.list_price, o.tiers, q)
        sa_j = F.supplier_coverage(o.rel, o.avail, q)
        mpi_j = 0.5 if not cfg.mpi else F.combine(dp, sa_j, pv, si, cs, cfg.weights)
        bnd = B.make_bounds(base, mpi_j, o.max_disc, cat.retail, TARGET_MARGIN, B.urgency(days_cover, o.lead, SAFETY))
        if cfg.negotiate:
            voice = NoisyVoice(voice_rng) if cfg.voice == "noisy" else RuleVoice()
            res = negotiate(bnd, voice, cfg.flex, {"quantity": q, "name": cat.name})
            d["attempts"] += 1
            d["interventions"] += res.interventions
            if res.status != "ACCEPTED":
                continue
            if not (bnd.floor <= res.final_price <= bnd.rmap):
                d["violations"] += 1
            d["accepted"] += 1
            price = res.final_price
        else:
            price = base
        tl = Q.timeline(position, demand, o.lead, o.rel, SAFETY, today)
        quotes[code] = (o, q, price, base, tl)
        rank_in.append({"id": code, "price": price, "reliability": o.rel, "expiry_risk": qp.expiry_risk, "l_eff": tl["effectiveLeadDays"],
                        "after_depletion": tl["effectiveLeadDays"] > tl["depletionInDays"] and tl["depletionInDays"] < 60})
    if not rank_in:
        d["rejected_po"] += 1
        return None
    order_ = {"ORDER_NOW": 0, "SOON": 1, "PLANNED": 2}
    urg = min((quotes[x["id"]][4]["urgency"] for x in rank_in), key=lambda k: order_[k])
    best = Q.rank_suppliers(rank_in, urg, settings.RANKING_WEIGHTS)[0]["id"] if cfg.rank else min(rank_in, key=lambda x: (x["price"], x["id"]))["id"]
    o, q, price, base, _ = quotes[best]
    return o, q, price, base


# ----------------------------------------------------------------------------- statistics
METRICS = [("stockout", "Stockout rate (% SKU-days with unmet demand)"), ("hold", "Holding cost (INR per store-day)"),
           ("price", "Average purchase price (% of list)"), ("lost", "Lost sales (% of demand units)"),
           ("expired", "Expired units (% of received)"), ("neg_success", "Negotiation success (%)")]


def summarise(d: dict) -> dict:
    act = d["active"].sum()
    return {"stockout": 100 * d["stockout"].sum() / max(act, 1), "hold": d["hold"].sum() / (C.N_STORES * len(d["hold"])),
            "price": 100 * d["spend"] / d["list_spend"] if d["list_spend"] else float("nan"),
            "lost": 100 * d["unmet"].sum() / max(d["demand"].sum(), 1), "expired": 100 * d["expired"] / max(d["units_in"], 1),
            "neg_success": 100 * d["accepted"] / d["attempts"] if d["attempts"] else float("nan"),
            "orders": d["orders"], "attempts": d["attempts"], "violations": d["violations"], "interventions": d["interventions"],
            "po_rejected": d["rejected_po"],
            "daily_stockout": (100 * d["stockout"] / np.maximum(d["active"], 1)).tolist(), "daily_hold": (d["hold"] / C.N_STORES).tolist()}


def holm(ps: list[float]) -> list[float]:
    order = np.argsort(ps)
    adj = [0.0] * len(ps)
    run = 0.0
    for rank, k in enumerate(order):
        run = max(run, min(1.0, (len(ps) - rank) * ps[k]))
        adj[k] = run
    return adj


def paired(a, b) -> dict:
    a, b = np.asarray(a, float), np.asarray(b, float)
    dlt = a - b
    n = len(dlt)
    t = stats.ttest_rel(a, b)
    try:
        w = stats.wilcoxon(a, b)
        wp = float(w.pvalue)
    except ValueError:
        wp = float("nan")
    sd = dlt.std(ddof=1) if n > 1 else float("nan")
    return {"n": n, "mean_diff": float(dlt.mean()), "t": float(t.statistic), "p_t": float(t.pvalue), "p_wilcoxon": wp,
            "cohens_dz": float(dlt.mean() / sd) if sd and sd > 0 else float("nan")}


def run_configs(seeds: list[int], cfgs: list[Cfg], vol: float = 0.0, log=print) -> dict:
    res = {c.name: [] for c in cfgs}
    for sd in seeds:
        fc = ensure(sd, vol, log=log)
        world = fc.pop("world")
        t0 = time.time()
        mk = {}
        for c in cfgs:
            key = c.ontime
            if key not in mk:
                mk[key] = Market(world, key)
            res[c.name].append(summarise(simulate(world, fc, mk[key], c)))
        log(f"  seed {sd} vol {vol}: " + "  ".join(f"{c.name}={res[c.name][-1]['stockout']:.2f}%/{res[c.name][-1]['hold']:.0f}INR" for c in cfgs) + f"  ({time.time() - t0:.0f}s)")
    return res


def table(res: dict, names: list[str], metrics=METRICS) -> list[str]:
    lines = ["| Configuration | " + " | ".join(m[1] for m in metrics) + " |", "|---|" + "---|" * len(metrics)]
    for n in names:
        row = []
        for k, _ in metrics:
            xs = [r[k] for r in res[n] if not math.isnan(r[k])]
            if not xs:
                row.append("n/a")
                continue
            mu, sd, lo, hi = C.mean_ci(xs)
            row.append(f"{mu:.2f} ± {sd:.2f} [{lo:.2f}, {hi:.2f}]")
        lines.append(f"| {n} | " + " | ".join(row) + " |")
    return lines


def report_section(res: dict, title: str, out: dict, key: str, with_table: bool = False) -> list[str]:
    md = [f"## {title}", ""]
    if with_table:
        md += table(res, [c for c in res]) + [""]
    tests, fam = {}, []
    for ref in ("B1 static EOQ/ROP", "B2 isolated ML"):
        for k, label in METRICS[:4]:
            tests[(ref, k)] = paired([r[k] for r in res["CARPIP (full)"]], [r[k] for r in res[ref]])
            fam.append((ref, k))
        for k, dk in (("stockout", "daily_stockout"), ("hold", "daily_hold")):
            tests[(ref, k + "_daily")] = paired(np.mean([r[dk] for r in res["CARPIP (full)"]], axis=0), np.mean([r[dk] for r in res[ref]], axis=0))
            fam.append((ref, k + "_daily"))
    adj = holm([tests[f]["p_t"] if not math.isnan(tests[f]["p_t"]) else 1.0 for f in fam])
    md += ["Paired tests, CARPIP (full) minus baseline. Plain rows pair the per-seed means (n = seeds); `_daily` rows pair the 30 daily values averaged over seeds. Holm-adjusted over all rows.", "",
           "| Baseline | Metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z | n |", "|---|---|---|---|---|---|---|---|---|"]
    for f, pa in zip(fam, adj):
        tt = tests[f]
        md.append(f"| {f[0]} | {f[1]} | {tt['mean_diff']:.3f} | {tt['t']:.2f} | {tt['p_t']:.4g} | {pa:.4g} | {tt['p_wilcoxon']:.4g} | {tt['cohens_dz']:.2f} | {tt['n']} |")
    out.setdefault("tests", {})[key] = {f"{k[0]}|{k[1]}": v for k, v in tests.items()}
    out.setdefault("holm_p", {})[key] = {f"{f[0]}|{f[1]}": p for f, p in zip(fam, adj)}
    md += ["", f"Safety counters over all CARPIP runs in this regime: price-bound violations = {sum(r['violations'] for r in res['CARPIP (full)'])}, "
               f"guardrail interventions = {sum(r['interventions'] for r in res['CARPIP (full)'])}", ""]
    return md


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="0-9")
    ap.add_argument("--sensitivity", action="store_true")
    ap.add_argument("--sens-seeds", default="0-2")
    ap.add_argument("--vols", type=float, nargs="*", default=[0.25, 0.5])
    a = ap.parse_args()
    seeds = parse_seeds(a.seeds)
    t_start = time.time()
    main_cfgs = [Cfg("B1 static EOQ/ROP", "B1", mpi=False, cdin=False, negotiate=False), Cfg("B2 isolated ML", "B2", mpi=False, cdin=False, negotiate=False),
                 Cfg("CARPIP (full)", "CARPIP"), Cfg("CARPIP w/o MPI", "CARPIP", mpi=False), Cfg("CARPIP w/o CDIN", "CARPIP", cdin=False),
                 Cfg("CARPIP w/o negotiation", "CARPIP", negotiate=False), Cfg("CARPIP w/o ranking", "CARPIP", rank=False),
                 Cfg("CARPIP (forecast-ratio CDIN)", "CARPIP", cdin_growth="forecast")]
    print(f"== main experiment: seeds {seeds}")
    res = run_configs(seeds, main_cfgs)
    names = [c.name for c in main_cfgs]
    out = {"seeds": seeds, "hardware": C.hardware(), "settings": {"hold_rate": HOLD_RATE, "order_cost": ORDER_COST, "target_margin": TARGET_MARGIN, "mpi_weights": settings.MPI_WEIGHTS,
           "skus": 120, "stores": 3, "train_days": T0, "eval_days": T1 - T0}, "results": res}

    md = ["# E2/E3/E6 - 30-day procurement simulation (synthetic data, rule-voice protocol)", "",
          f"{len(seeds)} seeds, 120 SKUs x 3 stores, 30 evaluation days, forecasts from the platform ensemble trained on days 0-119. Cells: mean ± std [95 % bootstrap CI] over seeds.",
          f"Holding rate {HOLD_RATE:.0%} p.a., static-EOQ order cost INR {ORDER_COST:.0f}, retailer target margin {TARGET_MARGIN:.0%}. Hardware: {C.hardware()}", ""]
    md += table(res, names) + [""]

    md += report_section(res, "Main regime (generator default initial stock)", out, "main")
    tight = run_configs(seeds, [replace(c, cover=0.4) for c in main_cfgs])
    out["tight_results"] = tight
    md += report_section(tight, "Tight-start regime (initial stock x 0.4)", out, "tight", with_table=True)

    if a.sensitivity:
        ss = parse_seeds(a.sens_seeds)
        md += ["## Sensitivity (seeds " + ",".join(map(str, ss)) + "; CARPIP full vs B1 unless noted)", ""]
        sens = {}
        full = Cfg("CARPIP (full)", "CARPIP")
        b1 = Cfg("B1 static EOQ/ROP", "B1", mpi=False, cdin=False, negotiate=False)
        # supplier reliability
        for ot in (0.95, 0.85, 0.70):
            sens[f"ontime={ot}"] = run_configs(ss, [replace(full, name="CARPIP", ontime=ot), replace(b1, name="B1", ontime=ot)])
        # MPI weights +-20 % each, renormalised
        base_w = np.array(settings.MPI_WEIGHTS)
        for j in range(5):
            for sign in (-1, 1):
                w = base_w.copy()
                w[j] *= 1 + 0.2 * sign
                w = tuple((w / w.sum()).tolist())
                sens[f"w{j + 1}{'+' if sign > 0 else '-'}20%"] = run_configs(ss, [replace(full, name="CARPIP", weights=w)])
        # LLM price flex with an adversarial voice
        for fx in (0.0, 0.01, 0.03):
            sens[f"flex={fx}"] = run_configs(ss, [replace(full, name="CARPIP", flex=fx, voice="noisy")])
        # demand volatility (needs forecasts trained on the noisier worlds; prepare_forecasts --vol 0.25 0.5)
        for v in a.vols:
            try:
                sens[f"vol={v}"] = run_configs(ss, [replace(full, name="CARPIP"), replace(b1, name="B1")], vol=v)
            except Exception as e:  # noqa: BLE001
                print("vol", v, "failed:", e)
        out["sensitivity"] = sens
        small = METRICS[:4]
        md += ["| Scenario | Config | " + " | ".join(m[1] for m in small) + " | bound violations |", "|---|---|" + "---|" * (len(small) + 1)]
        for scen, rr in sens.items():
            for cn, rows in rr.items():
                cells = []
                for k, _ in small:
                    xs = [r[k] for r in rows if not math.isnan(r[k])]
                    cells.append(f"{np.mean(xs):.2f}" if xs else "n/a")
                md.append(f"| {scen} | {cn} | " + " | ".join(cells) + f" | {sum(r['violations'] for r in rows)} |")
        md.append("")
    md.append(f"_Total runtime {time.time() - t_start:.0f}s._")
    import os
    os.makedirs(C.OUT, exist_ok=True)
    open(os.path.join(C.OUT, "procurement_sim.md"), "w", encoding="utf8").write("\n".join(md))
    C.save_json("procurement_sim.json", out)
    print("\n".join(md))


if __name__ == "__main__":
    main()
