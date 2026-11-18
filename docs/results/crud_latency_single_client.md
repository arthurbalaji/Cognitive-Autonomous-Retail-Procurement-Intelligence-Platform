# CARPIP core API latency

100 requests per case, 1 concurrent clients, new connection per request (worst case), laptop Docker.

| Case | avg ms | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| READ  GET /api/products?size=20 | 25.4 | 25.2 | 41.3 | 44.1 | 0 |
| READ  GET /api/products/{id} | 20.3 | 21.1 | 33.8 | 41.8 | 0 |
| READ  GET /api/purchase-orders | 20.4 | 20.6 | 34.7 | 40.1 | 0 |
| READ  GET /api/dashboard/summary | 35.0 | 33.2 | 56.6 | 67.1 | 0 |
| WRITE PATCH /api/products/{id} (reorder point) | 26.0 | 26.0 | 37.1 | 52.2 | 0 |
| GRAPHQL stockStatus(first:20) [100 req: limit is 120/min/user] | 26.0 | 25.9 | 41.1 | 46.5 | 0 |
