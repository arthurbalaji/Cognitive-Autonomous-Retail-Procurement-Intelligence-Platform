"""Adaptive Procurement Intelligence (API) algorithm: optimal quantity Q, ordering timeline T, ranked suppliers.

Paper:  Q = max((ROP - stock)*2, 50)  (kept as the *floor*)
Ours:   Q = max(Q_paper, Q_forecast) where Q_forecast = ceil(D*(L+R) + SS - position),  SS = 1.65*sigma*sqrt(L)
        then per supplier: shelf-life cap (perishables), MOQ, pack size, availability, with a reason code for every change.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal


def paper_quantity(rop: int, position: int) -> int:
    return max((rop - position) * 2, 50)


@dataclass
class Demand:
    daily_mean: float | None
    daily_sigma: float | None
    forecast: list[float]          # next H days (may be empty)
    source: str = "none"           # forecast | sales | none


@dataclass
class Candidate:
    supplier_id: str
    alias: str
    supplier_sku: str | None
    list_price: Decimal
    tiers: list
    available: int
    moq: int
    pack: int
    lead_days: int
    reliability: float
    nearest_expiry: date | None
    shelf_life_days: int | None
    max_discount: float


@dataclass
class QuantityPlan:
    quantity: int
    feasible: bool
    excluded_reason: str | None
    reasons: list[str] = field(default_factory=list)
    forecast_based: int = 0
    paper_floor: int = 0
    expiry_risk: float = 0.0


def plan_quantity(c: Candidate, position: int, q_paper: int, demand: Demand, review_days: int, perishable: bool,
                  product_shelf_life: int | None, today: date) -> QuantityPlan:
    L = max(int(c.lead_days), 0)
    mean = demand.daily_mean if demand.daily_mean and demand.daily_mean > 0 else 0.0
    sigma = demand.daily_sigma if demand.daily_sigma and demand.daily_sigma > 0 else 0.0
    ss = 1.65 * sigma * math.sqrt(max(L, 1))
    q_fc = math.ceil(max(0.0, mean * (L + review_days) + ss - position)) if mean > 0 else 0
    q = max(q_paper, q_fc)
    reasons: list[str] = []
    if q_fc > q_paper:
        reasons.append("FORECAST_DRIVEN")

    expiry_risk = 0.0
    if perishable:
        remaining = None
        if c.nearest_expiry:
            remaining = (c.nearest_expiry - today).days - L
        elif c.shelf_life_days or product_shelf_life:
            remaining = int(c.shelf_life_days or product_shelf_life) - L
        if remaining is not None:
            if remaining <= 2:
                return QuantityPlan(0, False, "EXPIRY_RISK", ["SHELF_LIFE_TOO_SHORT"], q_fc, q_paper, 1.0)
            if mean > 0:
                cap = int(math.floor(mean * (remaining - 2)))
                if cap < q:
                    q = max(cap, 1)
                    reasons.append("Q_CAPPED_BY_SHELF_LIFE")
                expiry_risk = max(0.0, min(1.0, (q / mean) / max(remaining, 1)))
    if q < c.moq:
        q = c.moq
        reasons.append("MOQ_APPLIED")
    pack = max(c.pack, 1)
    if pack > 1 and q % pack:
        q = int(math.ceil(q / pack)) * pack
        reasons.append("PACK_ROUNDED")
    if q > c.available:
        q = (c.available // pack) * pack
        reasons.append("PARTIAL_AVAILABILITY")
    if q <= 0 or q < c.moq:
        return QuantityPlan(max(q, 0), False, "BELOW_MOQ" if c.available > 0 else "OUT_OF_STOCK", reasons, q_fc, q_paper, expiry_risk)
    return QuantityPlan(q, True, None, reasons, q_fc, q_paper, expiry_risk)


# ----------------------------------------------------------------------------- timeline
def depletion_day(position: float, safety_stock: float, demand: Demand) -> int:
    """Index (days from today) at which cumulative demand exhausts `position - SS`. Capped at 60."""
    avail = max(position - safety_stock, 0.0)
    if avail <= 0:
        return 0
    cum = 0.0
    for i, y in enumerate(demand.forecast):
        cum += max(y, 0.0)
        if cum >= avail:
            return i
    mean = demand.daily_mean or 0.0
    if mean > 0:
        extra_start = len(demand.forecast)
        remaining = avail - cum
        return min(60, extra_start + int(remaining / mean))
    return 60


def timeline(position: float, demand: Demand, lead_days: int, reliability: float, safety_days: int, today: date) -> dict:
    sigma = demand.daily_sigma or 0.0
    ss = 1.65 * sigma * math.sqrt(max(lead_days, 1))
    dep = depletion_day(position, ss, demand)
    l_eff = lead_days * (1.0 + 0.5 * (1.0 - max(0.0, min(1.0, reliability))))
    l_eff_days = int(math.ceil(l_eff))
    order_by = today + timedelta(days=dep - l_eff_days - 1)
    delta = (order_by - today).days
    urgency = "ORDER_NOW" if delta <= 0 else "SOON" if delta <= 3 else "PLANNED"
    return {
        "depletionDate": (today + timedelta(days=dep)).isoformat(),
        "orderByDate": order_by.isoformat() if delta > 0 else today.isoformat(),
        "expectedDeliveryDate": (today + timedelta(days=l_eff_days)).isoformat(),
        "urgency": urgency,
        "effectiveLeadDays": l_eff_days,
        "depletionInDays": dep,
    }


# ----------------------------------------------------------------------------- ranking
def rank_suppliers(items: list[dict], urgency: str, weights: dict) -> list[dict]:
    """items: [{id, price(Decimal), reliability, expiry_risk, l_eff, after_depletion(bool)}] -> same dicts + score/rank.

    score = 0.40*price + 0.25*reliability + 0.15*(1-expiryRisk) + 0.20*lead   (weights renormalised; lead x2 when ORDER_NOW)
    price/lead are min-max normalised among the candidates; suppliers delivering after depletion lose 0.20.
    Deterministic total order: score desc, price asc, id asc.
    """
    if not items:
        return []
    w = dict(weights)
    if urgency == "ORDER_NOW":
        w["lead"] = w["lead"] * 2.0
    total = sum(w.values())
    w = {k: v / total for k, v in w.items()}
    prices = [float(i["price"]) for i in items]
    leads = [float(i["l_eff"]) for i in items]
    pmin, pmax, lmin, lmax = min(prices), max(prices), min(leads), max(leads)
    out = []
    for i in items:
        p_score = 1.0 if pmax == pmin else 1.0 - (float(i["price"]) - pmin) / (pmax - pmin)
        l_score = 1.0 if lmax == lmin else 1.0 - (float(i["l_eff"]) - lmin) / (lmax - lmin)
        breakdown = {
            "price": round(p_score, 4),
            "reliability": round(float(i["reliability"]), 4),
            "expiry": round(1.0 - float(i["expiry_risk"]), 4),
            "lead": round(l_score, 4),
        }
        score = w["price"] * p_score + w["reliability"] * breakdown["reliability"] + w["expiry"] * breakdown["expiry"] + w["lead"] * l_score
        if i.get("after_depletion"):
            score -= 0.20
        out.append({**i, "score": round(score, 4), "breakdown": breakdown})
    out.sort(key=lambda r: (-r["score"], float(r["price"]), r["id"]))
    for n, r in enumerate(out, start=1):
        r["rank"] = n
    return out
