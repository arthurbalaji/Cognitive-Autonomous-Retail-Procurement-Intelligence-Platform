# Formulas (as implemented; golden cases live in `carpip-intelligence/tests/test_math.py`)

Conventions: money is `Decimal` with 2 dp; **floor price rounds up, retailer-max rounds down**, everything else half-up. Days are IST business days.

## Market Pulse Index (per SKU, every 15 min; `app/mpi/factors.py`)
`MPI = 0.315*DP + 0.225*(1-SA) + 0.18*PV + 0.18*SI + 0.10*CS`, clamped to [0,1]. 0 = buyer's market, 1 = seller's market.

* **DP** demand pressure in [0.10, 0.95], non-increasing in stock: `r = clamp(1 - pos/(2 max(ROP,1)))`, `c = clamp(1 - (pos/v)/(2(L+S)))`, `DP = 0.10 + 0.85(0.5r + 0.5c)`; no demand estimate -> `0.10 + 0.85 r`. (`pos` = stock + on-order; `v` = forecast mean of the next 7 days, else trailing 28-day mean; `L` = shortest supplier lead time; `S` = safety days.) Example ROP 40, v 8, L 3, S 3: stock 60 -> 0.366, 20 -> 0.755, 0 -> 0.95.
* **SA** supply availability: `clamp(sum_j rel_j * min(avail_j/Q, 1) / 2)` over trade-related suppliers (one fully capable supplier ~0.5, two ~1.0, none 0); blends towards the paper's 0.65 prior as catalog data goes stale (24 h fresh -> 72 h stale).
* **PV** price volatility: `clamp(max(CV_across_suppliers, CV_30d_history) / 0.20)`; prior 0.42 with < 2 observations.
* **SI** seasonal index: `clamp(SI_category * clamp(forecast14 / (14 * trailing56mean), 0.5, 1.5))`; `SI_category` = Electronics 0.78, Food & beverage 0.45, Office 0.62, Lifestyle 0.82.
* **CS** `0.5*RDI + 0.3*MACRO + 0.2*COMP`; RDI = CDIN regional demand index (0.5 neutral), MACRO = system setting (0.5), COMP = `0.5 + 0.5 tanh(5*d%)` of competitor prices over 14 days.
* Any NaN/None input degrades that factor to its prior; `quality` = FULL / PARTIAL / PRIOR_ONLY. `trend` = RISING/FALLING/STABLE at +-0.03 vs the previous snapshot.
* Supplier-specific `MPI_j` replaces SA by `rel_j * min(avail_j/Q_j,1)`.

## Negotiation bounds and protocol (`app/negotiation/bounds.py`, `protocol.py`)
```
Floor_j   = max( Base_j*(0.80 + 0.10*MPI_j), Base_j*(1 - maxDiscount_j) )      (rounded UP)       Ceiling = Base_j (volume-tier price at Q_j)
Target    = 0.82*Base_j
RMAP      = min( Base_j, retailPrice*(1 - targetMargin)*(1 + 0.05*urgency) )   (rounded DOWN)       urgency = clamp(1 - daysCover/(L+S))
T1  Retailer OFFER  bid = min(Target, RMAP)          Wholesaler: bid >= Floor ? ACCEPT : COUNTER (Base+Floor)/2
T2  Retailer OFFER  mid = min((bid+counter)/2, RMAP) Wholesaler: mid >= Floor ? ACCEPT : FINAL_OFFER Floor
T3  Retailer: finalOffer <= RMAP ? ACCEPT : REJECT
```
Invariants (property-tested with adversarial voices): every wholesaler price in [Floor, Ceiling]; every accepted price in [Floor, RMAP]; at most 3 retailer turns. Worked examples: Base 100, MPI .7, retail 125, margin .3 -> Floor 87, RMAP 89.25, accepted at T2 for 87.75; MPI .9, retail 115, margin .25 -> Floor 89 > RMAP 86.25 -> REJECTED.

## Adaptive procurement intelligence (`app/negotiation/quantity.py`)
* `Q_paper = max((ROP - position)*2, 50)` (floor); `Q_forecast = ceil(D*(L+R) + 1.65*sigma*sqrt(L) - position)` with review period `R = 7`; `Q = max(both)`.
* Per supplier: perishable shelf-life cap `D*(remainingShelfLife - 2)` -> MOQ -> pack rounding -> availability (partial -> floor to pack); infeasible if `< MOQ`. Reason codes: `FORECAST_DRIVEN, Q_CAPPED_BY_SHELF_LIFE, MOQ_APPLIED, PACK_ROUNDED, PARTIAL_AVAILABILITY`.
* Timeline: `depletion` = first day cumulative forecast reaches `position - SS`; `L_eff = L*(1 + 0.5(1 - reliability))`; `orderBy = depletion - L_eff - 1 day`; urgency ORDER_NOW / SOON (<= 3 d) / PLANNED.
* Ranking among ACCEPTED, feasible quotes: `0.40*price + 0.25*reliability + 0.15*(1-expiryRisk) + 0.20*lead` (lead weight x2 when ORDER_NOW; -0.20 if delivery lands after depletion); deterministic tie-break (score, price, id). Reliability is the ERP's laplace-smoothed on-time rate `(onTime+2)/(total+3)` over 90 days.

## Dynamic reorder point (`catalog/RopService`, hourly)
`ROP = ceil(mean28 * (L + 3) + 1.65 * sd28 * sqrt(L))`; ROP 0 when there is no recent demand (never auto-reorders). A manual override (`rop_source = MANUAL`) is respected.

## Forecasting and CDIN (`app/forecasting`, `app/cdin`)
Per-tenant ensemble of LSTM (64->32, dropout .2), 2-layer Transformer (4 heads, d 64, ff 128), XGBoost (multi-output); 30-day window -> 14-day horizon; chronological 80/20 split with per-SKU max scaling fitted on the **training region only**; weights proportional to 1/validation-MAE; residual quantiles give the 80 % band. The ensemble's LSTM member is the **federated global LSTM** when CDIN is on. CDIN: pull-based rounds, FedProx local training, FedAvg weighted by samples (share capped 0.6, stale-by-one x0.5), update validation (architecture, finiteness, base version, norm outliers), quorum + deadline; RDI published only for GTINs reported by >= 2 nodes: `RDI = 0.5 + 0.5 tanh(3(meanGrowth - 1))`, used in `CS` and as a +-30 % forecast uplift.
