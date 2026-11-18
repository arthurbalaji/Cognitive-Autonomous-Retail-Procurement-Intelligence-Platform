# E4/E10 - LLM voice vs rule voice on identical requests (live stack, real Bedrock calls)

Model `us.anthropic.claude-sonnet-5-5` (effort `low`), price flex +-1 %, 30 requests built from live products/offers (stock drawn at 0-100 % of ROP, seed 11), each sent to the engine's `/api/negotiate` once per mode.

| Metric | Rule voice | LLM voice |
|---|---|---|
| negotiations (supplier x request) | 79 | 79 |
| negotiation acceptance rate | 100.0 % | 100.0 % |
| requests with an accepted supplier | 100.0 % | 100.0 % |
| mean selected unit price (INR) | 203.77 | 203.77 |
| guardrail interventions | 0 | 0 |
| turns / LLM-worded turns / clamped turns | 310 / 0 / 0 | 310 / 310 / 0 |
| fallback-to-rule turns | 0 | 0  |
| message/price consistency pass rate (LLM turns) | n/a | 100.0 % |
| LLM turns whose price moved off the protocol price | n/a | 0 (0.0 % of priced LLM turns, mean |move| 0.000 %) |
| latency per request p50 / p95 (ms) | 212 / 361 | 9436 / 11908 |
| accepted prices outside [floor, RMAP] | 0 | 0 |

**Agreed-price difference (LLM minus rule, same supplier, both accepted; 79 pairs):** mean 0.000 INR (0.000 %), range 0.00 % .. 0.00 %; identical in 79, LLM lower in 0, LLM higher in 0; 79/79 within the +-1 % flex band.

**Tokens / cost per PO (LLM mode):** 8554 input + 840 output tokens in 10.3 negotiation calls, + 653 tokens for the non-authoritative explanation call (not metered per call; priced at the input rate). At the assumed list prices ($3.0/$15.0 per 1M in/out) ~ **$0.0402 per PO ($40.21 per 1,000 POs)** - illustrative, check current Bedrock pricing.

_Note: Run while other CPU-heavy jobs were active on the same laptop; absolute latencies are inflated. LLM latency is dominated by Bedrock round trips._
