"""Mathematical economic bounds for negotiation (hallucination-proofing the LLM agents).

Paper:       Floor = Base*(0.80 + 0.10*MPI), Ceiling = Base, RetailerTarget = Base*0.82
Corrections: * the wholesaler additionally never goes below its own max-discount policy (Base*(1-maxDiscount))
             * the retailer has a *maximum acceptable price* (RMAP) derived from its retail price and target
               margin - without it the paper's final accept test (Floor <= 0.90*Base) is always true, so a
               negotiation could never be REJECTED.
Rounding:    floors round UP (the wholesaler never dips below its floor), RMAP rounds DOWN, others HALF_UP.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal

D = Decimal
CENT = D("0.01")


def d(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return D(str(x))


def q2(x, mode=ROUND_HALF_UP) -> Decimal:
    return d(x).quantize(CENT, rounding=mode)


def floor_price(base, mpi, max_discount_pct) -> Decimal:
    base, mpi = d(base), d(mpi)
    mpi = max(D(0), min(D(1), mpi))
    by_mpi = base * (D("0.80") + mpi * D("0.10"))
    by_policy = base * (D(1) - max(D(0), min(D("0.95"), d(max_discount_pct))))
    return min(q2(max(by_mpi, by_policy), ROUND_CEILING), q2(base))


def ceiling_price(base) -> Decimal:
    return q2(base)


def retailer_target(base) -> Decimal:
    return q2(d(base) * D("0.82"))


def urgency(days_cover, lead_days, safety_days) -> float:
    """u = clamp(1 - daysCover / (L + S), 0, 1); no demand estimate -> 0."""
    try:
        if days_cover is None or days_cover != days_cover or days_cover == float("inf"):
            return 0.0
        return max(0.0, min(1.0, 1.0 - float(days_cover) / max(float(lead_days) + float(safety_days), 1.0)))
    except (TypeError, ValueError):
        return 0.0


def rmap(base, retail_price, target_margin_pct, urg: float) -> Decimal:
    """Retailer maximum acceptable unit price.
    marginCap = retail*(1-margin);  RMAP = min(Base, marginCap*(1+0.05*u)).  No retail price -> 0.90*Base (paper)."""
    base = d(base)
    if retail_price is None or d(retail_price) <= 0:
        cap = base * D("0.90")
    else:
        cap = d(retail_price) * (D(1) - d(target_margin_pct)) * (D(1) + D("0.05") * d(round(urg, 4)))
    return max(q2(min(base, cap), ROUND_FLOOR), CENT)


@dataclass
class Bounds:
    base: Decimal
    floor: Decimal
    ceiling: Decimal
    target: Decimal
    rmap: Decimal
    mpi: float

    def as_dict(self) -> dict:
        return {"base": str(self.base), "floor": str(self.floor), "ceiling": str(self.ceiling), "retailerTarget": str(self.target),
                "retailerMax": str(self.rmap), "mpiUsed": round(self.mpi, 4)}


def make_bounds(base, mpi: float, max_discount_pct, retail_price, target_margin_pct, urg: float) -> Bounds:
    return Bounds(base=q2(base), floor=floor_price(base, mpi, max_discount_pct), ceiling=ceiling_price(base),
                  target=retailer_target(base), rmap=rmap(base, retail_price, target_margin_pct, urg), mpi=float(mpi))


def tier_price(list_price, tiers, qty: int) -> Decimal:
    """Volume price: the tier with the largest minQty <= qty, else list price."""
    best_min, price = -1, d(list_price)
    for t in tiers or []:
        try:
            mq, up = int(t.get("minQty")), d(t.get("unitPrice"))
        except (TypeError, ValueError, ArithmeticError):
            continue
        if qty >= mq > best_min and up > 0:
            best_min, price = mq, up
    return q2(price)
