# E2/E3/E6 - 30-day procurement simulation (synthetic data, rule-voice protocol)

10 seeds, 120 SKUs x 3 stores, 30 evaluation days, forecasts from the platform ensemble trained on days 0-119. Cells: mean ± std [95 % bootstrap CI] over seeds.
Holding rate 20% p.a., static-EOQ order cost INR 400, retailer target margin 25%. Hardware: {'cpu': '12th Gen Intel(R) Core(TM) i5-1235U', 'container_cpus': 12, 'torch_threads': 1, 'python': '3.11.18', 'torch': '2.4.1+cpu', 'xgboost': '2.1.1', 'numpy': '1.26.4'}

| Configuration | Stockout rate (% SKU-days with unmet demand) | Holding cost (INR per store-day) | Average purchase price (% of list) | Lost sales (% of demand units) | Expired units (% of received) | Negotiation success (%) |
|---|---|---|---|---|---|---|
| B1 static EOQ/ROP | 0.15 ± 0.05 [0.12, 0.18] | 1183.26 ± 58.72 [1150.72, 1220.36] | 95.19 ± 0.13 [95.11, 95.26] | 0.13 ± 0.08 [0.09, 0.17] | 1.71 ± 0.88 [1.20, 2.21] | n/a |
| B2 isolated ML | 0.61 ± 0.10 [0.55, 0.67] | 720.60 ± 42.06 [696.98, 746.58] | 97.06 ± 0.14 [96.98, 97.14] | 0.66 ± 0.12 [0.59, 0.72] | 0.01 ± 0.01 [0.00, 0.02] | n/a |
| CARPIP (full) | 0.21 ± 0.08 [0.16, 0.25] | 756.68 ± 39.75 [733.98, 781.51] | 84.47 ± 0.06 [84.43, 84.50] | 0.21 ± 0.11 [0.14, 0.27] | 0.00 ± 0.01 [0.00, 0.01] | 99.93 ± 0.12 [99.85, 99.99] |
| CARPIP w/o MPI | 0.19 ± 0.08 [0.15, 0.24] | 759.44 ± 39.01 [736.89, 783.54] | 84.61 ± 0.07 [84.57, 84.64] | 0.19 ± 0.12 [0.13, 0.26] | 0.00 ± 0.01 [0.00, 0.01] | 99.76 ± 0.24 [99.61, 99.89] |
| CARPIP w/o CDIN | 0.23 ± 0.07 [0.19, 0.27] | 754.48 ± 39.63 [731.55, 778.93] | 84.47 ± 0.06 [84.44, 84.50] | 0.25 ± 0.10 [0.18, 0.30] | 0.00 ± 0.01 [0.00, 0.01] | 99.92 ± 0.12 [99.85, 99.98] |
| CARPIP w/o negotiation | 0.19 ± 0.08 [0.15, 0.24] | 759.53 ± 39.02 [736.94, 783.61] | 96.98 ± 0.08 [96.93, 97.02] | 0.19 ± 0.12 [0.13, 0.26] | 0.00 ± 0.01 [0.00, 0.01] | n/a |
| CARPIP w/o ranking | 0.56 ± 0.09 [0.51, 0.60] | 729.08 ± 43.31 [704.16, 755.02] | 84.35 ± 0.11 [84.28, 84.41] | 0.57 ± 0.12 [0.50, 0.64] | 0.01 ± 0.02 [0.00, 0.02] | 99.93 ± 0.12 [99.85, 99.99] |
| CARPIP (forecast-ratio CDIN) | 0.23 ± 0.06 [0.20, 0.26] | 753.31 ± 39.52 [730.65, 777.60] | 84.49 ± 0.04 [84.46, 84.51] | 0.26 ± 0.10 [0.20, 0.31] | 0.00 ± 0.00 [0.00, 0.00] | 99.93 ± 0.12 [99.86, 99.99] |

## Main regime (generator default initial stock)

Paired tests, CARPIP (full) minus baseline. Plain rows pair the per-seed means (n = seeds); `_daily` rows pair the 30 daily values averaged over seeds. Holm-adjusted over all rows.

