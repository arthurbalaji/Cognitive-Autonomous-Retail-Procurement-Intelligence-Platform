# CARPIP + Demo POS + Demo ERP: Prototype Build Plan

## Context

The research paper (`CARPIP Research Paper SNS.docx`) describes the **Cognitive Autonomous Retail Procurement Intelligence Platform**:
- A React SPA, a Spring Boot core, a Flask intelligence engine, Postgres, Redis and Kafka.
- A dual-path POS/ERP integration layer (Path A: Shopify, Zoho and SAP adapters. Path B: custom REST, signed webhooks and GraphQL).
- The 5-factor Market Pulse Index (MPI), a bounded 3-turn multi-agent LLM negotiation, CDIN federated learning (FedAvg over LSTM weights), and the Adaptive Procurement Intelligence algorithm (quantity Q, timeline T, ranked suppliers).

The text and figures have already been extracted to `D:\CARPIP final\plan\reference\` (`paper.txt`, `figure1-4.png`).

**Goal:** build three independent systems that run together on the user's laptop via `docker compose up`. They are a laptop prototype, not production. Together they show end-to-end connectivity:

1. **CARPIP**, built as the paper describes.
2. **Demo Retail POS** (Node/TS). It mimics the Shopify Admin API so that CARPIP's Shopify adapter is exercised for real. It has 3 stores.
3. **Demo Wholesale ERP** (Python FastAPI). It has 3 wholesalers and uses the Zoho-style and custom REST, webhook and GraphQL paths.

**Fixed decisions (from the user):**

| Area | Decision |
|---|---|
| Hardware | 16 GB RAM, i5 13th-gen U-series, **no GPU**. Target about 6–7 GB of containers, CPU-only PyTorch, scaled-down synthetic data |
| LLM | **AWS Bedrock only, no local LLM.** Default `anthropic.claude-sonnet-5-5` (configurable). Calls go through the official Anthropic Python SDK `AnthropicBedrockMantle(aws_region=...)` |
| Formulas | **Corrected only** (no paper-faithful toggle). Every change is documented in `docs/deviations-from-paper.md` |
| POS / ERP stacks | Heterogeneous: POS is Node 20 + TypeScript + Fastify + Drizzle; ERP is FastAPI + SQLAlchemy + Alembic. Each has its own React UI and its own DB |
| Build method | Claude Code **sub-agent fan-out** in git worktrees after a sequential contracts phase (§8) |

---

## 1. Key design decisions and deviations

| # | Decision | Why |
|---|---|---|
| D1 | One `postgres:15-alpine` holds 3 DBs (`carpip`, `pos`, `erp`) with separate roles. `REVOKE CONNECT FROM PUBLIC` | Saves about 400 MB while keeping isolation real |
| D2 | The demo clock scales **only durations** (MPI cadence, sync interval, ERP auto-progress). Timestamps stay real UTC | No clock drift between 3 systems. The offline simulator handles time travel |
| D3 | The POS is the system of record for retail stock. CARPIP mirrors it as **absolute qty + source version** (`updated_at`). `orders/create` feeds only the sales ledger | No double decrement. Out-of-order and echo events become harmless |
| D4 | Java publishes to Kafka only through a **transactional outbox** | Webhooks still return 200 when Kafka is down. The backlog drains later |
| D5 | Flyway in `carpip-backend` owns all DDL, including schema `intel`. Flask uses role `carpip_intel` | One migration source |
| D6 | **The LLM never decides the price.** The Figure-4 protocol is deterministic. The LLM writes the agent message and may pick a price within ±1% (`LLM_PRICE_FLEX_PCT`), clamped to hard bounds; the action is always the rule's. Modes `NEGOTIATION_MODE=llm\|rule\|off` | Hallucination safety. `rule` is the Bedrock-outage fallback; `off` is ablation 3 (static PO at list price) |
| D7 | LangChain is replaced by direct Anthropic SDK calls on Bedrock. Temperature 0.2 is replaced by `output_config.effort="low"` plus guardrails, because Sonnet 5.5 rejects sampling parameters | Bedrock-only constraint and current API |
| D8 | One shared ML image for `carpip-intelligence` and the `cdin-node-*` services | Saves about 1.2 GB of disk and a torch build |
| D9 | CDIN nodes poll the coordinator (pull-based). Quorum is 2 of 3 with a deadline | No inbound networking. Easy straggler handling |
| D10 | Store-1/2 use Shopify mode (Path A). Store-3 is legacy (Path B, non-canonical payload plus fieldMap). Wholesaler A uses the Zoho mimic (polling + OAuth refresh). Wholesalers B/C use Path B (push `/api/erp/sync`, signed webhooks, GraphQL) | Every arrow in Figure 2 carries real traffic |

---

## 2. Corrected formulas (`contracts/specs/formulas.md` plus ≥30 golden fixtures)

**Conventions:**
- Python `Decimal` and Java `BigDecimal`. Money is a decimal string on the wire, 2dp HALF_UP.
- Exceptions: **Floor rounds CEILING**, **RMAP (retailer max acceptable price) rounds FLOOR**.
- Business days are counted in IST. Storage is UTC.

### MPI (5 factors)
The abstract says 5 factors but the formula has 4, so a 5th factor (CS) is added. Paper weights ×0.9, plus CS:

`MPI = 0.315·DP + 0.225·(1−SA) + 0.18·PV + 0.18·SI + 0.10·CS`, clamped to [0, 1].

- **DP** (corrected so it rises as stock falls; the paper's version was inverted):
  - `r = clamp(1 − stock/(2·max(ROP,1)), 0, 1)`
  - `c = clamp(1 − daysCover/(2·(L_min+S)), 0, 1)`, with `c = 0` when there is no demand
  - `DP = 0.10 + 0.85·(0.5r + 0.5c)`, which lies in [0.10, 0.95]
  - Cold start: `0.10 + 0.85r`
  - Example (ROP 40, v̂ 8/day, L 3, S 3): stock 20 gives DP ≈ 0.755.
- **SA:** reliability-weighted supplier coverage of Q̂. The paper's **0.65 is the prior**, blended in by catalog freshness (24h–72h decay).
- **PV:** coefficient of variation of supplier list prices (across suppliers and over a 30-day history) divided by 0.20, clamped. The paper's **0.42 is the prior** when there are fewer than 2 observations.
- **SI:** `SI_cat × seasonal multiplier`, where SI_cat is the paper value (Electronics .78, F&B .45, Office .62, Lifestyle .82) and the multiplier is clamped to [0.5, 1.5].
- **CS** (competitor and macro signal): `0.5·RDI(CDIN) + 0.3·MACRO + 0.2·COMP`. Neutral is 0.5.
- **Supplier-specific MPI_j:** uses `SA_j` for that supplier's floor.
- **Quality flag:** FULL, PARTIAL or PRIOR_ONLY. A NaN in any factor means that factor's prior is used.
- **Trend:** RISING, FALLING or STABLE from an EMA delta (±0.03).

### Negotiation bounds (supplier j)
- `Floor_j = max(Base_j·(0.80+0.10·MPI_j), Base_j·(1−maxDiscountPct_j))`
- `Ceiling = Base_j` (tier price at Q_j)
- `Target = 0.82·Base_j`
- **RMAP:** `min(Base_j, retailPrice·(1−targetMargin)·(1+0.05·urgency))`. When there is no retail price, `0.90·Base`.

### Protocol (Figure 4, with the accept test corrected)

The paper's original test (`Floor ≤ 0.90·Base`) is always true, so a negotiation could never be REJECTED. The corrected test compares against RMAP.

```
T1 Retailer  bid = min(Target, RMAP)         → Wholesaler: bid ≥ Floor ? ACCEPT : COUNTER (Base+Floor)/2
T2 Retailer  mid = min((bid+counter)/2, RMAP) → Wholesaler: mid ≥ Floor ? ACCEPT : FINAL_OFFER Floor
T3 Retailer  Floor ≤ RMAP ? ACCEPT : REJECTED
```

**Invariants (property-tested):**
- every wholesaler price is in [Floor, Ceiling];
- an accepted price is in [Floor, RMAP];
- there are at most 3 turns.

**Worked examples:**
- Base 100, MPI .7, retail 125, margin .3: Floor 87, RMAP 89.25. Accepted at T2 for 87.75.
- MPI .9, retail 115, margin .25: Floor 89, RMAP 86.25. REJECTED.

### Quantity Q
- `Q_paper = max((ROP−stock)·2, 50)` is the floor.
- `Q_fc = ceil(D̂·(L_j+R) + SS − stock − onOrder)`, where `SS = 1.65·σ̂·√L`.
- `Q = max(Q_paper, Q_fc)`.
- Per supplier: round up to MOQ and pack size, and cap to available stock (`PARTIAL_AVAILABILITY`).
- Shelf-life cap for perishables (`Q_CAPPED_BY_SHELF_LIFE`). Backorders are added.
- Every adjustment is recorded with a reason code.

### Timeline T
- `orderBy_j = depletionDate − L_eff_j − 1 day`, where `L_eff = L·(1+0.5·(1−reliability))`.
- Urgency is ORDER_NOW, SOON or PLANNED.

### Supplier ranking
- Hard filters: ACCEPTED, trade relationship exists, ≥ MOQ, expiry risk < 1.
- `score = 0.40·price + 0.25·reliability + 0.15·(1−expiryRisk) + 0.20·lead`.
  - When urgency is ORDER_NOW, the lead weight is doubled.
  - Suppliers that would deliver after depletion get −0.2.
- Deterministic tie-break.

### Reorder point (ROP)
- Dynamic nightly: `ceil(v̂·L_min + SS)`, unless the ROP has been set manually.
- **Never auto-reorder when ROP = 0 and there is no demand.**

### The 8-parameter compressed payload
The paper says 8 parameters but lists 6. The 8 are: `sku, name, category, basePrice, currentStock, reorderPoint, quantity, mpi`.

---

## 3. Repository layout (monorepo at `D:\CARPIP final`)

```
contracts/      openapi/*.yaml, graphql/carpip.graphqls, events/*.schema.json, webhooks/{signing.md,test-vectors.json},
                specs/{formulas,negotiation-protocol,po-state-machine,idempotency,time-and-money}.md, fixtures/, change-requests/
carpip-backend/         Java 17, Spring Boot 3.3 (packages com.carpip.{auth,tenant,catalog,inventory,sales,supplier,procurement,
                        negotiation,erp,api,graphql,events,ratelimit,audit,demo,common,config}); Flyway V1..V9
carpip-intelligence/    Flask + gunicorn: app/{api,mpi,negotiation,procurement,llm,forecasting,cdin,demo,db,kafka}, bench/, tests/
cdin-node/              federated node (runs from the ML image)
libs/python/carpip_ml/  shared LSTM definition, weight serialization, windowing, scalers
carpip-frontend/        React 18 + Vite + TS + Tailwind + Zustand + React Query + Recharts (+ D3)
pos-backend/  pos-frontend/  erp-backend/  erp-frontend/
infra/docker/           postgres/init/01-init.sh, kafka/create-topics.sh, nginx/*.conf, wslconfig.example
scripts/                preflight.sh, datagen/, bootstrap/, e2e/{smoke.py,scenarios/}, bench/, check_bedrock.py, reset.sh
e2e/playwright/         demo.spec.ts
docs/                   adr/, deviations-from-paper.md, demo-runbook.md, troubleshooting-windows.md, results/
.gitattributes (eol=lf for *.sh / mvnw)   .env.example   docker-compose.yml   CLAUDE.md
```

---

## 4. Runtime topology (`docker-compose.yml`, `name: carpip`)

All ports bind to `127.0.0.1`.

| Service | Image / runtime | Port | Mem limit | Notes |
|---|---|---|---|---|
| postgres | postgres:15-alpine | 5432 | 512m | `01-init.sh` creates the 3 DBs and 4 roles; `shared_buffers=128MB` |
| redis | redis:7-alpine | 6379 | 96m | `maxmemory 64mb` |
| kafka | apache/kafka:3.8 KRaft, single broker, heap 384m | 9092 internal / 9094 host | 768m | auto-create **off** |
| kafka-init | apache/kafka | none | 256m | creates topics, then exits |
| carpip-backend | temurin-17-jre, `-Xmx384m -XX:+UseSerialGC` | 8080 | 768m | waits for readiness (migrations applied) |
| carpip-intelligence | python:3.11-slim, CPU torch, gunicorn 1 worker × 8 threads | 5000 (overridable) | 1536m | `TORCH_NUM_THREADS=2` |
| cdin-node-1..3 | ML image, `python -m cdin_node` | none | 448m each | profile `cdin` (on by default) |
| carpip-frontend / pos-frontend / erp-frontend | nginx static | 3000 / 3100 / 3200 | 48m each | resolver `127.0.0.11` + variable `proxy_pass`; SSE `proxy_buffering off` |
| pos-backend | node:20-alpine | 4000 | 256m | network aliases `store-1.myshopify.local`, `store-2.myshopify.local`, `store-3.legacy.local` |
| erp-backend | python:3.11-slim, uvicorn | 8000 | 320m | |
| bootstrap | python + httpx | none | 384m | idempotent onboarding job |
| kafka-ui, adminer | n/a | 8081, 8082 | n/a | profile `tools` |
| bench | ML image | none | n/a | profile `bench` |

**Networks:**
- `core`: Kafka, Redis, intelligence, nodes, backend.
- `db`: Postgres plus the backends.
- `edge`: CARPIP backend, POS, ERP, frontends, bootstrap.

**POS and ERP can reach only `carpip-backend:8080`**, as real external systems would.

**Memory:** limits sum to about 5.75 GB; expected RSS is about 4–4.5 GB. Ship `wslconfig.example` (`memory=10GB processors=6 swap=4GB`). Build with `COMPOSE_PARALLEL_LIMIT=2`.

### Kafka topics

| Topic | Partitions | Key | Purpose |
|---|---|---|---|
| `sales.events` | 3 | tenantId:productId | paper topic |
| `inventory.updates` | 3 | tenantId:productId | paper topic |
| `procurement.requests` | 3 | tenantId:productId | decouples slow negotiation from stock processing |
| `po.lifecycle` | 3 | poId | drives writebacks and the UI |
| `negotiation.events` | 1 | negotiationId | live transcript |
| `mpi.updates` | 3 | tenantId:productId | live MPI |
| `*.DLT` | 1 | n/a | dead-letter topic for each core topic |

**Event envelope:** `eventId, eventType, schemaVersion, tenantId, occurredAt, source{system, connectionId, externalId}, correlationId, causationId, payload`.

### Redis keys
`rl:*` (rate limit), `lock:reorder:{t}:{p}`, `lock:sync:*`, `lock:mpi:run`, `lock:train:*`, `jwt:deny:{jti}`, `mpi:*`, `vel:*`, `webhook:seen:*`, `llm:breaker`, `llm:tokens:{day}`, `demo:time_scale`.

### `.env.example` highlights
- AWS: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, or a mounted `~/.aws` (read-write for SSO).
- LLM: `BEDROCK_MODEL_ID=anthropic.claude-sonnet-5-5`, `LLM_EFFORT=low`, `LLM_TIMEOUT_S=10`, `LLM_MAX_CONCURRENCY=3`, `LLM_DAILY_TOKEN_BUDGET`.
- Feature flags: `NEGOTIATION_MODE`, `FEATURE_MPI`, `FEATURE_CDIN`, `FEATURE_DYNAMIC_ROP`.
- Timing: `MPI_INTERVAL_S=900`, `DEMO_TIME_SCALE`, `ERP_SYNC_INTERVAL_MS`, `WEBHOOK_TOLERANCE_S=300`.
- CDIN: `CDIN_MIN_QUORUM=2`.
- Data: `SEED=42`, `SKU_COUNT=200`, `HISTORY_DAYS=150`, `DATASET=synthetic|dunnhumby`.
- Secrets: `JWT_SECRET`, `CARPIP_ENC_KEY` (AES-GCM for connector secrets), `INTERNAL_SERVICE_TOKEN`, per-DB passwords.

### Bootstrap job (idempotent, re-runnable with `--reset`)
1. Generate the synthetic dataset. It is deterministic and uses the Dunnhumby schema:
   - non-IID stores, weekly seasonality, festival spikes, intermittent SKUs;
   - a regional precursor (stores 1–2 rise 14 days before store 3), so CDIN has signal to detect.
2. Seed the ERP: 3 companies with items, FEFO lots with expiry, price tiers, policies, delivery history, and an OAuth client for A.
3. Seed the POS: 3 shops with the same GTINs, stock, cashiers, `shpat_` tokens and webhook secrets.
4. Seed CARPIP: admin user, 3 retailer + 3 wholesaler tenants, users, API keys, CDIN node keys.
5. Create the connections:
   - Shopify for R1/R2: test, sync, then register webhooks at the POS;
   - Custom REST for R3, with a fieldMap;
   - Zoho for W-A;
   - REST for W-B/W-C: the ERP pushes a FULL sync.
6. Create trade relationships for every pair **except R3–W-C**, which is deliberate so a "no supplier" case exists.
7. Import sales history, train the forecasts, and open CDIN round 0.
8. Write `./.demo/credentials.md`.

---

## 5. Contracts (written first by the lead; only the lead edits them)

### Authentication

| Caller to callee | Scheme |
|---|---|
| SPA to CARPIP | JWT HS256 (auth0 `Algorithm.HMAC256`), 24h. Claims `sub, tid, role (ADMIN\|RETAILER\|WHOLESALER), jti`. 30s leeway. **Tenant always comes from the JWT or API key, never from the body** |
| External systems to `/api/v1/**`, `/api/erp/sync`, `/graphql` | `Bearer ck_live_<prefix>_<secret>`, stored as a SHA-256 hash, with scopes. Rotation: the old key stays ROTATING for 24h |
| Java to Flask | `X-Internal-Token` + `X-Correlation-Id` |
| CDIN node to Flask | node API key (scope `cdin:node`) |
| CARPIP to POS | `X-Shopify-Access-Token` |
| CARPIP to Zoho mimic | `Zoho-oauthtoken` (1h expiry, refresh) |
| CARPIP to ERP / legacy POS | CARPIP signature + `Idempotency-Key: <poNumber>:<kind>` |

### Webhook signatures
Shared `test-vectors.json` is used by the unit tests in all three languages.
- **Shopify scheme:** `X-Shopify-Hmac-Sha256 = base64(HMAC(secret, rawBody))`, plus `Webhook-Id` and `Triggered-At`. Replay defence: dedupe on webhook id, a 300 s window, and content-level idempotency.
- **CARPIP scheme:** `X-Carpip-Signature: v1=hex(HMAC(secret, ts.eventId.rawBody))`. ±300 s, dual secrets during rotation, constant-time comparison on **raw bytes**, 1 MB body cap.

### CARPIP core REST (`carpip-core.yaml`)
- **Auth and tenancy:** `/api/auth/{login,logout,me}`, `/api/admin/tenants`, `/api/tenants/me/{api-keys,settings}`.
- **Integrations:** `/api/integrations/connections[/{id}/test|sync|rotate-webhook-secret|events]`.
- **Catalog:** `/api/products[/{id}/forecast|mpi|movements]`, `/api/suppliers/...`.
- **Procurement:** `/api/procurement/{plan,runs}`, `/api/purchase-orders[/{id}/approve|reject|cancel|receive]`, `/api/negotiations/{id}`.
- **Path B (paper):**
  - `POST /api/v1/inventory` (ABSOLUTE or DELTA, `Idempotency-Key`, returns 202 with per-row rejects);
  - `POST /api/v1/orders`;
  - `POST /api/erp/sync` (wholesaler catalog, tiers, availability, lead time, reliability, expiry);
  - `POST /api/erp/webhook/{tenantId}`.
- **GraphQL** `/graphql` (read-only):
  - queries: `stockStatus`, `product`, `reorderLimits`, `negotiations`, `purchaseOrders`, `mpiHistory`, and `reorderSignals` (for wholesalers);
  - limits: depth 6, complexity 500, `@BatchMapping`, tenant-scoped resolvers;
  - field visibility: the floor is hidden from retailers and RMAP is hidden from wholesalers.
- **Ops:** SSE `/api/v1/stream/events`, `/api/admin/system/health`, `/api/admin/dlq[/{id}/replay]`, `/api/admin/demo/{time-scale,scenarios/{name}}`, `/api/admin/import/sales-history`.
- **Errors:** RFC 7807. Cross-tenant access returns **404**.

### Intelligence API (`carpip-intelligence.yaml`)
- **Procurement:** `POST /api/negotiate`, the full PIPF for one SKU. Request: 8-param `context`, `retailerPolicy`, `candidates[]` (supplier offer, tiers, MOQ, pack, lead, reliability, expiry, maxDiscount), `options.mode`. Response: `decision{outcome, quantity+breakdown, timeline, rankedSuppliers+scoreBreakdown}`, plus `negotiations[{bounds, turns[{price, deterministicPrice, llmProposedPrice, clamped, source}], usage}]`.
- **MPI and forecasting:** `/api/procure/plan`, `/api/mpi/recompute`, `/api/forecast/{train,status,infer}`.
- **CDIN:** `/api/cdin/{rounds/current, models/{v}, rounds/{id}/updates, rounds, status}`.
- **LLM and demo:** `/api/llm/{status,check}`, `/api/demo/{llm-fault,time-scale}`.

### POS: Shopify mimic (`/admin/api/2024-01/...`)
- Endpoints: `shop.json`; `products.json` (cursor `Link` pagination, `limit≤250`); `locations`; `inventory_levels[.json|/adjust|/set]`; `orders.json?updated_at_min`; `webhooks.json`.
- Rate-limit mimic: `X-Shopify-Shop-Api-Call-Limit` leaky bucket, 429 with `Retry-After`.
- **Documented non-Shopify extensions:** `purchase_orders.json` (incoming stock) and `X-Carpip-Idempotency-Key` on adjust.
- Legacy store: pushes `{item_code, qty_on_hand, ts}` to `/api/v1/*` and receives `/legacy/carpip/callback`.

### ERP
- **Native UI API:** sales orders with confirm (partial), ship, deliver, reject, cancel; items, lots, price-lists, policies; demand-insights (GraphQL proxy).
- **CARPIP inbound:** `POST /api/v1/carpip/purchase-orders[/{po}/cancel]`, signed and idempotent.
- **Zoho mimic:** `/oauth/v2/token`, `/inventory/v1/{items,pricebooks,salesorders}` with the Zoho envelope; `reference_number = poNumber`, unique.
- **Outbound webhooks to CARPIP:** `sales_order.confirmed|rejected|cancelled`, `shipment.created`, `sales_order.delivered`, `stock.changed`, `price_list.updated`.

### Bedrock call contract (`app/llm/bedrock_client.py`)

Request:
```python
client = AnthropicBedrockMantle(aws_region=AWS_REGION)  # lazy; failure means RULE mode
client.messages.create(model=BEDROCK_MODEL_ID, max_tokens=2048, system=PERSONA_AND_RULES,
    messages=[{"role": "user", "content": json_context}],
    output_config={"effort": "low", "format": {"type": "json_schema", "schema": TURN_SCHEMA}})
# TURN_SCHEMA = {action: OFFER|COUNTER|ACCEPT|REJECT, price: number, message: string}, additionalProperties false
```

**Never send** `temperature`, `top_p` or `top_k`, an assistant prefill, or a forced `tool_choice`; Sonnet 5.5 rejects all of them with a 400, and a unit test asserts this.

Response handling:
- Check `stop_reason` first.
- Parse the text block with `json.loads`, validate with pydantic, then clamp.

Errors, most specific first:

| Error | Action |
|---|---|
| `RateLimitError` | breaker count, rule turn |
| `APITimeoutError`, `APIConnectionError` | rule turn |
| `AuthenticationError`, `PermissionDeniedError` | RULE-only mode + diagnosis |
| `NotFoundError` | RULE-only mode: wrong model or region |
| `BadRequestError` | alert (bug) |

Resilience:
- Circuit breaker: 3 failures in 60 s opens it for 60 s. State is shared in Redis.
- Concurrency semaphore of 3; daily token budget.
- A per-negotiation deadline of 25 s. After it, the remaining turns are rule turns.

Prompt-injection hygiene:
- Names are sanitized and cut to 80 characters, and passed only inside JSON data fields marked untrusted.
- Output messages are cut to 280 characters and rendered as text.

---

## 6. Database schemas

### CARPIP (Flyway `V1`–`V9`)

- **V1 tenancy and auth:** `core.tenant`, `app_user`, `api_key`.
- **V2 catalog and inventory:** `core.product` (`current_stock`, `reorder_point`, `rop_source`, `base_price`, `retail_price`, shelf life, `stock_source_version`, `reorder_blocked_until`, `@Version`; unique (tenant, sku) and (tenant, gtin)), `stock_movement`, `sales_event` (unique tenant+source+order+line), `sales_daily` (IST day).
- **V3 suppliers:** `supplier_offer`, `supplier_price_history`, `trade_relationship`, `competitor_price`, `market_signal`.
- **V4 procurement and negotiation:** `purchase_order` (paper's Order: origin, status, negotiation_status, qty, agreed/base price, discount_savings, totals, order_by and expected_delivery dates, `decision jsonb`, `quote_expires_at`, version), `purchase_order_line`, `po_status_history`, `procurement_run`, `negotiation`, `negotiation_log` (paper's NegotiationLog: per-turn actor, action, price, deterministic vs LLM price, clamped, source, message).
- **V5 integration and reliability:** `integration_connection` (encrypted credentials, current and previous webhook secrets, fieldMap, cursor, health), `inbound_event` (unique tenant+source+external id), `processed_event` (consumer idempotency), `outbox_event`, `writeback_task` (unique idempotency key, retry and DEAD state), `shedlock`.
- **V6 intel schema:** `intel.mpi_snapshot`, `forecast`, `model_registry`, `cdin_node`, `cdin_round`, `cdin_update` (unique round+node), `regional_demand_index`.
- **V7 audit and settings:** `core.audit_log` (append-only: UPDATE and DELETE revoked), `system_setting`.
- **V8 views:** `v_inventory_position` (stock + open on-order), `v_mpi_latest`, `v_sales_velocity`, `v_negotiation_context` (the 8-param builder), `v_cdin_training_data`.
- **V9 grants:** for `carpip_intel`.

**Dedupe guard against reorder storms:**
```sql
CREATE UNIQUE INDEX uq_po_inflight ON core.purchase_order(retailer_tenant_id, product_id)
WHERE origin='AI' AND status IN ('NEGOTIATING','PENDING_APPROVAL','APPROVED','SUBMITTED');
```

**PO state machine:**
```
DRAFT → NEGOTIATING → {NEGOTIATION_REJECTED | PENDING_APPROVAL | APPROVED} ; PENDING_APPROVAL → {APPROVED|REJECTED_BY_USER|EXPIRED}
APPROVED → SUBMITTED → {CONFIRMED|PARTIALLY_CONFIRMED|DECLINED_BY_SUPPLIER|SUBMISSION_FAILED(retry)} → (PARTIALLY_)SHIPPED
→ DELIVERED → (PARTIALLY_)RECEIVED → CLOSED ;  CANCELLED from ≤ CONFIRMED (after SUBMITTED needs ERP ack) ; NEGOTIATION_ERROR → retry
```

### POS (Drizzle)
`shops` (mode SHOPIFY|LEGACY, token hash, secrets), `locations`, `products`, `variants` (sku, barcode = gtin), `inventory_items`, `inventory_levels` (available, updated_at, version), `inventory_adjustments` (idempotency_key unique), `orders`, `order_line_items`, `refunds`, `webhook_subscriptions`, `webhook_deliveries` (outbox with retries), `legacy_outbox`, `incoming_purchase_orders`, `users` (PIN), `idempotency_keys`, `api_call_log`.

### ERP (Alembic)
`companies` (mode ZOHO|PATH_B), `users`, `warehouses`, `items` (pack, MOQ, shelf life, lead time), `price_lists`, `price_list_items` (tiers), `stock_lots` (on hand, reserved, expiry), `customers`, `negotiation_policies` (maxDiscount, auto_confirm), `sales_orders` (po_number unique per company, status lifecycle), `sales_order_lines`, `allocations` (FEFO), `shipments`, `delivery_history` (reliability = (on_time+2)/(total+3)), `integration_configs`, `oauth_clients`, `oauth_tokens`, `outbox_events`, `inbound_requests`, `audit`.

---

## 7. End-to-end flows

**(a) Sale on the POS through to stock returned to the POS** (the core demo loop):
1. **Checkout.** The POS checks out with a conditional decrement (`available >= qty`, or 409). In the same transaction it enqueues the webhooks `orders/create` and `inventory_levels/update`.
2. **Webhook in.** The POS delivery worker (backoff 1 s → 10 min, 8 attempts) calls `POST /api/erp/webhook/{tenant}`. CARPIP verifies the HMAC on the raw body and the timestamp window, dedupes into `inbound_event`, writes `outbox_event` in the same transaction, and returns 200 in about 20 ms.
3. **To Kafka.** `OutboxRelay` (200 ms, ShedLock, idempotent producer, `acks=all`) publishes to `sales.events` and `inventory.updates`.
4. **Sales consumer.** Dedupes on `processed_event`, writes the sales ledger and `sales_daily` (IST), updates Redis velocity and pushes to SSE.
5. **Inventory consumer.** Applies the update only if its source version is newer, using `@Version` with 3 retries.
   - **Threshold check:** `inventoryPosition ≤ ROP`, and not (ROP = 0 with no demand), and no cooldown or in-flight PO.
   - If it passes: Redis lock, then `INSERT purchase_order NEGOTIATING` (a unique violation means skip), then an outbox write to `procurement.requests`.
6. **Procurement consumer.** Concurrency 2. Builds the 8-param context and the candidates (supplier offers joined with trade relationships). Recomputes a stale MPI. Calls `POST /api/negotiate` with a 40 s timeout.
7. **Intelligence.** Per supplier: MPI_j, Q_j, tier base price and bounds. Runs the negotiations in parallel with turn events going to `negotiation.events`. Then ranks the suppliers and computes T.
8. **Outcome.** Java persists the negotiation and its log, and updates the PO.
   - ACCEPTED: APPROVED (if autonomy mode is AUTO, or under `auto_approve_limit`) or PENDING_APPROVAL.
   - REJECTED / NO_SUPPLIERS: cooldown plus an alert.
   - Writes to `po.lifecycle`.
9. **Writeback.** The worker sends SUBMIT_PO: Zoho `salesorders` (`reference_number` = PO number, refresh on 401) or a signed REST call to the ERP. The PO becomes SUBMITTED.
10. **ERP confirms.** Auto-confirm or a manual confirm (possibly partial, with FEFO allocation) fires a `sales_order.confirmed` webhook. Zoho connections pick this up by polling instead. The PO becomes CONFIRMED, and PUSH_INCOMING sends the order to the POS `purchase_orders.json` (or the legacy callback).
11. **Ship and deliver.** Ship sends `shipment.created`; Deliver sends `sales_order.delivered` (with lots and expiry).
12. **Receipt.** CARPIP receives (automatically or manually, with actual quantities). ADJUST_STOCK calls the POS `inventory_levels/adjust.json` with an idempotency key and applies the returned absolute value. The PO goes to RECEIVED and then CLOSED.
13. **Echo.** The POS sends its own echo webhook, which is a no-op because the version is equal.

**(b) Polling fallback.** `ErpSyncService` runs `@Scheduled` with time scaling and ShedLock.
- **Shopify:** paginates products and inventory levels (honouring call limits and 429), and pulls missed orders with `orders.json?updated_at_min=cursor`. If polling finds deltas the webhooks never delivered, health goes to `WEBHOOK_DEGRADED` and the webhooks are re-registered.
- **Zoho:** polls items and open sales orders.
- **REST:** push-only, with a STALE alert.
- Unknown SKUs are auto-created; UNMAPPED events are parked.

**(c) MPI scheduler.**
- APScheduler runs every `900 s / time_scale` (minimum 5 s), with coalesce, `max_instances=1` and a Redis lock.
- Inputs are bulk-loaded with SQL and computed in vectorized pandas, with NaN guards.
- Writes `mpi_snapshot` and publishes `mpi.updates` when the value changes by at least 0.005.
- A "Run now" button triggers it manually.
- **Proactive trigger:** products whose `orderBy ≤ today` and that have no in-flight PO get a `FORECAST_T` procurement request (predictive, not only reactive).

**(d) CDIN round.**
1. The coordinator opens round n (version, quorum, deadline, `arch_hash`).
2. Nodes poll for it, download the global model (sha256 checked), and fetch **their own tenant's** training data.
3. Local training: local MinMax, 30-day windows, FedProx, optional DP noise.
4. Nodes upload the weights (safetensors), `num_samples`, and bucketed 21-day growth ratios.
5. Validation: shape and arch, finite values, base version v or v−1 (×0.5 weight), and a norm-outlier check.
6. FedAvg weighted by n_i, with each node's share capped at 0.6, gives global v+1.
7. **RDI** is published only for GTINs with at least 2 contributing nodes (k-anonymity). It feeds CS.
8. The ensemble's LSTM member is the CDIN global LSTM. With `FEATURE_CDIN=false` it is a local LSTM and RDI = 0.5 (ablation 2).

**(e) Forecasting** (CPU, models shared per tenant rather than per SKU):
- **Data prep:** zero-fill missing sales days and forward-fill exogenous features. Fit MinMax on the **train split only**, then a chronological 80/20 split.
- **Models:**
  - XGBoost with the paper's hyperparameters, `n_jobs=2`;
  - LSTM 64→32, dropout .2, about 20 epochs with early stopping;
  - Transformer with 4 heads, d64, ff128, cosine schedule.
- **Ensemble:** weights ∝ 1/val-MAE. Intervals come from residual quantiles.
- **Baselines:** SARIMA, moving average, seasonal-naive.
- **Fallbacks:** cold start uses a category profile; if every member is NaN, seasonal-naive; with no demand, 0.
- **Expected time:** about 30–90 s per tenant.

**(f) Manual PO and approvals.**
- `POST /procurement/plan` returns Q, T and the ranking at list prices. The retailer chooses "Negotiate with AI" (always lands in PENDING_APPROVAL) or "List price" (SKIPPED).
- Approval queue: shows the transcript, savings and expiry. Quantity can be edited within MOQ, pack size and availability; the price cannot be raised without renegotiating. Every decision is audited.
- Autonomy modes: `AUTO | APPROVAL_ABOVE_LIMIT | ALWAYS_APPROVE`.
- An expired quote becomes EXPIRED, with a re-negotiate action.
- Degraded mode: if intelligence has been down for more than 5 minutes and stock ≤ 0, Java creates a PENDING_APPROVAL PO at list price labeled DEGRADED.

---

## 8. Edge-case catalogue

Each entry gives the expected behavior and where it is handled. Every row gets a test (unit, integration or e2e scenario).

### Ingestion and idempotency
| Case | Handling |
|---|---|
| Duplicate webhook (same id) | 200 `duplicate`, no effect (`inbound_event` unique key + Redis seen-check) |
| Same body under a new webhook id (Shopify does not sign the id) | Content idempotency: sales unique on order+line; stock applied only if the version is newer |
| Out-of-order inventory updates | Older `updated_at` ignored and logged STALE_IGNORED. Property test: any permutation gives the same final stock |
| Timezone offsets (+05:30 vs Z) | Compared as Instant |
| Sale arrives through both the order and inventory feeds | Only the inventory feed moves stock (D3) |
| DELTA followed by ABSOLUTE (Path B) | The newer `asOf` wins |
| Unknown SKU or inventory item | UNMAPPED; targeted sync auto-creates the product |
| Webhook before onboarding finishes | 404, POS retries |
| Bad rows in a legacy batch | Per-row `rejected[]`; the remaining rows are accepted (202) |
| `Idempotency-Key` reused with a different body | 422 `IDEMPOTENCY_KEY_MISMATCH` |
| Refunds | Negative sale event |
| Body over 1 MB, or malformed JSON | 413 / 400 |
| Polling and a webhook race on the same SKU | Version compare plus `@Version` retry |
| Echo after a receipt writeback | No-op |

### Security
| Case | Handling |
|---|---|
| Bad HMAC | 401, audit entry, per-tenant counter |
| Stale timestamp (> 300 s) | 401 |
| Replayed CARPIP event id | 200 duplicate |
| Clock skew after the laptop sleeps | Preflight and health warn. Fix: `wsl --shutdown` |
| Secret rotation | Dual-secret window |
| JSON re-serialization changes the bytes | HMAC is always computed on the raw body |
| Path tenant does not match the connection | 404 |
| Tenant id supplied in a body or query | Ignored; tenant comes from the JWT or API key |
| Cross-tenant id lookup | 404 |
| GraphQL field leaks | Floor hidden from retailers, RMAP hidden from wholesalers |
| Wrong role | 403 |
| JWT expired | 401; the SPA re-logs in and preserves the route |
| Logout | jti denylist |
| Key rotation | 24h grace period |
| Rate limits (Redis Lua) | Login 10/min/IP, `/api/v1` 600/min/key, webhook 1200/min, GraphQL 120/min |
| Redis down | Fail open; the DB unique index still guards against duplicates |

### Kafka
| Case | Handling |
|---|---|
| Broker down | Webhooks still return 200; the outbox backlog grows with backoff; health DEGRADED; drains on recovery and stock converges |
| Poison message | `ErrorHandlingDeserializer` sends it to the DLT; admin can replay it |
| Transient error | 3 retries with backoff, then DLT |
| Crash between DB commit and offset commit | `processed_event` dedupe |
| Consumer lag in a sale storm | Lag metric shown; ordering preserved per product by key |
| Newer `schemaVersion` than supported | DLT |
| Topics missing | `kafka-init` gate; auto-create is off, so it fails loudly |
| Consumer gets an event whose tenant does not match the product's tenant | DLT |

### Stock and concurrency
| Case | Handling |
|---|---|
| Two POS checkouts race for the last unit | One succeeds, the other gets 409 |
| Concurrent CARPIP writes | Optimistic lock, 3 retries, then DLT |
| Negative stock (POS `continue` policy) | Flagged; MPI uses `max(0, stock)`; Q adds the backorder |
| Manual adjustment on a Shopify tenant | Routed to the POS (system of record), never set locally only |

### Procurement and PO lifecycle
| Case | Handling |
|---|---|
| Reorder storm | **Exactly one** in-flight AI PO per SKU (unique partial index) |
| Stock already covered by a confirmed PO | No trigger (inventory position includes on-order) |
| ROP = 0 and no demand | Never fires |
| All suppliers reject | NEGOTIATION_REJECTED, 30-minute cooldown (lifted early if MPI moves > 0.1), alert, manual PO offered |
| No suppliers or no trade relationship (R3–W-C) | NO_SUPPLIERS banner |
| Below MOQ | Supplier excluded with reason `BELOW_MOQ` |
| Partial confirm | REPLAN PO for the gap |
| Supplier declines | Fall through to rank #2 if its quote is still valid, otherwise re-run |
| Price expired at the ERP | Re-negotiate once |
| Submit timed out, but the ERP actually created the SO | Retry with the same idempotency key returns the existing SO |
| POS adjust retried | Idempotency key prevents a double receipt |
| Short delivery or over-delivery | Actual quantities received; over-delivery capped to shipped quantity |
| Cancel after SHIPPED | 409 |
| Writeback target down | Retries up to 10, then DEAD; admin retry |
| Intelligence down | NEGOTIATION_ERROR with retry; degraded PO if stock ≤ 0 |
| Quote expires while awaiting approval | EXPIRED |
| Perishable item, long-dated quantity | Shelf-life cap |

### LLM and Bedrock
| Case | Handling |
|---|---|
| Credentials missing, model access not granted, or wrong region | RULE-ONLY banner plus an actionable diagnosis (`check_bedrock.py`) |
| Throttling or timeout | That turn falls back to rule; the 25 s deadline still guarantees an answer |
| Invalid JSON, schema mismatch, refusal, or `max_tokens` | Rule turn with `guardrailReason` recorded |
| Out-of-bounds price or wrong action | Clamped or overridden, `clamped=true` |
| Prompt injection in a product name | Sanitized; the deterministic bounds make price manipulation impossible anyway |
| Daily token budget exhausted | RULE mode until midnight IST |
| Sampling parameter sent by mistake | Prevented by a unit test |
| Storm of parallel negotiations | Semaphore of 3; queued turns hit the deadline and fall back to rule |

### MPI, forecasting and CDIN
| Case | Handling |
|---|---|
| Missing, NaN or inf inputs | Factor prior; MPI always stays in [0, 1] (hypothesis property test) |
| New SKU (cold start) | Priors SA .65 / PV .42 / CS .5 |
| Zero sales | No auto-reorder |
| Scheduler overlap | Coalesce plus lock |
| Stale snapshot when negotiating | Synchronous recompute |
| Look-ahead leakage | Scaler fit on train only (test) |
| NaN member or diverging training | Member dropped, ensemble renormalized |
| Short history | Category profile |
| Retraining while inference runs | Last good model served |
| MAPE with zero actuals | MAPE excludes zeros; sMAPE also reported |
| CDIN node offline | 2/3 quorum still completes the round |
| Below quorum | FAILED_QUORUM; global model unchanged |
| Straggler posts after close | 409 |
| Divergent, poisoned or NaN weights | Rejected |
| Stale base version | v−1 accepted at ×0.5 weight |
| Architecture mismatch | 422 |
| Non-IID data | Local normalization, FedProx, 0.6 weight cap |
| Node restarts mid-round | Re-submit replaces its own update |
| Only one node reports a GTIN | No RDI published for it |
| Node credentials not written yet | Node waits |

### Money, time and infrastructure
| Case | Handling |
|---|---|
| Rounding and money in JS | Rules from §2 in golden tests; `big.js` in JS; `en-IN` ₹ formatting; prices are tax-inclusive (GST out of scope) |
| Sale at 23:55 IST | Bucketed to the IST date |
| Time-scale change mid-run | Next run rescheduled, minimum interval 5 s |
| Forecast days do not accelerate | Labeled in the UI |
| Startup ordering | Health-gated `depends_on` plus app-level retries |
| nginx starts before its upstream | Resolver trick |
| CRLF in shell scripts | `.gitattributes`, `sed` in Dockerfiles, preflight check |
| Windows reserved ports (5000/8080) | `netsh` check plus `*_HOST_PORT` overrides |
| WSL out of memory | `.wslconfig` plus memory limits |
| Space in "CARPIP final" path | Quote paths; `name: carpip`; worktrees in `D:\carpip-wt\` |
| Postgres init does not re-run | `reset.sh` |
| Offline demo venue | RULE mode, plus a `docker save` image tarball |

---

## 9. Build plan using Claude Code sub-agent fan-out

**Ground rules:**
- One git worktree per agent (Agent tool `isolation: "worktree"`).
- Each stream **owns** disjoint directories.
- Contracts are changed only by the lead; streams file `contracts/change-requests/<stream>-<n>.md`.
- At most 4–5 concurrent agents, because the laptop CPU and RAM limit parallel builds.
- Each owned directory gets a `CLAUDE.md` with its build and test commands.

### Phase 0: lead, sequential (gate CP0)
1. `git init`, `.gitattributes`, root `CLAUDE.md` (ownership map, ports, money and time rules), ADRs D1–D10, `docs/deviations-from-paper.md`. Copy this plan into `docs/plan.md`.
2. All of `contracts/`:
   - OpenAPI linted with `@redocly/cli`, GraphQL schema, event schemas checked with `ajv`;
   - HMAC test vectors, `formulas.md` plus ≥ 30 golden fixtures, a 20-SKU catalog fixture.
3. CARPIP Flyway V1–V9, plus POS/ERP DDL docs.
4. Compiling skeletons for all services:
   - Spring entities and repositories, `TenantContext`, the `ErpAdapter` interface, `Money`;
   - Flask app factory with **blueprint auto-discovery**, so two streams never edit the same registration file;
   - typed clients generated from OpenAPI for the frontends.
5. Compose with infra working, `.env.example`, `preflight.sh`, `contracts/validate.sh`, and Prism mock commands.
6. **Run `scripts/check_bedrock.py` early** to confirm Sonnet 5.5 access in the chosen region.

**CP0 gate:** infra containers healthy, contracts valid, every skeleton builds.

### Phase 1: parallel streams
**Wave 1A** starts together: S1, S2, S3, S5, S7, S10a. **Wave 1B** works against mocks first: S4, S6, S8, S9.

| Stream | Owns | Deliverables / DoD | Tests |
|---|---|---|---|
| **S1 backend-platform** | `com.carpip.{auth,tenant,catalog,inventory,sales,supplier,procurement,negotiation,graphql,events,ratelimit,audit,demo,common,config}`, pom, yml | JWT and API keys, tenancy, outbox relay, consumers, threshold and dedupe, PO state machine, approvals, Flask client, GraphQL, SSE, rate limit, audit, admin health/DLQ/demo. ≥ 80% coverage on procurement and inventory | JUnit5, Mockito, Zonky embedded PG, EmbeddedKafka, GraphQlTester, WireMock; 20-thread dedupe test; tenant isolation suite |
| **S2 backend-integration** | `com.carpip.erp.**`, `com.carpip.api.**` | `ShopifyAdapter`, `CustomRestAdapter` (fieldMap), `ZohoInventoryAdapter` (OAuth), `ErpSyncService`, `WritebackWorker`, `/api/v1/*`, `/api/erp/{sync,webhook}`, AES-GCM credentials | WireMock fixtures; HMAC vectors; replay, stale and rotation tests |
| **S3 intelligence-pipf** | `app/{mpi,negotiation,procurement,llm,demo}` | Factors, MPI scheduler, protocol, Bedrock client with guardrails, breaker and budget, Q/T/ranking, `/api/negotiate`, fault injection, `check_bedrock.py` | pytest + hypothesis; fake LLM; opt-in live `BEDROCK_LIVE=1` |
| **S4 intelligence-ml + CDIN** | `app/{forecasting,cdin}`, `cdin-node/`, `libs/python/carpip_ml/`, ML Dockerfile | 3 models plus ensemble and baselines, registry, coordinator, node. Tenant training < 2 min on CPU; a 3-node round completes | Leakage, NaN, FedAvg math, quorum, straggler, divergence |
| **S5 pos-backend** | `pos-backend/` | Shopify mimic (Host-based shop resolution, Link pagination, leaky bucket), webhook outbox and signer, purchase_orders, idempotent adjust, legacy push and callback, checkout race safety, demo endpoints | vitest + `fastify.inject`; schemathesis |
| **S6 pos-frontend** | `pos-frontend/` | Cashier UI (shop switch, PIN, grid, barcode search, cart), stock badges, Incoming Stock, Integration Log | vitest + RTL |
| **S7 erp-backend** | `erp-backend/` | Multi-company, FEFO lots, price tiers, SO lifecycle, signed and idempotent inbound, Zoho mimic + OAuth, outbox webhooks, sync pusher, reliability, GraphQL proxy, demo endpoints | pytest + httpx |
| **S8 erp-frontend** | `erp-frontend/` | SO inbox (partial confirm, ship, deliver, reject), catalog and lots, price lists, policies, Demand Insights, integration log | vitest |
| **S9 carpip-frontend** | `carpip-frontend/` | Dashboard (live SSE feed), Inventory, Product (forecast band, MPI factor stack), Procurement and PO timeline, Negotiation transcript (price-band chart with Floor/Ceiling/RMAP), Approvals, Suppliers, Integrations, CDIN, Settings, Admin (Health, DLQ, **Demo Control Panel**, Metrics). Uses the `dataviz` skill for charts | vitest + RTL + MSW |
| **S10a data → S10b** | `scripts/{datagen,bootstrap,e2e,bench}`, `e2e/playwright/`, `carpip-intelligence/bench/` | 10a (day 1): deterministic generator + Dunnhumby loader. 10b (Phase 2): bootstrap, smoke, scenarios, bench, Playwright | Same seed gives the same hash |

**Shared files:** `docker-compose.yml` and `.env.example` are edited only by the lead. S1 and S2 share a Maven module but own disjoint packages, and Phase 0 pre-adds their dependencies.

**CP1 gate:** every image builds and is healthy; unit tests green; schemathesis passes against each service's own OpenAPI.

### Phase 2: integration (3 integration agents plus the lead)
- **I1 retail path:** POS ↔ CARPIP. Shopify test, sync and webhook registration, sales → stock, the legacy store, receipt writeback, echo no-op.
- **I2 wholesale path:** ERP ↔ CARPIP. Sync push, Zoho polling and OAuth, PO submit, confirm/ship/deliver, partials, decline → rank #2, GraphQL insights.
- **I3 intelligence path:** backend ↔ Flask in rule mode first, then live Bedrock; MPI time scale, training at boot, 3-node CDIN, fault injection.
- S10b then finishes bootstrap and `smoke.py`.

**CP2:** every pairwise path is green. **CP3:** from a clean clone, `docker compose down -v && up` gives a healthy stack and a finished bootstrap within 10 minutes (images prebuilt), and smoke passes in both rule and llm mode.

### Phase 3: demo hardening
- Scenario panel finished, each scenario with a live assertion.
- `docker stats` tuning to keep RSS at or below 5 GB.
- Playwright walkthrough with screenshots.
- Benchmarks written to `docs/results/`.
- Runbook and Windows troubleshooting doc.
- Offline rehearsal and a `docker save` tarball.

**CP4:** two timed rehearsals complete without manual fixes.

---

## 10. Verification

### Unit tests
- **Java:** JUnit5 with Zonky embedded Postgres (lighter than Testcontainers) and EmbeddedKafka.
- **Python:** pytest + hypothesis.
- **Properties checked:**
  - MPI and every factor stay in range, including for NaN inputs;
  - DP is monotone;
  - every price is in [Floor, Ceiling]; an accepted price is in [Floor, RMAP]; turns ≤ 3;
  - rule mode is deterministic;
  - random LLM output never breaks an invariant;
  - Q ≥ Q_paper unless a cap reason is present;
  - FedAvg equals the manual weighted mean;
  - forecasts are finite, ≥ 0, and leak-free.
- **Shared fixtures:** the golden formula files are read by both Java and Python tests.

### Contract tests
- `scripts/contracts/validate.sh`.
- schemathesis against CARPIP `/api/v1`, the POS Shopify mimic, and the ERP inbound and Zoho APIs.
- The adapter conformance suite runs against WireMock **and** against the real POS/ERP containers.

### E2E smoke (`scripts/e2e/smoke.py`)
1. Run a sale storm of about 60 sales in 5 s, including duplicates.
2. Within 60 s, assert:
   - CARPIP stock equals POS stock per SKU;
   - **exactly one** PO per triggered SKU;
   - negotiation turns ≤ 3 and prices within bounds;
   - the SO exists in the ERP.
3. Drive the ERP through confirm, ship and deliver.
4. Assert:
   - the PO is CLOSED;
   - POS stock equals the pre-sale value plus the received quantity;
   - DLT count is 0 and the outbox backlog is 0.

Flags: `--mode rule|llm` and `--scenario <name>`.

### Other checks
- **Playwright** (`npx playwright test` from the host): the demo storyline across the CARPIP, POS and ERP browser contexts.
- **`check_bedrock.py`:** reports the credential source, region and model; sends one structured-output call and one `count_tokens` call; maps each error to a fix.
- **Cold boot test:** `docker compose down -v && docker compose up`, then the smoke test.

---

## 11. Demo storyline (10 minutes) and scenario control panel

| Time | Action | What to show |
|---|---|---|
| 0:00 | System Health | All services green, Kafka lag 0, "LLM: Sonnet 5.5 via Bedrock" |
| 1:00 | Integrations page | Shopify connection test, legacy fieldMap, Zoho token refresh |
| 2:00 | Ring up a sale on POS store-1 for a near-ROP SKU | Live feed: webhook, Kafka, stock, MPI, "negotiating" |
| 3:30 | Negotiation view | 3 suppliers negotiate in parallel, price-band chart, a clamped turn, one REJECTED supplier, ranking breakdown, Q/T panel, PO approved |
| 5:00 | ERP: confirm (FEFO), ship, deliver | CARPIP PO timeline, POS "Incoming", POS stock jumps |
| 6:30 | ERP Demand Insights / GraphiQL | Path B GraphQL |
| 7:00 | Product page and CDIN page | Forecast band, MPI factors, time scale ×60, CDIN round with 3 nodes and RDI |
| 8:00 | Scenario panel | 3–4 scenarios from the list below |
| 9:30 | Metrics page | Latency, token reduction, success rate, ablations (labeled synthetic) |

Scenarios (`/admin/demo`, ADMIN only, `DEMO_MODE` required):

| Scenario | What it shows |
|---|---|
| `sales-spike` | Exactly one PO per SKU; lag spike drains |
| `supplier-stockout` | SA↓ and MPI↑; supplier excluded or rank #2 used |
| `price-hike` | PV↑ and floor↑ |
| `bedrock-outage` (throttle, timeout, invalid_json, out_of_bounds) | RULE-ONLY banner; negotiation still completes |
| `kafka-outage` | Webhooks still 200; outbox backlog drains on recovery |
| `webhook-replay` (same id, new id, tampered) | 200 duplicate, no-op, 401 + audit entry respectively |
| `out-of-order` | STALE_IGNORED |
| `partial-shipment` | REPLAN for the gap |
| `cdin-node-offline` | Round completes with 2 of 3 |
| `webhooks-down` | Polling catches up; WEBHOOK_DEGRADED |

---

## 12. Paper metrics: measured vs out of scope

**Measured** (written to `docs/results/` with git SHA, seed and config hash):
- CRUD latency (20 concurrent, 2k requests, avg/p50/p95; compared with the paper's 42.1 ms).
- Ingest latency.
- **Token reduction:** `count_tokens` on the 8-param context vs a raw "standard RAG" context over 1,000 cases, plus live latency on N=30.
- Negotiation success rate, guardrail rate and savings in each of `llm`, `rule` and `off` modes.
- Cycle time.
- Table-I-style MAE, RMSE, MAPE and sMAPE (SARIMA, MA, LSTM, XGB, Transformer, ensemble).

**Offline simulator** (`bench/simulate.py`, profile `bench`):
- A 30-day discrete-event simulation of B1 (EOQ/ROP), B2 (isolated ML) and full CARPIP, plus ablations (no MPI, no CDIN, no LLM).
- It **imports the production decision code**, so the benchmark and the live system share one code path.
- Reports stockout rate, holding cost, waste, a paired t-test, and cycle time.
- Every table is labeled **"Synthetic, scaled-down; not comparable to the paper's 43k SKUs / 42 nodes."**
- Expect `llm` and `rule` modes to give nearly identical success rates; that is by design.

**Out of scope** (documented):
- the 43k-SKU / 42-node scale and GPU timings;
- the Llama-3/GPT-4o comparison and LangChain;
- an exact reproduction of the cost figures;
- real Shopify/Zoho/SAP tenants (mimics only) and the OAuth install flow;
- zk-SNARKs and GNNs;
- a live pilot.

---

## 13. Risks

1. **Bedrock access to Sonnet 5.5 in the chosen region.** Verified at CP0 with `check_bedrock.py`. If the region needs an inference-profile id, `BEDROCK_MODEL_ID` handles it.
2. **First build takes 15–25 minutes on a U-series CPU** (the ML image is about 1.5 GB). Mitigation: BuildKit caches, the shared ML image, and a prebuilt tarball before the demo.
3. **LLM latency of about 6–12 s per SKU** (up to 5 calls × 3 suppliers). Fallback flag `LLM_TURN_POLICY=decisive` uses the LLM only on T2 and T3.
4. **Shopify extensions** (purchase_orders, idempotent adjust) do not exist in real Shopify. They are documented, along with the real-Shopify alternative (GraphQL `inventoryAdjustQuantities`).
