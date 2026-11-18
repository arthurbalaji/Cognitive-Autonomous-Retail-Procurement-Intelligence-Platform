# E7b - CDIN privacy/utility and early warning (5 seeds)

3 nodes = 3 stores, 120 SKUs each, models trained on days 0-119, tested on 17 daily origins (days 120-136, horizon 14). Mean ± std over seeds 0-4. Federated: 3 rounds x 3 local epochs, FedProx mu=0.01, FedAvg weighted by samples, share cap 0.6; LOCAL/CENTRAL use the platform's LSTM budget (12 epochs max, early stopping). All three are the same 64-32 LSTM; nothing but weights leaves a node in FEDERATED.

## Accuracy (LSTM only, no ensemble)

| Variant | pooled MAE | pooled RMSE | pooled WAPE % | store-1 MAE | store-2 MAE | store-3 MAE |
|---|---|---|---|---|---|---|
| LOCAL | 1.537 ± 0.070 | 2.313 ± 0.107 | 38.7 ± 1.0 | 1.571 ± 0.078 | 1.411 ± 0.055 | 1.630 ± 0.087 |
| FEDERATED | 1.605 ± 0.074 | 2.443 ± 0.111 | 40.4 ± 1.1 | 1.638 ± 0.077 | 1.457 ± 0.057 | 1.721 ± 0.096 |
| CENTRAL | 1.526 ± 0.065 | 2.287 ± 0.092 | 38.4 ± 1.2 | 1.554 ± 0.066 | 1.402 ± 0.053 | 1.620 ± 0.085 |
| MOVING_AVG_7 | 1.689 ± 0.083 | 2.551 ± 0.107 | 42.5 ± 1.1 | 1.722 ± 0.078 | 1.525 ± 0.066 | 1.821 ± 0.112 |

## Communication cost

LSTM state = 119.8 KiB (float32). Per round, 3 nodes: 359.4 KiB up + 359.4 KiB down = 718.8 KiB. 3 rounds: 2156.5 KiB total, versus sharing the raw panels (3 stores x 120 SKUs x 120 days) in CENTRAL.

## Early warning (RDI from stores 1+2 only, threshold 0.6)

Planted regional precursor: stores 1 and 2 ramp from day 136, store 3 only from day 148 (end of the window). Detection day = first daily forecast origin AFTER the precursor has started (day 137 onward) whose RDI exceeds the threshold; an alarm before day 137 is spurious by construction.

| Metric | mean ± std over seeds |
|---|---|
| Surge SKUs (RDI published) detected after the precursor starts | 26 % ± 17 % |
| Lead before store 3's surge (days) | 9.7 ± 0.9 |
| Delay after precursor starts (days) | 2.3 ± 0.9 |
| Surge SKUs already above threshold BEFORE the precursor (spurious) | 40.0 % ± 12.2 % |
| False positives: non-surge SKUs above threshold after day 137 | 49.6 % ± 11.4 % |
| False positives: non-surge SKUs above threshold anywhere in the window | 69.1 % ± 10.3 % |
| False positives: non-surge SKU-days above threshold | 20.2 % |
| Mean RDI before / after the precursor, surge SKUs | 0.468 / 0.400 |
| Mean RDI before / after the precursor, non-surge SKUs | 0.501 / 0.501 |
| RDI on the last day, surge / non-surge SKUs | 0.297 / 0.509 |

## Effect of the RDI forecast uplift on store 3 (partial horizon, truth ends day 149)

| Group | MAE without uplift | MAE with uplift |
|---|---|---|
| surge SKUs | 2.233 ± 0.158 | 2.273 ± 0.172 |
| other SKUs | 1.868 ± 0.073 | 1.897 ± 0.072 |

Store 3's own surge is only x1.1 / x1.2 on the last two days of the window, so the uplift cannot show a large accuracy gain inside the available truth; the signal is the early RDI itself.

Hardware: {'cpu': '12th Gen Intel(R) Core(TM) i5-1235U', 'container_cpus': 12, 'torch_threads': 4, 'python': '3.11.18', 'torch': '2.4.1+cpu', 'xgboost': '2.1.1', 'numpy': '1.26.4'}
Run time: 865.9 s
