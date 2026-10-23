"""Market Pulse Index factors (see docs/formulas.md).

The paper's MPI = w1*DP + w2*(1-SA) + w3*PV + w4*SI is extended with a fifth factor CS (the abstract says
"5-factor") and DP is corrected: the paper's DP = max(ROP,1)/max(ROP-stock,1) *decreases* as stock becomes more
critical, the opposite of the stated intent.  All factor functions are pure, never raise on bad data and return
(value, used_prior) so that NaN / missing inputs degrade to the paper's priors instead of poisoning the index.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from typing import Iterable, Sequence

SI_CATEGORY = {"ELECTRONICS": 0.78, "FOOD_BEVERAGE": 0.45, "OFFICE": 0.62, "LIFESTYLE": 0.82}
SI_DEFAULT = 0.62
SA_PRIOR = 0.65   # paper: "starts at 0.65"
PV_PRIOR = 0.42   # paper: "normalized to 0.42"
DP_PRIOR = 0.50
CS_NEUTRAL = 0.50


def ok(x) -> bool:
    return x is not None and isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def demand_pressure(stock, rop, daily_demand, lead_days: float, safety_days: float) -> tuple[float, bool]:
    """DP in [0.10, 0.95]; monotone non-increasing in stock.

    r  = 1 - stock / (2*max(ROP,1))                       (position vs reorder point)
    c  = 1 - (stock/v) / (2*(L+S))                        (days of cover vs lead time + safety)
    DP = 0.10 + 0.85 * (0.5 r + 0.5 c)                     cold start (no demand estimate): DP = 0.10 + 0.85 r
    """
    if not ok(stock) or not ok(rop):
        return DP_PRIOR, True
    r = clamp(1.0 - stock / (2.0 * max(rop, 1.0)))
    if ok(daily_demand):
        if daily_demand <= 0:
            c = 0.0
        else:
            horizon = 2.0 * max(lead_days + safety_days, 1.0)
            c = clamp(1.0 - (stock / daily_demand) / horizon)
        x = 0.5 * r + 0.5 * c
    else:
        x = r
    return 0.10 + 0.85 * x, False


@dataclass
class Offer:
    available: float
    reliability: float
    price: float
    lead_days: float = 3.0


def supplier_coverage(reliability: float, available: float, q_hat: float) -> float:
    if not (ok(reliability) and ok(available) and ok(q_hat)):
        return 0.0
    return clamp(reliability * min(available / max(q_hat, 1.0), 1.0))


def supply_availability(offers: Sequence[Offer], q_hat: float, freshness_hours: float | None) -> tuple[float, bool]:
    """SA in [0,1]; one fully capable reliable supplier ~ 0.5, two ~ 1.0, none 0.  The paper's 0.65 is the prior
    that stale catalog data decays towards (fresh <= 24h, fully stale >= 72h)."""
    if not offers:
        return 0.0, False
    data = clamp(sum(supplier_coverage(o.reliability, o.available, q_hat) for o in offers) / 2.0)
    if not ok(freshness_hours) or freshness_hours <= 24:
        f = 1.0
    else:
        f = clamp(1.0 - (freshness_hours - 24.0) / 48.0)
    return f * data + (1.0 - f) * SA_PRIOR, f < 1.0


def _cv(series: Iterable[float]) -> float | None:
    s = [p for p in series if ok(p) and p > 0]
    if len(s) < 2:
        return None
    m = statistics.fmean(s)
    return statistics.pstdev(s) / m if m > 0 else None


def price_volatility(prices_across_suppliers: Iterable[float], history_prices: Iterable[float]) -> tuple[float, bool]:
    """PV in [0,1] = clamp(max(CV_across, CV_history) / 0.20).  Prior 0.42 with < 2 observations."""
    cvs = [c for c in (_cv(prices_across_suppliers), _cv(history_prices)) if c is not None]
    if not cvs:
        return PV_PRIOR, True
    return clamp(max(cvs) / 0.20), False


def seasonal_index(category: str | None, forecast_14d_sum, trailing_mean_daily) -> tuple[float, bool]:
    """SI = clamp(SI_cat * m_t) with m_t = clamp(forecast14 / (14 * trailing mean), 0.5, 1.5)."""
    base = SI_CATEGORY.get((category or "").upper(), SI_DEFAULT)
    if ok(forecast_14d_sum) and ok(trailing_mean_daily) and trailing_mean_daily > 0:
        m = clamp(forecast_14d_sum / (14.0 * trailing_mean_daily), 0.5, 1.5)
        return clamp(base * m), False
    return clamp(base), True


def competitive_signal(rdi, macro, comp_prices_oldest_to_newest: Sequence[float] | None) -> tuple[float, bool]:
    """CS = 0.5*RDI + 0.3*MACRO + 0.2*COMP; neutral (0.5) for each missing input.
    RDI comes from the CDIN regional demand index, COMP from competitor price drift (rising prices = scarcity)."""
    rdi_v = rdi if ok(rdi) else CS_NEUTRAL
    macro_v = macro if ok(macro) else CS_NEUTRAL
    comp_v = CS_NEUTRAL
    have_comp = False
    if comp_prices_oldest_to_newest and len(comp_prices_oldest_to_newest) >= 2:
        first, last = comp_prices_oldest_to_newest[0], comp_prices_oldest_to_newest[-1]
        if ok(first) and ok(last) and first > 0:
            comp_v = 0.5 + 0.5 * math.tanh(5.0 * (last - first) / first)
            have_comp = True
    used_prior = not (ok(rdi) or ok(macro) or have_comp)
    return clamp(0.5 * rdi_v + 0.3 * macro_v + 0.2 * comp_v), used_prior


@dataclass
class MpiResult:
    mpi: float
    dp: float
    sa: float
    pv: float
    si: float
    cs: float
    trend: str = "STABLE"
    quality: str = "FULL"
    priors: list[str] = field(default_factory=list)


def combine(dp: float, sa: float, pv: float, si: float, cs: float, weights: Sequence[float]) -> float:
    w = list(weights) + [0.0] * (5 - len(weights))
    v = w[0] * dp + w[1] * (1.0 - sa) + w[2] * pv + w[3] * si + w[4] * cs
    return clamp(v if math.isfinite(v) else 0.5)


def trend_of(mpi: float, previous: float | None, band: float = 0.03) -> str:
    if previous is None or not ok(previous):
        return "STABLE"
    if mpi - previous > band:
        return "RISING"
    if mpi - previous < -band:
        return "FALLING"
    return "STABLE"


def assemble(dp, sa, pv, si, cs, prior_flags: dict[str, bool], weights: Sequence[float], previous: float | None) -> MpiResult:
    mpi = combine(dp, sa, pv, si, cs, weights)
    priors = [k for k, v in prior_flags.items() if v]
    if not priors:
        quality = "FULL"
    elif len(priors) >= 5:
        quality = "PRIOR_ONLY"
    else:
        quality = "PARTIAL"
    return MpiResult(mpi=round(mpi, 4), dp=round(dp, 4), sa=round(sa, 4), pv=round(pv, 4), si=round(si, 4), cs=round(cs, 4),
                     trend=trend_of(mpi, previous), quality=quality, priors=priors)
