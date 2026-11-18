# E9 - webhook ingestion load test (live stack, single laptop)

Open-loop, HMAC-signed `inventory_levels/update` webhooks to CARPIP's public endpoint for store-1, 60 s per rate, 100 items. Latency = client-side round trip to the HTTP 200 (verification + inbound_event insert + outbox insert in one transaction). Pipeline lag = database clock, inbound_event.received_at -> stock_movement.at (outbox relay -> Kafka -> idempotent consumer -> versioned stock write). All services and the generator share one laptop.

| offered req/s | achieved | ok | errors | p50 ms | p95 ms | p99 ms | applied | pipeline lag p50 / p95 / p99 s | drain s | backend CPU mean/peak % |
|---|---|---|---|---|---|---|---|---|---|---|
| 25 | 25.0 | 1500 | 0 | 12.5 | 27.6 | 35.0 | 1500 | 0.142 / 0.24 / 0.268 | 3.6 | 38.2 / 76.75 |
| 50 | 50.0 | 1311 | 1689 | 6.8 | 26.0 | 34.0 | 1311 | 0.189 / 0.309 / 0.374 | 3.5 | 29.4 / 67.13 |
| 100 | 100.0 | 1200 | 4800 | 6.4 | 48.1 | 65.2 | 1200 | 5.597 / 8.491 / 9.552 | 3.5 | 56.1 / 253.87 |
| 200 | 99.4 | 2400 | 9600 | 2846.2 | 16433.7 | 25945.5 | 2400 | 1.448 / 3.374 / 3.823 | 3.7 | 74.1 / 222.08 |

Outbox relay lag (receipt -> Kafka publish) p50 / p99: 0.197 / 0.619 s.
Convergence after restoring true levels: 0 mismatching items of 100. Purchase orders before/after: 43/43.