# CARPIP - Cognitive Autonomous Retail Procurement Intelligence Platform

Working prototype (laptop, Docker) of the platform in `CARPIP Research Paper SNS.docx`, plus a **demo retail POS** and a **demo wholesale ERP** that connect to it. Not production software: see `docs/deviations-from-paper.md` for exactly where it differs from the paper.

Three independent systems, one `docker compose up`:

| System | Stack | Port(s) | Folder |
|---|---|---|---|
| **CARPIP core** | Java 17 / Spring Boot 3.3 (JPA, Flyway, Kafka, Redis, spring-graphql) | 8080 | `carpip-backend/` |
| **CARPIP intelligence engine** | Python 3.11 / Flask / PyTorch(CPU) / XGBoost / Anthropic SDK -> **AWS Bedrock** | 5050 (host) -> 5000 | `carpip-intelligence/` |
| **CARPIP web app** | React 18 + Vite + TS + Tailwind + Zustand + React Query + Recharts (nginx) | 3000 | `carpip-frontend/` |
| **Demo POS** (Shopify Admin API mimic + legacy REST store) | Node 20 / TypeScript / Fastify / pg | 4000 (API), 3100 (UI) | `pos-backend/`, `pos-frontend/` |
| **Demo ERP** (Zoho-style API + custom REST/webhooks) | Python / FastAPI / SQLAlchemy | 8000 (API), 3200 (UI) | `erp-backend/`, `erp-frontend/` |
| Infra | Postgres 15 (3 DBs: carpip, pos, erp), Redis 7, Kafka (KRaft) | 5432, 6379, 9094 | `docker-compose.yml`, `infra/` |
| Provisioning | one-shot `bootstrap` container (idempotent) | - | `scripts/bootstrap/`, `scripts/datagen/` |

The LLM is **AWS Bedrock only** (`us.anthropic.claude-sonnet-5-5` via `anthropic.AnthropicBedrock`). No local LLM anywhere.

## Run it

```bash
# 1. AWS credentials for Bedrock (container hot-reloads the file). aws login creds last ~15 min:
bash scripts/aws-creds.sh --loop        # keep this terminal open during demos (refreshes every 4 min)
# 2. start everything + provision (first build ~15-25 min on a laptop CPU; later starts ~1 min)
bash scripts/up.sh                      # = docker compose up -d --build, then waits for bootstrap
# open http://localhost:3000   (demo accounts are one-click on the login page)
```
`docker compose logs -f bootstrap` shows provisioning. Bootstrap trains models and runs 3 federated rounds (several minutes on CPU). `SKIP_ML=true docker compose run --rm bootstrap` skips ML for a ~20 s provision.
Reset everything: `bash scripts/reset.sh` (= `docker compose down -v`). Credentials/demo SKUs: `.demo/credentials.md`.

## Verify it

```bash
python scripts/e2e/smoke.py [--store store-1|store-2|store-3] [--mode llm|rule|off]   # POS sale -> CARPIP -> negotiation -> ERP -> receipt (needs `pip install httpx`)
cd carpip-intelligence && python -m pytest tests -q       # math + property tests (no DB/Docker needed)
cd carpip-backend && mvn -q -DskipTests compile            # fast compile check
cd carpip-frontend && npx tsc --noEmit                     # same for pos-frontend / erp-frontend / pos-backend
```
After code changes rebuild only what changed: `docker compose up -d --build <service>`.

## Architecture in one page

```
POS (Shopify mimic) --webhook(HMAC)--> CARPIP core --outbox--> Kafka sales.events / inventory.updates
legacy POS ------ REST /api/v1/* (API key, Idempotency-Key, fieldMap) ----^        |
                                                                  consumers (idempotent, versioned stock)
                                         threshold: stock+on_order <= ROP  ->  PO(NEGOTIATING) + procurement.requests
procurement consumer --HTTP--> Flask /api/negotiate: MPI -> per-supplier Q/bounds -> bounded LLM negotiation (parallel) -> ranking
                  <-- decision --  PO APPROVED/PENDING_APPROVAL (autonomy mode) -> writeback queue -> supplier ERP (Zoho poll | signed REST)
ERP confirm/ship/deliver (signed webhooks | polled) -> PO states -> ADJUST_STOCK writeback -> POS stock (+ echo webhook is a no-op)
CDIN nodes (3 containers) --weights only--> Flask coordinator (FedAvg) -> regional demand index -> MPI "CS" factor + forecast uplift
```
Key mechanisms (all in the code, none mocked): transactional outbox (`events/OutboxRelay`), DLQ `<topic>.DLT`, partial unique index `uq_po_inflight` (one in-flight AI PO per SKU), `@Version` optimistic locking + retries, source-version (`updated_at`) stale-event rejection, HMAC over raw bytes with replay window, tenant always from JWT/API key, rate limiting in Redis, AES-GCM-encrypted connector secrets.

