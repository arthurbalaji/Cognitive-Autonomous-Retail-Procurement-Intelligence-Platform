# CARPIP - Autonomous Retail Procurement Intelligence (laptop prototype)

A working, end-to-end prototype of the platform from the research paper *"A Cognitive Autonomous Retail Procurement Intelligence Platform Using AI-Driven Demand Forecasting, Intelligent Negotiation, and Event-Driven Microservices"*, together with two **separate demo products** that connect to it:

* **CARPIP** - predicts demand, scores market pressure (Market Pulse Index), negotiates with suppliers using bounded LLM agents (AWS Bedrock / Claude), places purchase orders and learns regionally through federated learning (CDIN).
* **Demo Retail POS** - three stores. Two speak a *Shopify Admin API-compatible* dialect (Path A), one is a *legacy system* that only pushes to CARPIP's open REST API (Path B).
* **Demo Wholesale ERP** - three wholesalers with FEFO lots, volume price tiers and an order lifecycle. One speaks a *Zoho-Inventory-style* API (polled by CARPIP), two use *custom REST + signed webhooks + GraphQL*.

Everything runs with one command in Docker on a laptop (~3 GB RAM at rest). The only external dependency is **AWS Bedrock** - there is no local LLM. If Bedrock is unreachable the system keeps working in a deterministic "rule-only" mode.

> This is a prototype built from the paper's description, with the paper's formula errors corrected (see `docs/deviations-from-paper.md`). Data is synthetic; the paper's benchmark numbers are **not** reproduced.

## Quick start (Windows + Docker Desktop)

Prerequisites: Docker Desktop (>= 8 GB given to WSL2, see `infra/docker/wslconfig.example`), Git Bash, AWS CLI v2 logged in to an account with access to **Claude Sonnet 5.5 on Amazon Bedrock** (us-east-1 by default).

```bash
aws login                               # or `aws sso login`
bash scripts/aws-creds.sh --loop        # terminal 1: exports short-lived credentials for the engine every 4 min
bash scripts/up.sh                      # terminal 2: builds, starts and provisions everything (first run 15-25 min)
```
Then open **http://localhost:3000** and pick a demo account on the login page.

| URL | What |
|---|---|
| http://localhost:3000 | CARPIP web app (admin / retailers / wholesalers - one-click demo logins) |
| http://localhost:3100 | Demo POS terminal (PINs 1111 / 2222 / 3333) |
| http://localhost:3200 | Demo ERP (one-click demo companies) |
| http://localhost:8080/graphiql | GraphQL explorer (paste a JWT or API key as bearer) |
| http://localhost:8081 | Kafka UI - `docker compose --profile tools up -d kafka-ui` (optional) |

`.demo/credentials.md` lists all logins and the "demo SKUs" that sit just above their reorder point (one small sale triggers procurement).

## Try it in 2 minutes
1. POS (http://localhost:3100, store *Gandhipuram*, PIN 1111): sell a few units of a demo SKU.
2. CARPIP (log in as *Retailer - Gandhipuram*): the live feed shows the sale, the stock update, the reorder trigger and three suppliers negotiating turn by turn.
3. Open the purchase order: negotiation transcripts, price corridor chart, supplier ranking, optimal quantity and order-by date.
4. ERP (http://localhost:3200, *Sri Murugan* or *Kovai*): the order arrived - confirm, ship, deliver. CARPIP's order timeline follows and the goods land back in the POS stock.
5. Admin (*Platform admin*) -> **Demo control panel**: fire a Bedrock outage, Kafka outage, replay attack, supplier stock-out, ...

A full 10-minute presentation script is in `docs/demo-runbook.md`.

## Verification
```bash
python scripts/e2e/smoke.py --store store-1        # end-to-end loop incl. real Bedrock negotiation (pip install httpx)
python scripts/e2e/scenarios.py                    # resilience scenarios with assertions
cd carpip-intelligence && python -m pytest tests   # math + property tests (adversarial LLM output can never break price bounds)
python scripts/bench/crud_latency.py               # API latency (writes docs/results/)
python scripts/bench/token_compression.py          # measured LLM context compression (real Bedrock usage)
```

## Documentation
* `CLAUDE.md` - how to work on this repo with Claude Code (architecture map, commands, gotchas)
* `docs/architecture.md` - topology, flows, state machine, Kafka topics, edge-case catalogue
* `docs/formulas.md` - MPI, bounds, negotiation protocol, quantity/timeline/ranking (with the corrections)
* `docs/webhook-signing.md` - both signature schemes
* `docs/deviations-from-paper.md` - everything that differs from the paper, and why
* `docs/demo-runbook.md`, `docs/troubleshooting-windows.md`, `docs/results/`

## Stopping and resetting
`docker compose down` keeps data; `bash scripts/reset.sh` wipes everything.