| Baseline | Metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z | n |
|---|---|---|---|---|---|---|---|---|
| B1 static EOQ/ROP | stockout | 0.057 | 2.39 | 0.04078 | 0.08156 | 0.03815 | 0.75 | 10 |
| B1 static EOQ/ROP | hold | -426.583 | -39.32 | 2.211e-11 | 2.211e-10 | 0.001953 | -12.44 | 10 |
| B1 static EOQ/ROP | price | -10.721 | -248.74 | 1.396e-18 | 1.536e-17 | 0.001953 | -78.66 | 10 |
| B1 static EOQ/ROP | lost | 0.078 | 1.64 | 0.1347 | 0.1347 | 0.08398 | 0.52 | 10 |
| B1 static EOQ/ROP | stockout_daily | 0.057 | 2.74 | 0.0103 | 0.03091 | 0.01295 | 0.50 | 30 |
| B1 static EOQ/ROP | hold_daily | -426.583 | -6.94 | 1.256e-07 | 8.793e-07 | 5.606e-06 | -1.27 | 30 |
| B2 isolated ML | stockout | -0.405 | -14.49 | 1.525e-07 | 9.152e-07 | 0.001953 | -4.58 | 10 |
| B2 isolated ML | hold | 36.080 | 16.99 | 3.804e-08 | 3.043e-07 | 0.001953 | 5.37 | 10 |
| B2 isolated ML | price | -12.592 | -423.26 | 1.168e-20 | 1.401e-19 | 0.001953 | -133.85 | 10 |
| B2 isolated ML | lost | -0.451 | -8.44 | 1.44e-05 | 5.759e-05 | 0.001953 | -2.67 | 10 |
| B2 isolated ML | stockout_daily | -0.406 | -5.64 | 4.344e-06 | 2.172e-05 | 2.702e-05 | -1.03 | 30 |
| B2 isolated ML | hold_daily | 36.080 | 8.84 | 9.912e-10 | 8.921e-09 | 5.606e-06 | 1.61 | 30 |

Safety counters over all CARPIP runs in this regime: price-bound violations = 0, guardrail interventions = 0

## Tight-start regime (initial stock x 0.4)

| Configuration | Stockout rate (% SKU-days with unmet demand) | Holding cost (INR per store-day) | Average purchase price (% of list) | Lost sales (% of demand units) | Expired units (% of received) | Negotiation success (%) |
|---|---|---|---|---|---|---|
| B1 static EOQ/ROP | 0.42 ± 0.15 [0.34, 0.51] | 1344.46 ± 63.05 [1306.86, 1383.36] | 95.22 ± 0.19 [95.11, 95.33] | 0.34 ± 0.20 [0.23, 0.46] | 2.98 ± 1.21 [2.34, 3.72] | n/a |
| B2 isolated ML | 1.06 ± 0.14 [0.98, 1.15] | 625.01 ± 19.20 [614.69, 636.70] | 97.10 ± 0.15 [97.01, 97.18] | 1.17 ± 0.25 [1.03, 1.32] | 0.01 ± 0.01 [0.01, 0.02] | n/a |
| CARPIP (full) | 0.40 ± 0.14 [0.32, 0.48] | 682.07 ± 20.18 [670.82, 694.04] | 84.47 ± 0.07 [84.43, 84.52] | 0.47 ± 0.28 [0.33, 0.65] | 0.02 ± 0.03 [0.01, 0.04] | 99.93 ± 0.13 [99.84, 99.98] |
| CARPIP w/o MPI | 0.39 ± 0.14 [0.31, 0.48] | 686.33 ± 18.39 [676.26, 697.27] | 84.61 ± 0.08 [84.56, 84.65] | 0.46 ± 0.28 [0.32, 0.65] | 0.02 ± 0.03 [0.01, 0.04] | 99.74 ± 0.28 [99.57, 99.89] |
| CARPIP w/o CDIN | 0.40 ± 0.10 [0.34, 0.46] | 676.86 ± 19.44 [666.09, 688.13] | 84.49 ± 0.05 [84.46, 84.52] | 0.47 ± 0.18 [0.37, 0.58] | 0.01 ± 0.01 [0.01, 0.02] | 99.93 ± 0.12 [99.85, 99.98] |
| CARPIP w/o negotiation | 0.39 ± 0.14 [0.31, 0.48] | 686.46 ± 18.23 [676.49, 697.29] | 96.98 ± 0.09 [96.92, 97.03] | 0.46 ± 0.28 [0.32, 0.65] | 0.02 ± 0.03 [0.01, 0.04] | n/a |
| CARPIP w/o ranking | 0.94 ± 0.12 [0.87, 1.00] | 638.31 ± 22.45 [625.88, 651.36] | 84.36 ± 0.10 [84.29, 84.41] | 0.99 ± 0.21 [0.88, 1.12] | 0.02 ± 0.03 [0.01, 0.04] | 99.93 ± 0.12 [99.85, 99.98] |
| CARPIP (forecast-ratio CDIN) | 0.40 ± 0.10 [0.34, 0.46] | 676.47 ± 19.42 [665.49, 687.81] | 84.50 ± 0.04 [84.47, 84.53] | 0.43 ± 0.18 [0.33, 0.54] | 0.01 ± 0.01 [0.00, 0.02] | 99.93 ± 0.12 [99.85, 99.98] |

Paired tests, CARPIP (full) minus baseline. Plain rows pair the per-seed means (n = seeds); `_daily` rows pair the 30 daily values averaged over seeds. Holm-adjusted over all rows.