### Safety model of the LLM (important when changing negotiation code)
The protocol (`app/negotiation/protocol.py`) decides every turn's **action** deterministically; a Voice (rule templates or Claude) may only word the message and move the price within +-`LLM_PRICE_FLEX_PCT` (1 %), and the result is clamped again to `[floor, ceiling]` / `[.., RMAP]`. Any LLM failure (throttle, timeout, bad JSON, refusal, wrong action, expired AWS token, token budget, open circuit) falls back to the rule voice. Invariants are property-tested (`tests/test_math.py`). Do not give the LLM authority over prices.

## Where things live

- `carpip-backend/src/main/java/com/carpip/`: `auth` (JWT HS256 24 h, API keys `ck_live_<8>_<32>`, Redis rate limit), `events` (outbox, Kafka config, DLT), `inventory` (single stock write path `InventoryApplier`), `procurement` (threshold, PO state machine `PurchaseOrderService`, engine client, result persistence), `erp` (adapters: `ShopifyAdapter`, `ZohoAdapter`, `CustomRestAdapter`; `WebhookService`, `WritebackWorker`, `ErpSyncService`), `api` (Path B REST), `graphql`, `sse`, `demo` (admin console API, scenarios), `catalog` (products, dynamic ROP). Migrations: `src/main/resources/db/migration/V1..V9`.
- `carpip-intelligence/app/`: `mpi/factors.py` (pure formulas), `mpi/engine.py` (bulk DB + scheduler), `negotiation/{bounds,protocol,quantity,agents,pipf}.py`, `llm/bedrock.py` (client, breaker, budget, fault injection), `forecasting/` (data, models, service), `cdin/coordinator.py`, `api/` (blueprints, internal token or node API key). `cdin_node/` = federated node.
- `pos-backend/src/`: `shopify.ts` (Admin API mimic), `inventory.ts` (race-safe stock), `webhooks.ts` (outbox+worker), `legacy.ts`, `admin.ts` (provisioning + demo endpoints). `erp-backend/erp/`: `domain.py` (FEFO, tiers, SO lifecycle), `api_zoho.py`, `api_carpip.py`, `workers.py`.
- Contracts/specs: `docs/architecture.md`, `docs/formulas.md`, `docs/webhook-signing.md`.

## Conventions and gotchas

- Money: `BigDecimal`/`Decimal`, 2 dp, strings across service boundaries. Floor price rounds UP, retailer max (RMAP) rounds DOWN. Business day = IST, storage UTC.
- Tenant isolation: never read a tenant id from a request body; other tenants' resources return 404.
- Shell scripts must stay LF (`.gitattributes`). The repo path has a space: always quote.
- This environment's shell can fail on very large heredocs; write big files with the editor tool.
- Sonnet 5.5 on Bedrock rejects `temperature`/`top_p`/`top_k`, assistant prefill and forced `tool_choice`; structured output via `output_config.format`. The Mantle client returned 404 for this model on the dev account, so the engine uses `AnthropicBedrock` with the inference-profile id `us.anthropic.claude-sonnet-5-5`.
- Spring Data scans nested repository interfaces only with `considerNestedRepositories = true` (set). Avoid `cond ? int : (cond2 ? 180 : null)` ternaries (unboxing NPE) - bit us once.
- Docker healthchecks use `127.0.0.1` (alpine resolves `localhost` to ::1).
- Timestamps from the POS are ms-precision and strictly increasing per stock level: CARPIP treats them as versions.
- The time-scale demo control shortens cadences only (MPI, ERP sync); timestamps and forecasts stay real.
- Synthetic data is deterministic (`SEED`); the paper's 43,000-SKU / 42-node benchmark is out of scope. Never present prototype numbers as reproductions of the paper's tables.

## When you change something

1. Edit the smallest area; keep the invariants above. 2. Run the relevant fast check (pytest / mvn compile / tsc). 3. `docker compose up -d --build <service>`. 4. Run `scripts/e2e/smoke.py` (needs fresh AWS creds for LLM mode, or `--mode rule`). 5. If you touch a contract (webhook signing, Kafka envelope, REST payload), update `docs/` and all three consumers.
