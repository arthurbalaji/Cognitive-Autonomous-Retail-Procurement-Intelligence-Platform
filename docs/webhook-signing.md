# Webhook & callback signing

Signatures are always computed over the **raw request bytes** (never re-serialised JSON) and compared in constant time.

## Shopify scheme (POS -> CARPIP)
```
X-Shopify-Hmac-Sha256: base64( HMAC_SHA256(shopSecret, rawBody) )
X-Shopify-Topic, X-Shopify-Shop-Domain, X-Shopify-Webhook-Id, X-Shopify-Triggered-At, X-Shopify-API-Version: 2024-01
```
Replay defence (the webhook id and timestamp are **not** covered by the signature in real Shopify): (a) dedupe on `X-Shopify-Webhook-Id`; (b) `Triggered-At` must be within +-300 s; (c) content idempotency - a sale is unique on (order, line) and stock only moves through source-versioned inventory events.

## CARPIP scheme (Path B, both directions)
```
X-Carpip-Timestamp: <unix seconds>
X-Carpip-Event-Id:  <uuid>
X-Carpip-Signature: v1=<hex HMAC_SHA256(secret, timestamp + "." + eventId + "." + rawBody)>[,v1=<hex>...]
```
* Window +-300 s (`WEBHOOK_TOLERANCE_S`); event id deduped per tenant.
* **Rotation**: the verifier accepts the current secret and, for 24 h after rotation, the previous one; a signature header may carry several comma-separated `v1=` values.
* Outbound calls from CARPIP to an ERP / legacy POS additionally carry `Idempotency-Key` (`<poNumber>:<action>[:<supplier>]`) and `X-Carpip-Tenant` (the wholesaler's / retailer's public id).
* Body limit 1 MB (413).

## Other credentials
* Interactive users: `Authorization: Bearer <JWT>` (HS256, 24 h, `jti` revocable).
* External systems: `Authorization: Bearer ck_live_<8 chars>_<32 chars>` with scopes `inventory:write, orders:write, catalog:write, graphql:read, cdin:node`.
* Shopify-style calls from CARPIP: `X-Shopify-Access-Token`; Zoho-style: `Authorization: Zoho-oauthtoken <access>` obtained with a refresh token (1 h).
* Java -> Flask: `X-Internal-Token`.
