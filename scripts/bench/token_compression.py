#!/usr/bin/env python3
"""Context compression benchmark (paper §4.4): the compact 8-parameter payload vs a 'standard RAG' prompt that sends raw
history tables, the DB schema and past logs.  Uses REAL Bedrock calls and reads the billed input/output tokens and latency
from the response, so numbers are measurements, not estimates.

  python scripts/bench/token_compression.py [--n 6]     (needs fresh AWS credentials: bash scripts/aws-creds.sh)
Writes docs/results/token_compression.md.  Small sample => indicative only."""
import argparse
import json
import os
import random
import statistics
import time

from anthropic import AnthropicBedrock

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=6)
a = ap.parse_args()

cred = json.load(open(os.getenv("AWS_CREDENTIALS_FILE", ".demo/aws/credentials.json")))
client = AnthropicBedrock(aws_region=os.getenv("AWS_REGION", "us-east-1"), aws_access_key=cred["AccessKeyId"], aws_secret_key=cred["SecretAccessKey"],
                          aws_session_token=cred.get("SessionToken"), timeout=60)
MODEL = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-5-5")
SCHEMA = {"type": "object", "properties": {"action": {"type": "string", "enum": ["OFFER", "COUNTER", "ACCEPT", "REJECT"]}, "price": {"type": "number"}, "message": {"type": "string"}},
          "required": ["action", "price", "message"], "additionalProperties": False}
SYSTEM = "You are a retailer procurement negotiation agent. Reply with JSON {action, price, message}. Propose an opening offer."
rnd = random.Random(7)


def compact():
    return {"sku": "SKU-0001", "name": "Aashirvaad Atta 5kg", "category": "FOOD_BEVERAGE", "basePrice": "293.99", "currentStock": 20, "reorderPoint": 40, "quantity": 72, "mpi": 0.54}


def raw_rag():
    rows = [{"date": f"2026-09-{d % 28 + 1:02d}", "store": s, "sku": "SKU-0001", "units": rnd.randint(0, 30), "revenue": round(rnd.uniform(0, 9000), 2)} for d in range(90) for s in ("S1", "S2", "S3")]
    schema = "\n".join(f"CREATE TABLE t{i}(id uuid, tenant_id uuid, col_a text, col_b numeric, col_c timestamptz, col_d jsonb);" for i in range(25))
    logs = [{"ts": f"2026-10-{d % 20 + 1:02d}T10:00:00Z", "event": "negotiation", "supplier": f"S{d % 3}", "result": "ACCEPTED", "price": round(rnd.uniform(240, 290), 2)} for d in range(60)]
    return {"product": compact(), "sales_history_rows": rows, "database_schema": schema, "past_negotiation_logs": logs, "supplier_catalog": [{"sku": f"X{i}", "price": rnd.random() * 500} for i in range(80)]}


def call(payload):
    t = time.perf_counter()
    r = client.messages.create(model=MODEL, max_tokens=300, system=SYSTEM, messages=[{"role": "user", "content": json.dumps(payload)}],
                               output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}})
    return r.usage.input_tokens, r.usage.output_tokens, (time.perf_counter() - t) * 1000


res = {"compact (CARPIP)": [], "raw RAG context": []}
for _ in range(a.n):
    res["compact (CARPIP)"].append(call(compact()))
    res["raw RAG context"].append(call(raw_rag()))
IN_PRICE, OUT_PRICE = 3.0, 15.0   # USD per 1M tokens - ASSUMPTION for cost illustration only; check current Bedrock pricing
lines = ["# LLM context compression (measured, real Bedrock calls)", "", f"Model `{MODEL}`, {a.n} calls per variant. Cost uses assumed list prices (${IN_PRICE}/${OUT_PRICE} per 1M in/out tokens) - illustrative.", "",
         "| Variant | avg input tokens | avg output tokens | avg latency ms | est. cost / 1,000 calls |", "|---|---|---|---|---|"]
avg = {}
for k, v in res.items():
    i, o, l = (statistics.fmean(x[j] for x in v) for j in range(3))
    avg[k] = (i, o, l)
    lines.append(f"| {k} | {i:.0f} | {o:.0f} | {l:.0f} | ${(i * IN_PRICE + o * OUT_PRICE) / 1000:.2f} |")
ci, _, cl = avg["compact (CARPIP)"]
ri, _, rl = avg["raw RAG context"]
lines += ["", f"**Input tokens reduced by {100 * (1 - ci / ri):.1f}%, latency by {100 * (1 - cl / rl):.1f}%** (paper reports 75.4 % / 75.4 % on its own benchmark; this is a different, smaller measurement).",
          "", "**Caveat:** the saving depends entirely on how large the 'raw RAG' baseline is. Here it is a synthetic 90-day x 3-store sales table + 25-table schema + 60 log rows + 80 catalog rows (~20k tokens); a leaner baseline would show a smaller saving. Latency is dominated by the model's fixed response time, so it improves much less than input tokens."]
text = "\n".join(lines)
print(text)
os.makedirs("docs/results", exist_ok=True)
open("docs/results/token_compression.md", "w").write(text + "\n")
