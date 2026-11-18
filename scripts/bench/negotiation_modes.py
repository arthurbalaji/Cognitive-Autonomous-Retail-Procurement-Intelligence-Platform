#!/usr/bin/env python3
"""E4 / E10: LLM voice (Claude Sonnet 5.5 on Bedrock) vs deterministic rule voice on identical negotiation requests.

  python scripts/bench/negotiation_modes.py [--n 30] [--seed 11]

Requests are built from LIVE rows (retailer products, active trade relationships, supplier offers) exactly like
carpip-backend ProcurementService.candidates()/buildRequest(); only the stock level is drawn (0..100 % of the reorder point,
seeded) to emulate threshold crossings. Each request is sent to the engine's real POST /api/negotiate, once with
options.mode=rule and once with options.mode=llm. Needs: stack up, fresh AWS credentials (aws-creds.sh --loop), .env.
Writes docs/results/negotiation_modes.{json,md}.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import statistics
import subprocess
import time
import uuid

import httpx

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENGINE = os.getenv("ENGINE_URL", "http://127.0.0.1:5050")
IN_PRICE, OUT_PRICE = 3.0, 15.0     # USD per 1M tokens, the same ASSUMPTION as scripts/bench/token_compression.py


def env(name: str) -> str:
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"{name} missing in .env")


def psql(sql: str):
    out = subprocess.run(["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "carpip", "-At", "-c", sql],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    return json.loads(out) if out else []


H = {"X-Internal-Token": env("INTERNAL_SERVICE_TOKEN")}
http = httpx.Client(timeout=240, headers=H)


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def build_requests(n: int, seed: int) -> list[dict]:
    rows = psql("""
      SELECT json_agg(x) FROM (
        SELECT p.id::text AS pid, p.tenant_id::text AS tid, p.sku, p.name, p.category, p.gtin, p.reorder_point AS rop,
               p.retail_price::text AS retail, p.perishable, p.shelf_life_days,
               (SELECT json_agg(json_build_object(
                    'supplierTenantId', o.wholesaler_tenant_id::text, 'alias', t.name, 'supplierSku', o.supplier_sku,
                    'listPrice', o.list_price::text, 'priceTiers', o.price_tiers, 'availableQty', o.available_qty, 'moq', o.moq,
                    'packSize', o.pack_size, 'leadTimeDays', o.lead_time_days, 'reliability', o.shipping_reliability::text,
                    'nearestExpiry', o.nearest_expiry::text, 'shelfLifeDays', o.shelf_life_days, 'maxDiscountPct', o.max_discount_pct::text) ORDER BY o.list_price)
                FROM supplier_offer o
                JOIN trade_relationship r ON r.wholesaler_tenant_id = o.wholesaler_tenant_id AND r.retailer_tenant_id = p.tenant_id AND r.status='ACTIVE'
                JOIN tenant t ON t.id = o.wholesaler_tenant_id AND t.status='ACTIVE'
                WHERE o.gtin = p.gtin AND o.active) AS cands
        FROM product p WHERE p.active AND p.gtin IS NOT NULL AND p.reorder_point >= 5 ORDER BY p.id) x WHERE x.cands IS NOT NULL""")
    rows = [r for r in rows if r["cands"] and len(r["cands"]) >= 2]
    rnd = random.Random(seed)
    by_t: dict[str, list] = {}
    for r in rows:
        by_t.setdefault(r["tid"], []).append(r)
    reqs, tids = [], sorted(by_t)
    per = math.ceil(n / max(len(tids), 1))
    for tid in tids:
        for r in rnd.sample(by_t[tid], min(per, len(by_t[tid]))):
            stock = int(r["rop"] * rnd.random())
            qty = max((r["rop"] - stock) * 2, 50)
            base = min(float(c["listPrice"]) for c in r["cands"])
            reqs.append({
                "requestId": str(uuid.uuid4()), "tenantId": r["tid"], "productId": r["pid"], "gtin": r["gtin"], "poId": None, "trigger": "BENCH",
                "inventoryPosition": stock, "onOrder": 0,
                "context": {"sku": r["sku"], "name": r["name"], "category": r["category"], "basePrice": f"{base:.2f}", "currentStock": stock,
                            "reorderPoint": r["rop"], "quantity": qty, "mpi": None},
                "retailerPolicy": {"retailPrice": r["retail"], "targetMarginPct": "0.25", "safetyDays": 3, "autonomy": "AUTO"},
                "candidates": r["cands"],
                "options": {"mode": "rule", "deadlineS": 40, "perishable": r["perishable"], "shelfLifeDays": r["shelf_life_days"]}})
    rnd.shuffle(reqs)
    return reqs[:n]


def llm_status() -> dict:
    return http.get(f"{ENGINE}/api/llm/status").json()


def run(req: dict, mode: str) -> dict:
    body = json.loads(json.dumps(req))
    body["options"]["mode"] = mode
    body["requestId"] = str(uuid.uuid4())
    t = time.perf_counter()
    r = http.post(f"{ENGINE}/api/negotiate", json=body)
    wall = (time.perf_counter() - t) * 1000
    r.raise_for_status()
    j = r.json()
    j["_wallMs"] = wall
    return j


def summarise(results: list[dict], mode: str) -> dict:
    negs = [n for r in results for n in r["negotiations"]]
    turns = [t for n in negs for t in n["turns"]]
    acc = [n for n in negs if n["status"] == "ACCEPTED"]
    sel = [r["decision"] for r in results if r["decision"]["outcome"] == "ACCEPTED"]
    prices = [float(x["agreedUnitPrice"]) for d in sel for x in d["rankedSuppliers"] if x["rank"] == 1]
    llm_turns = [t for t in turns if t["source"] == "LLM"]
    fallbacks = [t for t in turns if t["source"] == "RULE" and t.get("guardrail")]
    inconsistent = [t for t in turns if t.get("guardrail") == "INCONSISTENT_MESSAGE"]
    wrong = [t for t in turns if t.get("guardrail") == "WRONG_ACTION"]
    priced = [t for t in llm_turns if t.get("deterministicPrice") and t.get("llmProposedPrice")]
    moved = [t for t in priced if abs(float(t["llmProposedPrice"]) - float(t["deterministicPrice"])) >= 0.005]
    return {
        "mode": mode, "requests": len(results), "negotiations": len(negs), "turns": len(turns),
        "negotiationsAccepted": len(acc), "negotiationAcceptRate": len(acc) / max(len(negs), 1),
        "requestsWithAcceptedSupplier": len(sel), "requestAcceptRate": len(sel) / max(len(results), 1),
        "meanSelectedUnitPrice": statistics.fmean(prices) if prices else None,
        "guardrailInterventions": sum(n.get("guardrailInterventions", 0) for n in negs),
        "clampedTurns": sum(1 for t in turns if t["clamped"]),
        "llmTurns": len(llm_turns), "ruleFallbackTurns": len(fallbacks), "fallbackReasons": sorted({t["guardrail"] for t in fallbacks}),
        "inconsistentMessages": len(inconsistent), "wrongActionTurns": len(wrong),
        "messageConsistencyPassRate": (1 - len(inconsistent) / len(llm_turns)) if llm_turns else None,
        "priceMovedTurns": len(moved), "priceMovedShareOfPricedLlmTurns": len(moved) / len(priced) if priced else None,
        "meanAbsPriceMovePct": statistics.fmean(abs(float(t["llmProposedPrice"]) / float(t["deterministicPrice"]) - 1) * 100 for t in moved) if moved else 0.0,
        "latencyMs": {"p50": pct([r["_wallMs"] for r in results], .5), "p95": pct([r["_wallMs"] for r in results], .95),
                      "mean": statistics.fmean(r["_wallMs"] for r in results), "max": max(r["_wallMs"] for r in results)},
        "bounds": {"outOfBandAcceptedPrices": sum(1 for n in acc if not (float(n["bounds"]["floor"]) - 1e-9 <= float(n["finalPrice"]) <= float(n["bounds"]["retailerMax"]) + 1e-9))},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()
    st0 = llm_status()
    if not st0["available"]:
        raise SystemExit(f"LLM unavailable: {st0['reason']} / {st0['lastError']} - run scripts/aws-creds.sh first")
    reqs = build_requests(a.n, a.seed)
    print(f"{len(reqs)} requests, {sum(len(r['candidates']) for r in reqs)} candidate offers; LLM available={st0['available']}", flush=True)
    rule, llm, pairs, tok = [], [], [], []
    for i, rq in enumerate(reqs, 1):
        r_rule = run(rq, "rule")
        t_before = llm_status()["tokensToday"]
        r_llm = run(rq, "llm")
        t_after = llm_status()["tokensToday"]
        rule.append(r_rule)
        llm.append(r_llm)
        use = [n.get("usage") or {} for n in r_llm["negotiations"]]
        i_tok, o_tok = sum(u.get("inputTokens", 0) for u in use), sum(u.get("outputTokens", 0) for u in use)
        tok.append({"negIn": i_tok, "negOut": o_tok, "calls": sum(u.get("calls", 0) for u in use), "total": t_after - t_before,
                    "extra": (t_after - t_before) - i_tok - o_tok})
        # per-supplier price pairs (same supplier, both ACCEPTED)
        rm = {n["supplierTenantId"]: n for n in r_rule["negotiations"]}
        for n in r_llm["negotiations"]:
            m = rm.get(n["supplierTenantId"])
            if m and m["status"] == "ACCEPTED" and n["status"] == "ACCEPTED":
                pr, pl = float(m["finalPrice"]), float(n["finalPrice"])
                pairs.append({"sku": rq["context"]["sku"], "supplier": n["supplierName"], "rule": pr, "llm": pl, "diff": pl - pr, "diffPct": (pl / pr - 1) * 100,
                              "floor": float(n["bounds"]["floor"]), "rmap": float(n["bounds"]["retailerMax"])})
        print(f"[{i:02d}/{len(reqs)}] {rq['context']['sku']} rule={r_rule['decision']['outcome']} {r_rule['_wallMs']:.0f}ms | llm={r_llm['decision']['outcome']} "
              f"{r_llm['_wallMs']:.0f}ms tokens={t_after - t_before}", flush=True)
    s_rule, s_llm = summarise(rule, "rule"), summarise(llm, "llm")
    d = [p["diff"] for p in pairs]
    dp = [p["diffPct"] for p in pairs]
    n_in, n_out = sum(t["negIn"] for t in tok), sum(t["negOut"] for t in tok)
    extra = sum(t["extra"] for t in tok)
    cost_neg = (n_in * IN_PRICE + n_out * OUT_PRICE) / 1e6
    cost_extra = extra * IN_PRICE / 1e6     # explanation call is not metered by the engine; priced at the input rate (lower bound)
    summary = {
        "n": len(reqs), "seed": a.seed, "model": st0["model"], "effort": st0["effort"], "flexPct": 1.0,
        "rule": s_rule, "llm": s_llm,
        "priceDifference": {"pairs": len(pairs), "meanInr": statistics.fmean(d) if d else None, "meanPct": statistics.fmean(dp) if dp else None,
                            "minPct": min(dp) if dp else None, "maxPct": max(dp) if dp else None, "identicalPairs": sum(1 for x in d if abs(x) < 0.005),
                            "llmLowerPairs": sum(1 for x in d if x < -0.005), "llmHigherPairs": sum(1 for x in d if x > 0.005),
                            "withinFlexBand": sum(1 for x in dp if abs(x) <= 1.0 + 1e-6)},
        "tokens": {"negotiationInputTotal": n_in, "negotiationOutputTotal": n_out, "perPoInput": n_in / len(reqs), "perPoOutput": n_out / len(reqs),
                   "llmCallsPerPo": sum(t["calls"] for t in tok) / len(reqs), "explanationAndOtherTokensPerPo": extra / len(reqs),
                   "assumedUsdPer1MIn": IN_PRICE, "assumedUsdPer1MOut": OUT_PRICE,
                   "estCostPerPoUsd": (cost_neg + cost_extra) / len(reqs), "estCostPer1000PoUsd": (cost_neg + cost_extra) / len(reqs) * 1000},
        "note": "Run while other CPU-heavy jobs were active on the same laptop; absolute latencies are inflated. LLM latency is dominated by Bedrock round trips.",
        "pairsDetail": pairs,
    }
    with open(os.path.join(ROOT, "docs", "results", "negotiation_modes.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    md = render(summary)
    with open(os.path.join(ROOT, "docs", "results", "negotiation_modes.md"), "w", encoding="utf-8") as f:
        f.write(md)
    print(md)


def render(s: dict) -> str:
    r, l, p, t = s["rule"], s["llm"], s["priceDifference"], s["tokens"]
    f = lambda v, d=2: "n/a" if v is None else f"{v:.{d}f}"
    lines = [
        "# E4/E10 - LLM voice vs rule voice on identical requests (live stack, real Bedrock calls)", "",
        f"Model `{s['model']}` (effort `{s['effort']}`), price flex +-{s['flexPct']:.0f} %, {s['n']} requests built from live products/offers "
        f"(stock drawn at 0-100 % of ROP, seed {s['seed']}), each sent to the engine's `/api/negotiate` once per mode.", "",
        "| Metric | Rule voice | LLM voice |", "|---|---|---|",
        f"| negotiations (supplier x request) | {r['negotiations']} | {l['negotiations']} |",
        f"| negotiation acceptance rate | {100 * r['negotiationAcceptRate']:.1f} % | {100 * l['negotiationAcceptRate']:.1f} % |",
        f"| requests with an accepted supplier | {100 * r['requestAcceptRate']:.1f} % | {100 * l['requestAcceptRate']:.1f} % |",
        f"| mean selected unit price (INR) | {f(r['meanSelectedUnitPrice'])} | {f(l['meanSelectedUnitPrice'])} |",
        f"| guardrail interventions | {r['guardrailInterventions']} | {l['guardrailInterventions']} |",
        f"| turns / LLM-worded turns / clamped turns | {r['turns']} / 0 / {r['clampedTurns']} | {l['turns']} / {l['llmTurns']} / {l['clampedTurns']} |",
        f"| fallback-to-rule turns | 0 | {l['ruleFallbackTurns']} {l['fallbackReasons'] or ''} |",
        f"| message/price consistency pass rate (LLM turns) | n/a | {f(100 * l['messageConsistencyPassRate'], 1) if l['messageConsistencyPassRate'] is not None else 'n/a'} % |",
        f"| LLM turns whose price moved off the protocol price | n/a | {l['priceMovedTurns']} ({f(100 * (l['priceMovedShareOfPricedLlmTurns'] or 0), 1)} % of priced LLM turns, mean |move| {f(l['meanAbsPriceMovePct'], 3)} %) |",
        f"| latency per request p50 / p95 (ms) | {f(r['latencyMs']['p50'], 0)} / {f(r['latencyMs']['p95'], 0)} | {f(l['latencyMs']['p50'], 0)} / {f(l['latencyMs']['p95'], 0)} |",
        f"| accepted prices outside [floor, RMAP] | {r['bounds']['outOfBandAcceptedPrices']} | {l['bounds']['outOfBandAcceptedPrices']} |", "",
        f"**Agreed-price difference (LLM minus rule, same supplier, both accepted; {p['pairs']} pairs):** mean {f(p['meanInr'], 3)} INR ({f(p['meanPct'], 3)} %), "
        f"range {f(p['minPct'], 2)} % .. {f(p['maxPct'], 2)} %; identical in {p['identicalPairs']}, LLM lower in {p['llmLowerPairs']}, LLM higher in {p['llmHigherPairs']}; "
        f"{p['withinFlexBand']}/{p['pairs']} within the +-1 % flex band.", "",
        f"**Tokens / cost per PO (LLM mode):** {f(t['perPoInput'], 0)} input + {f(t['perPoOutput'], 0)} output tokens in {f(t['llmCallsPerPo'], 1)} negotiation calls, "
        f"+ {f(t['explanationAndOtherTokensPerPo'], 0)} tokens for the non-authoritative explanation call (not metered per call; priced at the input rate). "
        f"At the assumed list prices (${t['assumedUsdPer1MIn']}/${t['assumedUsdPer1MOut']} per 1M in/out) ~ **${t['estCostPerPoUsd']:.4f} per PO (${t['estCostPer1000PoUsd']:.2f} per 1,000 POs)** - illustrative, check current Bedrock pricing.", "",
        f"_Note: {s['note']}_", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