| Baseline | Metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z | n |
|---|---|---|---|---|---|---|---|---|
| B1 static EOQ/ROP | stockout | -0.024 | -0.39 | 0.7062 | 1 | 1 | -0.12 | 10 |
| B1 static EOQ/ROP | hold | -662.384 | -31.26 | 1.723e-10 | 1.206e-09 | 0.001953 | -9.88 | 10 |
| B1 static EOQ/ROP | price | -10.747 | -190.83 | 1.516e-17 | 1.668e-16 | 0.001953 | -60.34 | 10 |
| B1 static EOQ/ROP | lost | 0.133 | 1.32 | 0.2203 | 0.6609 | 0.2324 | 0.42 | 10 |
| B1 static EOQ/ROP | stockout_daily | -0.024 | -0.45 | 0.6587 | 1 | 0.8199 | -0.08 | 30 |
| B1 static EOQ/ROP | hold_daily | -662.384 | -11.78 | 1.413e-12 | 1.271e-11 | 4.228e-06 | -2.15 | 30 |
| B2 isolated ML | stockout | -0.666 | -12.26 | 6.43e-07 | 3.215e-06 | 0.001953 | -3.88 | 10 |
| B2 isolated ML | hold | 57.069 | 15.04 | 1.1e-07 | 6.599e-07 | 0.001953 | 4.76 | 10 |
| B2 isolated ML | price | -12.622 | -390.43 | 2.415e-20 | 2.898e-19 | 0.001953 | -123.47 | 10 |
| B2 isolated ML | lost | -0.696 | -7.88 | 2.488e-05 | 9.953e-05 | 0.001953 | -2.49 | 10 |
| B2 isolated ML | stockout_daily | -0.669 | -13.25 | 7.836e-14 | 7.836e-13 | 3.79e-06 | -2.42 | 30 |
| B2 isolated ML | hold_daily | 57.069 | 10.57 | 1.859e-11 | 1.487e-10 | 3.79e-06 | 1.93 | 30 |

Safety counters over all CARPIP runs in this regime: price-bound violations = 0, guardrail interventions = 0

## Sensitivity (seeds 0,1; CARPIP full vs B1 unless noted)

| Scenario | Config | Stockout rate (% SKU-days with unmet demand) | Holding cost (INR per store-day) | Average purchase price (% of list) | Lost sales (% of demand units) | bound violations |
|---|---|---|---|---|---|---|
| ontime=0.95 | CARPIP | 0.17 | 715.55 | 84.38 | 0.18 | 0 |
| ontime=0.95 | B1 | 0.10 | 1138.55 | 95.28 | 0.07 | 0 |
| ontime=0.85 | CARPIP | 0.24 | 708.52 | 84.41 | 0.30 | 0 |
| ontime=0.85 | B1 | 0.13 | 1127.98 | 95.28 | 0.08 | 0 |
| ontime=0.7 | CARPIP | 0.40 | 699.10 | 84.45 | 0.48 | 0 |
| ontime=0.7 | B1 | 0.20 | 1109.34 | 95.28 | 0.15 | 0 |
| w1-20% | CARPIP | 0.20 | 717.52 | 84.42 | 0.27 | 0 |
| w1+20% | CARPIP | 0.20 | 717.86 | 84.44 | 0.27 | 0 |
| w2-20% | CARPIP | 0.20 | 718.00 | 84.44 | 0.27 | 0 |
| w2+20% | CARPIP | 0.20 | 717.52 | 84.42 | 0.27 | 0 |
| w3-20% | CARPIP | 0.20 | 718.06 | 84.44 | 0.27 | 0 |
| w3+20% | CARPIP | 0.20 | 717.44 | 84.42 | 0.27 | 0 |
| w4-20% | CARPIP | 0.20 | 717.52 | 84.42 | 0.27 | 0 |
| w4+20% | CARPIP | 0.20 | 718.03 | 84.44 | 0.27 | 0 |
| w5-20% | CARPIP | 0.20 | 717.52 | 84.43 | 0.27 | 0 |
| w5+20% | CARPIP | 0.20 | 717.63 | 84.43 | 0.27 | 0 |
| flex=0.0 | CARPIP | 0.20 | 717.58 | 84.43 | 0.27 | 0 |
| flex=0.01 | CARPIP | 0.18 | 717.71 | 84.29 | 0.20 | 0 |
| flex=0.03 | CARPIP | 0.23 | 712.80 | 83.79 | 0.24 | 0 |
| vol=0.25 | CARPIP | 0.24 | 724.64 | 84.49 | 0.28 | 0 |
| vol=0.25 | B1 | 0.07 | 1149.95 | 95.27 | 0.04 | 0 |
| vol=0.5 | CARPIP | 0.38 | 752.03 | 84.40 | 0.53 | 0 |
| vol=0.5 | B1 | 0.33 | 1180.84 | 95.24 | 0.30 | 0 |

_Total runtime 425s._