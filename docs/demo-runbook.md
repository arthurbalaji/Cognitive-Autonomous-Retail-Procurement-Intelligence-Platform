# Demo runbook (about 10 minutes)

**Before the audience arrives** (5 min): `aws login`; terminal 1 `bash scripts/aws-creds.sh --loop`; terminal 2 `bash scripts/up.sh` (or `docker compose up -d` if already built). Open four browser tabs: CARPIP admin `:3000`, CARPIP retailer (private window) `:3000`, POS `:3100`, ERP `:3200`. Check *System health*: all green and "LLM: Claude via Bedrock". Optional dress rehearsal: `python scripts/e2e/smoke.py`.

| Min | Do | Say / point at |
|---|---|---|
| 0:00 | Admin -> **System health** | Eight services, Kafka lag 0, outbox 0, six integration connections healthy, Bedrock reachable. "Software only: no RFID, no smart shelves." |
| 1:00 | Admin -> **Integrations** | Three connector styles: Shopify-compatible (Path A), Zoho-style OAuth (Path A), open REST + signed webhooks + GraphQL (Path B). "Test connection" on each. |
| 2:00 | POS tab (store *Gandhipuram*, PIN 1111): sell 6 units of a *demo SKU* (listed in `.demo/credentials.md`) | Signed webhook leaves the POS. |
| 2:30 | Retailer tab -> Dashboard | Live feed: sale, stock update, "reorder threshold crossed". Inventory page shows the SKU at <= 1.0x cover. |
| 3:00 | Retailer -> **Purchase orders** -> the new PO | Three suppliers negotiated **in parallel**, turn by turn, by Claude agents. Price corridor chart: the model can only move a price 1 % inside hard floor/ceiling. Ranking table, optimal quantity (paper floor vs forecast), "order by" date, AI summary. |
| 5:00 | ERP tab (the chosen supplier) -> Sales orders | The PO arrived by signed REST / Zoho API. FEFO lot allocation. Confirm -> Ship -> Mark delivered (or leave `auto-progress` on). |
| 6:00 | Retailer tab -> the PO timeline; POS -> *Incoming stock* then *Stock* | Order timeline follows the ERP; goods receipt writes stock back into the POS. Closed loop. |
| 7:00 | Admin -> **Demo control panel** -> *Bedrock outage -> Throttling*, then sell another demo SKU | Amber "RULE-ONLY" banner; negotiation still completes, every turn marked RULE, prices still within bounds. Restore. |
| 8:00 | Control panel -> *Webhook replay* (same id / new id / tampered / stale) | 200 duplicate / harmless no-op / 401 / 401 - then **Audit log**. |
| 8:30 | Control panel -> *Kafka outage -> Pause*, sell, *Resume* | Webhook still accepted; backlog grows then drains; stock converges. |
| 9:00 | Admin -> **CDIN & forecasting** | Three nodes, FedAvg rounds, forecast metrics vs naive baselines, regional demand index. Product page: forecast band + what drives the market pulse. |
| 9:30 | Wholesaler login -> **Demand insights** | The same platform serves suppliers via GraphQL. |

**Edge-case extras**: *Supplier stock-out* (offer disappears from CARPIP within seconds; open orders re-route to rank #2), *Partial confirmation* (60 % -> PARTIALLY_CONFIRMED + replan), *Webhooks lost* (polling reconciles, connection flags WEBHOOK_DEGRADED), *Accelerate time x60* (MPI ticks every 15 s), *Federated node offline* then *Run federated round* (2 of 3 quorum).

**If something goes wrong**: Bedrock credentials expired -> amber banner, demo continues in rule mode; run `bash scripts/aws-creds.sh`. Slow laptop -> `SKIP_ML=true` for provisioning. Stuck stack -> `bash scripts/reset.sh && bash scripts/up.sh`.
