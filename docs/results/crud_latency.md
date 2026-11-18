# CARPIP core API latency

600 requests per case, 20 concurrent clients, new connection per request (worst case), laptop Docker.

| Case | avg ms | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| READ  GET /api/products?size=20 | 152.2 | 142.7 | 245.2 | 368.0 | 0 |
| READ  GET /api/products/{id} | 116.1 | 110.1 | 199.2 | 264.8 | 0 |
| READ  GET /api/purchase-orders | 91.0 | 85.7 | 152.2 | 203.8 | 0 |
| READ  GET /api/dashboard/summary | 152.9 | 147.5 | 219.5 | 268.8 | 0 |
| WRITE PATCH /api/products/{id} (reorder point) | 108.3 | 97.1 | 185.8 | 521.9 | 0 |
| GRAPHQL stockStatus(first:20) [100 req: limit is 120/min/user] | 186.2 | 95.7 | 458.9 | 2066.1 | 0 |
