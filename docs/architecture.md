# Architecture

## Topology (all in Docker; networks `core`, `db`, `edge`)

```
 Browser ──> nginx(3000) ──> carpip-backend :8080  (Spring Boot)  ──> Postgres(carpip) / Redis / Kafka
                                   │  HTTP (X-Internal-Token)
                                   └────────────> carpip-intelligence :5000 (Flask) ──> Bedrock (HTTPS, SigV4)
                                                     ▲   APScheduler: MPI every 15 min, CDIN deadlines
 cdin-node-1..3 ── weights/growth ratios ───────────┘   (pull-based; API key scope cdin:node)

 pos-frontend(3100) ─> pos-backend :4000  ──signed webhooks / REST──> carpip-backend   (edge network only)
 erp-frontend(3200) ─> erp-backend :8000  ──signed webhooks / REST──> carpip-backend
```
POS and ERP sit on the `edge` network only: they cannot reach Kafka, Redis or the engine - exactly as real external systems couldn't. Each has its own database and its own role (`pos_app`, `erp_app`); `REVOKE CONNECT` stops one role opening another's database. The engine uses a read-mostly role (`carpip_intel`).

## The autonomous loop (paper Fig. 3) as implemented
1. **Ingest** - POS sale -> `orders/create` + `inventory_levels/update` webhooks (HMAC). CARPIP verifies the raw body, checks the timestamp window, dedupes on the webhook id, and writes `inbound_event` + `outbox_event` in **one** transaction, answering 200 in ~20 ms.
2. **Route** - `OutboxRelay` publishes to Kafka (`sales.events`, `inventory.updates`; key `tenant:product`). Kafka is never on the webhook path.
3. **Apply** - idempotent consumers (`processed_event`); `InventoryApplier` ignores any ABSOLUTE update whose source version is not newer (out-of-order / replay / echo are harmless); `@Version` + 3 jittered retries.
4. **Threshold** - position = stock + confirmed on-order. `<= ROP` (ROP > 0, no cooldown) -> insert PO `NEGOTIATING`; the partial unique index `uq_po_inflight` makes a duplicate impossible even under races -> `procurement.requests`.
5. **Decide** - procurement consumer builds the lean payload (8 parameters + candidates) and calls `POST /api/negotiate`. The engine: recompute MPI -> per supplier Q_j / tier price / MPI_j / bounds -> run all negotiations in parallel (Claude voice or rule voice) -> rank -> timeline. Persisted as `negotiation` + `negotiation_log` rows.
6. **Order** - autonomy mode: `AUTO` -> `APPROVED`; limit/always -> `PENDING_APPROVAL`. `APPROVED` enqueues a durable `SUBMIT_PO` writeback; the worker posts to the supplier ERP (Zoho `salesorders`, or signed REST) and moves the PO to `SUBMITTED`.
7. **Fulfil** - ERP confirm (FEFO reserve) / ship / deliver -> signed webhooks (or Zoho polling) -> PO states (monotone: stale/duplicate events ignored). `PUSH_INCOMING` tells the POS what is on the way.
8. **Receive** - `ADJUST_STOCK` writeback (idempotency key) -> POS stock increases; CARPIP adopts the POS' returned absolute level; the POS's own echo webhook is a no-op. PO -> `RECEIVED` -> `CLOSED`.

## Purchase-order state machine
```
NEGOTIATING ─> APPROVED ─> SUBMITTED ─> CONFIRMED / PARTIALLY_CONFIRMED ─> (PARTIALLY_)SHIPPED ─> DELIVERED ─> (PARTIALLY_)RECEIVED ─> CLOSED
     │  └─> PENDING_APPROVAL ─> APPROVED | REJECTED_BY_USER | EXPIRED
     ├─> NEGOTIATION_REJECTED (cooldown on the SKU)      SUBMITTED ─> DECLINED_BY_SUPPLIER (or re-route to rank #2 -> APPROVED)
     └─> NEGOTIATION_ERROR ─(retry x5)─> degraded list-price PENDING_APPROVAL         any pre-delivery state ─> CANCELLED
```
Transitions are validated in `PurchaseOrderService.isAllowed`; invalid ones return `409 PO_INVALID_TRANSITION`; supplier-driven events never throw (they report `IGNORED_*`) so a webhook transaction cannot be poisoned.

## Kafka topics
`sales.events`(3) `inventory.updates`(3) `procurement.requests`(3) `po.lifecycle`(3) `negotiation.events`(1) `mpi.updates`(3) + `<topic>.DLT` for the first four. Envelope: `eventId, eventType, schemaVersion, tenantId, occurredAt, source{system,connectionId,externalId}, correlationId, payload`. Unknown newer `schemaVersion` -> DLT. 3 retries (1 s) then DLT; admin console can inspect and replay.

