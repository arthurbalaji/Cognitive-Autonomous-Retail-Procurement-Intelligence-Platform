# E1/E7a - Forecast accuracy (10 seeds, rolling origins)

Synthetic Dunnhumby-shaped data: 120 SKUs x 3 stores x 150 days per seed (deterministic generator, seeds 0-9). Models trained on days 0-119 only (chronological 80/20 split, train-only scaling, early stopping, platform hyper-parameters: LSTM 64-32, Transformer 2 layers/4 heads, XGBoost 120 trees; epochs 12/10 max). Evaluation: 17 daily forecast origins (days 120-136), horizon 14 days, 360 pooled series; every figure is mean ± std over seeds. SARIMA: SARIMAX(1,0,1)(1,0,1,7), trend=c, fixed parameters re-filtered at each origin, fitted on 360 series per seed (status {'ok': 360}). MAPE is computed only on days with actual demand > 0 (count data, so it is large; WAPE = sum|err| / sum(actual) is the more robust figure).

## Table 1.1 source - all models on the same series

| Model | MAE (units) | RMSE (units) | MAPE (%) | sMAPE (%) | WAPE (%) |
|---|---|---|---|---|---|
| SARIMA | 1.576 ± 0.061 | 2.350 ± 0.088 | 50.5 ± 1.4 | 76.1 ± 4.0 | 39.9 ± 1.1 |
| MOVING_AVG_7 | 1.674 ± 0.069 | 2.519 ± 0.104 | 53.8 ± 1.2 | 73.7 ± 3.6 | 42.4 ± 0.9 |
| SEASONAL_NAIVE | 2.015 ± 0.078 | 3.043 ± 0.116 | 67.4 ± 1.4 | 71.5 ± 2.5 | 51.0 ± 1.2 |
| LSTM | 1.519 ± 0.053 | 2.267 ± 0.077 | 48.2 ± 1.0 | 75.1 ± 4.2 | 38.4 ± 1.1 |
| TRANSFORMER | 1.509 ± 0.054 | 2.242 ± 0.079 | 48.3 ± 1.3 | 75.1 ± 4.1 | 38.2 ± 1.1 |
| XGBOOST | 1.520 ± 0.056 | 2.262 ± 0.080 | 48.5 ± 1.2 | 75.3 ± 4.1 | 38.5 ± 1.1 |
| ENSEMBLE | 1.508 ± 0.055 | 2.243 ± 0.080 | 48.1 ± 1.1 | 75.0 ± 4.1 | 38.2 ± 1.1 |

95 % bootstrap CI of the mean MAE: SARIMA [1.543, 1.615]; MOVING_AVG_7 [1.638, 1.718]; SEASONAL_NAIVE [1.973, 2.065]; LSTM [1.490, 1.552]; TRANSFORMER [1.480, 1.543]; XGBOOST [1.489, 1.554]; ENSEMBLE [1.478, 1.542]

Ensemble MAE reduction vs: SARIMA +4.3 %, MOVING_AVG_7 +9.9 %, SEASONAL_NAIVE +25.2 %, LSTM +0.7 %, TRANSFORMER +0.1 %, XGBOOST +0.8 %

## Perishable (FOOD_BEVERAGE) vs other categories (MAE / WAPE %)

| Model | perishable MAE | perishable WAPE | other MAE | other WAPE |
|---|---|---|---|---|
| SARIMA | 2.102 ± 0.117 | 34.7 ± 1.3 | 1.146 ± 0.079 | 51.7 ± 2.4 |
| MOVING_AVG_7 | 2.250 ± 0.135 | 37.1 ± 1.1 | 1.203 ± 0.091 | 54.3 ± 2.4 |
| SEASONAL_NAIVE | 2.689 ± 0.160 | 44.4 ± 1.5 | 1.464 ± 0.110 | 66.0 ± 2.7 |
| LSTM | 2.011 ± 0.103 | 33.2 ± 1.4 | 1.117 ± 0.075 | 50.4 ± 2.5 |
| TRANSFORMER | 1.995 ± 0.104 | 32.9 ± 1.3 | 1.111 ± 0.075 | 50.1 ± 2.4 |
| XGBOOST | 2.011 ± 0.108 | 33.2 ± 1.3 | 1.118 ± 0.076 | 50.4 ± 2.4 |
| ENSEMBLE | 1.993 ± 0.107 | 32.9 ± 1.3 | 1.111 ± 0.075 | 50.1 ± 2.4 |

## Rolling-origin MAE (mean over seeds)

| Origin day | SARIMA | MOVING_AVG_7 | SEASONAL_NAIVE | LSTM | TRANSFORMER | XGBOOST | ENSEMBLE |
|---|---|---|---|---|---|---|---|
| 120 | 1.551 | 1.652 | 1.996 | 1.498 | 1.486 | 1.496 | 1.485 |
| 124 | 1.558 | 1.653 | 1.999 | 1.500 | 1.492 | 1.501 | 1.490 |
| 128 | 1.570 | 1.663 | 2.002 | 1.512 | 1.502 | 1.513 | 1.501 |
| 132 | 1.589 | 1.686 | 2.030 | 1.533 | 1.523 | 1.530 | 1.521 |
| 136 | 1.625 | 1.720 | 2.054 | 1.563 | 1.553 | 1.566 | 1.552 |

## 80 % prediction band (residual quantiles of the ensemble)

Empirical coverage 80.0 ± 0.7 % (nominal 80 %); on days with demand > 0: 82.7 %; mean width 5.268 units.

## Diebold-Mariano style tests (best single member = TRANSFORMER)

Seed-level paired test: loss differential (Ensemble minus other) averaged over series, origins and horizon, one value per seed. Negative = ensemble better.

| Comparison | loss | mean diff | t | p (t-test) | p (Wilcoxon) | ensemble better in |
|---|---|---|---|---|---|---|
| ENSEMBLE_vs_SARIMA | squared | -0.4890 | -13.99 | 0.0000 | 0.0020 | 10/10 seeds |
| ENSEMBLE_vs_SARIMA | absolute | -0.0684 | -22.92 | 0.0000 | 0.0020 | 10/10 seeds |
| ENSEMBLE_vs_TRANSFORMER | squared | 0.0078 | 0.92 | 0.3816 | 0.3223 | 2/10 seeds |
| ENSEMBLE_vs_TRANSFORMER | absolute | -0.0011 | -0.80 | 0.4460 | 0.4922 | 6/10 seeds |
| ENSEMBLE_vs_MOVING_AVG_7 | squared | -1.3190 | -17.45 | 0.0000 | 0.0020 | 10/10 seeds |
| ENSEMBLE_vs_MOVING_AVG_7 | absolute | -0.1661 | -22.42 | 0.0000 | 0.0020 | 10/10 seeds |

Per-seed cross-sectional DM (one loss differential per series, t-test over 120x3 series) and the classic time-series DM with the Harvey correction (17 overlapping origins, h=14, so it is low-powered and often undefined) are in `forecast_eval.json` under `per_seed[*].dm`.

Hardware: {'cpu': '12th Gen Intel(R) Core(TM) i5-1235U', 'container_cpus': 12, 'torch_threads': 1, 'python': '3.11.18', 'torch': '2.4.1+cpu', 'xgboost': '2.1.1', 'numpy': '1.26.4'}
Run time: 10154.9 s
