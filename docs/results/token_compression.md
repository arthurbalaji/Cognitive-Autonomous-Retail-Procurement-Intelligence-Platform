# LLM context compression (measured, real Bedrock calls)

Model `us.anthropic.claude-sonnet-5-5`, 30 calls per variant. Cost uses assumed list prices ($3.0/$15.0 per 1M in/out tokens) - illustrative.

| Variant | avg input tokens | avg output tokens | avg latency ms | est. cost / 1,000 calls |
|---|---|---|---|---|
| compact (CARPIP) | 421 | 147 | 2209 | $3.47 |
| raw RAG context | 20423 | 160 | 2817 | $63.67 |

**Input tokens reduced by 97.9%, latency by 21.6%** (paper reports 75.4 % / 75.4 % on its own benchmark; this is a different, smaller measurement).

**Caveat:** the saving depends entirely on how large the 'raw RAG' baseline is. Here it is a synthetic 90-day x 3-store sales table + 25-table schema + 60 log rows + 80 catalog rows (~20k tokens); a leaner baseline would show a smaller saving. Latency is dominated by the model's fixed response time, so it improves much less than input tokens.