## Integration contracts
* **Path A - Shopify mimic** (`pos-backend/src/shopify.ts`): `shop.json`, `products.json` (Link pagination), `inventory_items/levels`, `orders.json`, `webhooks.json`, leaky-bucket 429. Extensions: `purchase_orders.json`, `X-Carpip-Idempotency-Key` on `adjust.json`.
* **Path A - Zoho mimic** (`erp-backend/erp/api_zoho.py`): OAuth2 refresh-token, `items`, `salesorders` (unique `reference_number` = PO number), token expiry -> CARPIP refreshes once on 401.
* **Path B - open API**: `POST /api/v1/inventory`, `/api/v1/orders` (API key, `Idempotency-Key`, per-connection `fieldMap`), `POST /api/erp/sync` (catalog push), `POST /api/erp/webhook/{tenantPublicId}` (signed), GraphQL.
* **Signatures**: see `webhook-signing.md`.

## Security model
JWT HS256 24 h (`jti` revocable via Redis); API keys `ck_live_<prefix>_<secret>` stored as SHA-256 + scopes, rotation keeps the old key 24 h; tenant id only from the credential; connector secrets AES-GCM at rest; all webhook comparisons constant-time over raw bytes; rate limits (login 20/min/IP, API key 600/min, GraphQL 120/min, webhook 1200/min/tenant); GraphQL depth 6 / complexity 500; floor price hidden from retailers and retailer-max hidden from wholesalers; prompt-injection: untrusted text is sanitised and the LLM cannot change actions or exceed price bounds.

## Edge cases and where they are handled
| Area | Case | Handling | Evidence |
|---|---|---|---|
| Ingestion | duplicate webhook id | `inbound_event` unique key -> `200 duplicate` | `scenarios.py webhook-replay` |
| | same body, new id (id is unsigned in Shopify) | sale unique on (order,line); stock only moves via versioned feed | `scenarios.py` |
| | out-of-order stock updates | source-version compare, `STALE_IGNORED` movement | `scenarios.py out-of-order` |
| | tampered body / stale timestamp / bad secret | 401, audit entry, nothing stored | `scenarios.py` |
| | unknown SKU / inventory item | `UNMAPPED`, `needSync` triggers a targeted sync | `WebhookService` |
| | bad rows in a batch | per-row `rejected[]`, rest applied (202) | `InventoryBatchService` |
| | `Idempotency-Key` reused with another body | 422 `IDEMPOTENCY_KEY_MISMATCH` | `ApiController` |
| Kafka | broker down | outbox backlog + backoff; webhooks still 200; drains in order | `scenarios.py kafka-outage` |
| | poison message | non-retryable -> `.DLT`, replayable | `KafkaConfig`, DLQ page |
| | redelivery | `processed_event` in the same TX as the effect | `InventoryApplier` |
| Stock | racing checkouts for the last unit | conditional `UPDATE ... available + delta >= 0`; 409 | `scenarios.py concurrency-race` |
| | concurrent CARPIP writers | `@Version` + retries | `InventoryService` |
| Procurement | reorder storm | one in-flight AI PO per SKU (unique partial index) | `smoke.py` |
| | no supplier / no trade relationship | `NO_SUPPLIERS`, cooldown, banner (R3 <-> WC) | bootstrap data |
| | below MOQ / pack size / shelf life / availability | quantity plan with reason codes; infeasible suppliers excluded | `tests/test_math.py` |
| | all negotiations rejected | `NEGOTIATION_REJECTED`, 30-min cooldown (`REJECT_COOLDOWN_MIN`) | `OrderDetail` |
| | supplier declines | re-route to next ranked valid quote, else `DECLINED_BY_SUPPLIER` | `PurchaseOrderService.handleDecline` |
| | submit timeout after ERP created the SO | idempotent on `po_number` / `Idempotency-Key` | ERP `create_sales_order` |
| | partial confirmation / short delivery / over-delivery | `PARTIALLY_*`, replan for the gap, receive capped to shipped | `scenario partial-shipment` |
| | engine down | retry x5, then degraded list-price order for approval | `ProcurementConsumer` |
| LLM | throttle, timeout, invalid JSON, refusal, expired AWS token, budget, open breaker | rule voice for that turn; breaker; banner | `scenarios.py bedrock-outage` |
| | hallucinated/out-of-band price or wrong action | clamped / overridden, counted as guardrail intervention | property tests |
| | prompt injection (product name or model output) | sanitised input; message-vs-price consistency check; injection phrases rejected | `scenarios.py` |
| Security | cross-tenant access | 404; role checks 403 | `scenarios.py tenant-isolation` |
| | secret rotation | previous secret accepted for 24 h | `ConnectionService` |
| Time/money | IST business day vs UTC storage; floor up / RMAP down rounding | fixed in code | `SalesService`, `bounds.py` |
| Platform | Windows CRLF, ports, WSL memory/clock skew | `.gitattributes`, `preflight.sh`, `wslconfig.example` | `troubleshooting-windows.md` |
