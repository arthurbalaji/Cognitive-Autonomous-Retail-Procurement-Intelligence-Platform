# E7c - CDIN at larger scale (5 seeds)

World: 12 stores x 120 SKUs x 210 days (deterministic generator `scripts/bench/world12.py`); models see days 0-149 only. Planted regional precursor on 16 SKUs: 4 early stores ramp x1 -> x2 over days 160-180 and stay high; the other 8 'late' stores do the same 20 days later (days 180-200) and stay high until day 209 (a 30-day surge window). Daily origins 150-209; RDI threshold 0.6; equal node weights; published only when >= 2 nodes report. Federated: 3 rounds x 3 local epochs, FedProx mu=0.01, FedAvg weighted by samples, share cap 0.6 (the coordinator's norm-outlier rejection is not replicated). Mean ± std over seeds.

## Accuracy: local-only vs federated LSTM (no ensemble)

| Variant | origins | pooled MAE | pooled WAPE % | surge SKUs MAE | other SKUs MAE |
|---|---|---|---|---|---|
| LOCAL | 150-159 (before precursor) | 1.527 ± 0.086 | 36.9 ± 1.1 | 2.084 ± 0.103 | 1.441 ± 0.110 |
| LOCAL | 150-196 | 1.688 ± 0.070 | 38.0 ± 1.4 | 3.291 ± 0.238 | 1.441 ± 0.108 |
| FEDERATED | 150-159 (before precursor) | 1.604 ± 0.094 | 38.8 ± 1.1 | 2.195 ± 0.131 | 1.513 ± 0.121 |
| FEDERATED | 150-196 | 1.767 ± 0.077 | 39.8 ± 1.3 | 3.420 ± 0.254 | 1.512 ± 0.119 |
| MOVING_AVG_7 | 150-196 | 1.777 ± 0.095 | 40.0 ± 0.9 | | |

Federated minus local, pooled MAE (all origins): diff +0.0788, t-test p=3.36e-05, Wilcoxon p=0.0625

Communication: LSTM state 119.8 KiB; per round 12 nodes x (up + down) = 2875 KiB; 3 rounds 8626 KiB in total.

## Early warning: regional demand index

Detection = first daily origin >= day 160 with RDI > 0.6 (`sustained` = three consecutive origins). Lead = days before the late stores' surge starts (day 180). 'Spurious' = surge SKUs above threshold before the precursor exists.

| Metric | A: platform growth (local LSTM) | A': platform growth (round-3 node model) | B: sales velocity |
|---|---|---|---|
| surge SKUs with an RDI published | 16.0 ± 0.0 | 16.0 ± 0.0 | 16.0 ± 0.0 |
| detected after precursor start (first crossing) | 8.8 ± 8.4 % | 1.2 ± 2.8 % | 100.0 ± 0.0 % |
| detected, sustained 3 origins | 3.8 ± 5.6 % | 0.0 ± 0.0 % | 100.0 ± 0.0 % |
| lead before late-store surge (days), mean over detected | 18.0 ± 1.3 | 14.0 ± 0.0 | 13.4 ± 1.3 |
| delay after precursor start (days) | 2.0 ± 1.3 | 6.0 ± 0.0 | 6.6 ± 1.3 |
| spurious: surge SKUs above threshold BEFORE the precursor | 15.0 ± 13.0 % | 1.2 ± 2.8 % | 56.2 ± 11.7 % |
| false positives: non-surge SKUs above threshold on/after day 160 | 59.9 ± 4.3 % | 47.3 ± 2.1 % | 95.1 ± 0.8 % |
| false positives: non-surge SKUs above threshold anywhere (150-209) | 62.3 ± 3.4 % | 48.5 ± 1.8 % | 95.9 ± 0.7 % |
| non-surge SKU-days above threshold, before day 160 | 12.8 ± 1.7 % | 9.0 ± 4.1 % | 31.1 ± 3.4 % |
| non-surge SKU-days above threshold, from day 160 | 14.3 ± 2.6 % | 9.9 ± 3.6 % | 28.8 ± 2.4 % |
| AUC of mean RDI (days 170-179), surge vs other SKUs | 0.154 ± 0.041 | 0.120 ± 0.036 | 0.892 ± 0.040 |

Mean RDI by origin day (surge SKUs / other SKUs):

| Day | A | A3 | B |
|---|---|---|---|
| 150 | 0.495 / 0.508 | 0.474 / 0.500 | 0.514 / 0.550 |
| 159 | 0.496 / 0.508 | 0.469 / 0.499 | 0.517 / 0.557 |
| 165 | 0.491 / 0.520 | 0.466 / 0.508 | 0.543 / 0.530 |
| 170 | 0.463 / 0.521 | 0.449 / 0.508 | 0.639 / 0.540 |
| 175 | 0.429 / 0.514 | 0.414 / 0.499 | 0.726 / 0.546 |
| 180 | 0.402 / 0.510 | 0.388 / 0.501 | 0.750 / 0.549 |
| 190 | 0.306 / 0.516 | 0.302 / 0.505 | 0.886 / 0.542 |
| 200 | 0.222 / 0.516 | 0.222 / 0.505 | 0.921 / 0.545 |
| 209 | 0.211 / 0.518 | 0.194 / 0.505 | 0.832 / 0.526 |

## Effect of the RDI forecast uplift on the late stores (origins 168-196, MAE in units, 14-day horizon)

Uplift u = clip(1 + 0.6 (RDI - 0.5), 0.8, 1.3) on the local LSTM forecast (platform rule); oracle = true ramp ratio clipped the same way.

| Variant | surge SKUs MAE | other SKUs MAE (harm) |
|---|---|---|
| no CDIN | 3.518 ± 0.442 | 1.434 ± 0.115 |
| A: platform growth, local LSTM | 3.900 ± 0.558 | 1.445 ± 0.116 |
| A': platform growth, round-3 node model | 3.927 ± 0.555 | 1.446 ± 0.117 |
| B: sales velocity (last7/prev28) | 3.004 ± 0.311 | 1.449 ± 0.117 |
| oracle (true ramp) | 2.847 ± 0.264 | 1.434 ± 0.115 |

## Replenishment simulation, late stores, days 168-209

Order-up-to policy per store x SKU: lead 3 d, review 7 d, safety 1.65 sigma(28 d) sqrt(L), reorder when position <= forecast over L+3 days + safety, order = forecast over L+R + safety - position; start stock = 14 days of pre-surge mean demand; lost sales when stock < demand.

| Variant | group | stockout-day share | lost-unit share | stock per unit of daily demand |
|---|---|---|---|---|
| no CDIN | surge SKUs | 1.3 ± 0.1 % | 0.9 ± 0.2 % | 3.82 ± 0.11 |
| no CDIN | other SKUs | 0.2 ± 0.0 % | 0.1 ± 0.0 % | 6.46 ± 0.11 |
| A: platform growth, local LSTM | surge SKUs | 3.3 ± 0.2 % | 2.8 ± 0.2 % | 3.29 ± 0.13 |
| A: platform growth, local LSTM | other SKUs | 0.2 ± 0.0 % | 0.1 ± 0.0 % | 6.42 ± 0.13 |
| A': platform growth, round-3 node model | surge SKUs | 3.5 ± 0.2 % | 2.9 ± 0.3 % | 3.26 ± 0.12 |
| A': platform growth, round-3 node model | other SKUs | 0.2 ± 0.0 % | 0.1 ± 0.0 % | 6.33 ± 0.12 |
| B: sales velocity (last7/prev28) | surge SKUs | 0.3 ± 0.1 % | 0.2 ± 0.1 % | 4.82 ± 0.13 |
| B: sales velocity (last7/prev28) | other SKUs | 0.2 ± 0.0 % | 0.1 ± 0.0 % | 6.56 ± 0.12 |
| oracle (true ramp) | surge SKUs | 0.3 ± 0.1 % | 0.2 ± 0.1 % | 4.93 ± 0.12 |
| oracle (true ramp) | other SKUs | 0.2 ± 0.0 % | 0.1 ± 0.0 % | 6.46 ± 0.11 |

Paired tests over 5 seeds (variant minus no CDIN; low power at this n):

* A: platform growth, local LSTM - surge SKUs, stockout-day share: diff +0.0207, t-test p=3.01e-05, Wilcoxon p=0.0625
* A: platform growth, local LSTM - surge SKUs, lost-unit share: diff +0.0182, t-test p=4.03e-05, Wilcoxon p=0.0625
* A: platform growth, local LSTM - other SKUs, stockout-day share: diff +0.0000, t-test p=0.624, Wilcoxon p=0.812
* A: platform growth, local LSTM - other SKUs, lost-unit share: diff +0.0001, t-test p=0.148, Wilcoxon p=0.0625
* A': platform growth, round-3 node model - surge SKUs, stockout-day share: diff +0.0221, t-test p=1.67e-05, Wilcoxon p=0.0625
* A': platform growth, round-3 node model - surge SKUs, lost-unit share: diff +0.0192, t-test p=3.23e-05, Wilcoxon p=0.0625
* A': platform growth, round-3 node model - other SKUs, stockout-day share: diff +0.0000, t-test p=0.695, Wilcoxon p=1
* A': platform growth, round-3 node model - other SKUs, lost-unit share: diff +0.0001, t-test p=0.344, Wilcoxon p=0.312
* B: sales velocity (last7/prev28) - surge SKUs, stockout-day share: diff -0.0096, t-test p=2.03e-06, Wilcoxon p=0.0625
* B: sales velocity (last7/prev28) - surge SKUs, lost-unit share: diff -0.0069, t-test p=0.00017, Wilcoxon p=0.0625
* B: sales velocity (last7/prev28) - other SKUs, stockout-day share: diff -0.0003, t-test p=0.0995, Wilcoxon p=0.188
* B: sales velocity (last7/prev28) - other SKUs, lost-unit share: diff -0.0001, t-test p=0.137, Wilcoxon p=0.188
* oracle (true ramp) - surge SKUs, stockout-day share: diff -0.0101, t-test p=4.31e-06, Wilcoxon p=0.0625
* oracle (true ramp) - surge SKUs, lost-unit share: diff -0.0074, t-test p=0.00024, Wilcoxon p=0.0625
* oracle (true ramp) - other SKUs, stockout-day share: n/a
* oracle (true ramp) - other SKUs, lost-unit share: n/a

## Operating point: RDI threshold sweep (first crossing from day 160)

| Definition | threshold | surge SKUs detected | surge SKUs above threshold BEFORE the precursor | non-surge SKUs with a false alarm (from day 160) | non-surge SKU-days above threshold |
|---|---|---|---|---|---|
| A | 0.6 | 8.8 ± 8.4 % | 15.0 ± 13.0 % | 59.9 ± 4.3 % | 14.3 ± 2.6 % |
| A | 0.7 | 0.0 ± 0.0 % | 0.0 ± 0.0 % | 25.5 ± 4.6 % | 2.1 ± 0.8 % |
| A | 0.8 | 0.0 ± 0.0 % | 0.0 ± 0.0 % | 3.3 ± 2.0 % | 0.1 ± 0.1 % |
| A3 | 0.6 | 1.2 ± 2.8 % | 1.2 ± 2.8 % | 47.3 ± 2.1 % | 9.9 ± 3.6 % |
| A3 | 0.7 | 0.0 ± 0.0 % | 0.0 ± 0.0 % | 15.9 ± 6.0 % | 1.0 ± 0.5 % |
| A3 | 0.8 | 0.0 ± 0.0 % | 0.0 ± 0.0 % | 1.2 ± 2.1 % | 0.0 ± 0.0 % |
| B | 0.6 | 100.0 ± 0.0 % | 56.2 ± 11.7 % | 95.1 ± 0.8 % | 28.8 ± 2.4 % |
| B | 0.7 | 100.0 ± 0.0 % | 16.2 ± 9.5 % | 66.5 ± 2.9 % | 13.7 ± 2.7 % |
| B | 0.8 | 100.0 ± 0.0 % | 0.0 ± 0.0 % | 34.5 ± 6.9 % | 6.4 ± 2.0 % |

Hardware: {'cpu': '12th Gen Intel(R) Core(TM) i5-1235U', 'container_cpus': 12, 'torch_threads': 4, 'python': '3.11.18', 'torch': '2.4.1+cpu', 'xgboost': '2.1.1', 'numpy': '1.26.4'}
Run time: 5987 s (5 seeds).