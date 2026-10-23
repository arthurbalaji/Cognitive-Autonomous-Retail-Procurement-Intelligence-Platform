# Deviations from the paper (and why)

The prototype follows the paper's architecture and contributions. Where the paper's text was wrong, ambiguous, impossible on a laptop, or contradicted by the user's constraints, this is what was done.

## 1. Corrections to the paper's formulas
| Paper | Problem | Prototype |
|---|---|---|
| `DP = max(ROP,1) / max(ROP - stock, 1)` | **Falls** as stock becomes more critical (stock 0 -> 1.0, stock 39 -> 40): the opposite of its stated meaning; the "bounded between 0.10 and 0.95" claim also does not hold. | `DP = 0.10 + 0.85 * (0.5 r + 0.5 c)` with `r = 1 - stock/(2 ROP)`, `c = 1 - daysCover/(2(L+S))`: monotone non-increasing in stock, always in [0.10, 0.95] (property-tested). |
| Final retailer test `FloorPrice <= 0.90 * BasePrice` | Always true (Floor is at most 0.90 Base), so a negotiation could **never** be REJECTED. | Retailer has a maximum acceptable price **RMAP** from retail price and target margin; T2 offer is capped at RMAP; T3 accepts only if `Floor' <= RMAP`. REJECTED is reachable. |
| MPI "5-factor" (abstract) vs 4 terms (formula) | Inconsistent. | Fifth factor **CS** (regional demand index from CDIN + macro + competitor price drift); weights = paper weights x 0.9 plus 0.10 for CS (sum 1.0). |
| "8-parameter payload" | The paper lists 6. | `sku, name, category, basePrice, currentStock, reorderPoint, quantity, mpi`. |
| `Q = max((ROP - stock)*2, 50)` | Ignores forecast, MOQ, pack size, shelf life, availability. | Kept as the **floor**; `Q = max(Q_paper, Q_forecast)` then shelf-life cap, MOQ, pack rounding, availability - each change carries a reason code. |
| Threshold `currentStock <= reorderPoint` | Re-triggers while an order is already on its way. | Uses the **inventory position** (stock + confirmed on-order); one in-flight AI PO per SKU is enforced by a partial unique index. A product with ROP 0 never auto-reorders. |
| Floor `Base*(0.80 + 0.10*MPI)` | Ignores the supplier's own discount policy. | `max(that, Base*(1 - maxDiscountPct))`; floor rounds up, RMAP rounds down. |
| SA "starts at 0.65", PV "normalized to 0.42" | Undefined beyond the constants. | Computed from supplier coverage/reliability and price dispersion; 0.65 / 0.42 are the **priors** used when data is missing or stale. |

## 2. Technology substitutions
| Paper | Prototype | Reason |
|---|---|---|
| Llama-3-70B and GPT-4o | **Claude Sonnet 5.5 on AWS Bedrock** (`us.anthropic.claude-sonnet-5-5`, `AnthropicBedrock` client) | User constraint: Bedrock only, no local LLM. |
| LangChain, temperature 0.2 | Direct SDK calls, low effort + structured output + deterministic guardrails | Sonnet 5.5 rejects `temperature`; determinism comes from the protocol, not sampling. |
| LLM sets prices within bounds | **Protocol decides actions; LLM only words messages and may move a price +-1 %**, then clamped | Stronger anti-hallucination guarantee than "bounds in the prompt". |
| Spring Data JPA everywhere | JPA for core aggregates, `JdbcTemplate` for the rest | Pragmatism; same database, same transactions. |
| Drizzle / Alembic for POS / ERP | Idempotent SQL schema bootstrap on start | Fewer moving parts for a demo. |
| D3.js | Recharts only | One charting library was enough. |
| SARIMA baseline | Seasonal-naive and 7-day moving-average baselines | Keeps the engine image small; SARIMA is a drop-in for a bench script. |
| Forecast horizon 28 days | 14 days (`FORECAST_HORIZON_DAYS`) | Covers lead time + review period; keeps CPU training fast. |
| Dunnhumby dataset, 43,000 SKUs, 42 nodes, GPU | Deterministic synthetic data in the Dunnhumby shape, 120 SKUs x 3 stores x 120 days, CPU only | Laptop prototype. |
| Shopify / Zoho / SAP production connectors | Faithful **mimics** (Shopify Admin REST 2024-01, Zoho Inventory style) inside the demo POS / ERP; no SAP/Oracle adapter | No external accounts needed. Real-Shopify differences are documented in code comments (PO API and idempotent adjust are extensions). |
| Redis for sessions | Redis for rate limiting and the JWT revocation list only | JWTs are stateless. |
| GraphQL "user-defined schemas" | A fixed read-only schema with depth/complexity limits and role-based field visibility | Safer. |
| Kafka replication etc. | Single-broker KRaft | Laptop. |

## 3. Things the paper does not describe, added so the system is actually robust
Transactional outbox, dead-letter topics with replay, idempotent consumers, optimistic locking, source-versioned stock updates, HMAC verification on raw bytes with a replay window and secret rotation, API-key scopes and rotation, per-tenant isolation (404, never 403), Redis rate limiting, durable writeback queue with retries, circuit breaker + token budget + credential hot-reload for Bedrock, rule-only degraded mode, a degraded list-price order when the engine stays down, message/price consistency guardrail, audit log, live SSE feed, demo scenario panel.

## 4. What is NOT claimed
* The paper's Table I-III results (4.3 % MAPE, 78 % stock-out reduction, 94.5 % negotiation success, 88.8 % cost saving...) are **not reproduced**. Prototype measurements are in `docs/results/` and are labelled synthetic and scaled-down.
* Forecast accuracy on synthetic Poisson demand is bounded by irreducible noise (the ensemble beats seasonal-naive by ~25 % MAE and a 7-day moving average by ~8-10 %, and is roughly tied with its best single member).
* Because the protocol fixes the actions and the LLM may only nudge prices by 1 %, LLM-mode and rule-mode negotiation outcomes are nearly identical **by design**; the LLM contributes natural-language negotiation, explanations and flexibility, not price authority.
* zk-SNARKs, GNN forecasting, reinforcement-learned bargaining and a live retail pilot (the paper's future work) are out of scope.
* Federated learning here is FedAvg/FedProx over three containers on one machine; privacy is architectural (only weights and coarse ratios leave a node), without differential-privacy noise or secure aggregation.
