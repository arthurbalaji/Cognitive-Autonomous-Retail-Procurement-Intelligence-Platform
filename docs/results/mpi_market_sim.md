# E2b - MPI under a hidden market-dependent wholesaler minimum (assumed model; see script docstring)

10 seeds, same 120 SKUs x 3 stores and 30-day window as the main simulation (forecasts from the cached ensemble); CDIN off. Cells: mean ± std over seeds. `mpi` = floor from the live MPI; `static` = MPI fixed at 0.5 (w/o MPI); `oracle` = floor equals the wholesaler's hidden minimum.

## normal supply, calm prices  (supplier stock catalog, price-shock sigma 0.005)

| mode | Stockout rate (%) | Lost sales (%) | Price (% of list) | Overpay above hidden minimum (% of list) | Wholesaler declines (% of order attempts) | Holding cost (INR/store-day) | corr(MPI, M_true) | MAE of floor index |
|---|---|---|---|---|---|---|---|---|
| mpi | 0.25 ± 0.06 | 0.26 ± 0.07 | 84.48 ± 0.06 | 3.20 ± 0.08 | 0.00 ± 0.00 | 753.82 ± 40.69 | -0.09 | 0.115 |
| static | 0.24 ± 0.05 | 0.25 ± 0.06 | 84.63 ± 0.06 | 3.25 ± 0.12 | 0.00 ± 0.00 | 756.26 ± 40.10 | -0.10 | 0.238 |
| oracle | 0.26 ± 0.06 | 0.27 ± 0.07 | 84.06 ± 0.28 | 2.91 ± 0.21 | 0.00 ± 0.00 | 750.80 ± 41.24 | -0.09 | 0.000 |

Correlation with the hidden pressure M_true of each MPI input (mean over seeds): DP 0.24, 1-SA -0.14, PV -0.02, SI -0.18, CS 0.16.

Headroom: static-to-oracle price gap 0.57 points; the MPI captures 0.15 of it.

Paired differences, mpi minus static (per-seed means; paired t / Wilcoxon, Holm over the metrics of this scenario):

| metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z |
|---|---|---|---|---|---|---|
| Stockout rate (%) | 0.013 | 2.36 | 0.0429 | 0.129 | 0.0277 | 0.74 |
| Lost sales (%) | 0.013 | 2.04 | 0.0714 | 0.143 | 0.0277 | 0.65 |
| Price (% of list) | -0.151 | -25.92 | 9.13e-10 | 5.48e-09 | 0.00195 | -8.20 |
| Overpay above hidden minimum (% of list) | -0.055 | -2.97 | 0.0157 | 0.0627 | 0.00586 | -0.94 |
| Wholesaler declines (% of order attempts) | 0.000 | nan | nan | 1 | nan | nan |
| Holding cost (INR/store-day) | -2.443 | -4.37 | 0.0018 | 0.00899 | 0.00195 | -1.38 |

## tight supply  (supplier stock 4 x MOQ, price-shock sigma 0.005)

| mode | Stockout rate (%) | Lost sales (%) | Price (% of list) | Overpay above hidden minimum (% of list) | Wholesaler declines (% of order attempts) | Holding cost (INR/store-day) | corr(MPI, M_true) | MAE of floor index |
|---|---|---|---|---|---|---|---|---|
| mpi | 6.37 ± 0.62 | 11.19 ± 1.47 | 86.56 ± 0.05 | 3.23 ± 0.12 | 0.26 ± 0.35 | 574.14 ± 36.67 | 0.16 | 0.109 |
| static | 6.36 ± 0.61 | 11.18 ± 1.47 | 86.67 ± 0.05 | 3.33 ± 0.11 | 0.20 ± 0.31 | 574.43 ± 36.35 | 0.16 | 0.181 |
| oracle | 6.37 ± 0.62 | 11.18 ± 1.47 | 86.18 ± 0.18 | 2.88 ± 0.08 | 0.00 ± 0.00 | 574.13 ± 36.65 | 0.16 | 0.000 |

Correlation with the hidden pressure M_true of each MPI input (mean over seeds): DP 0.24, 1-SA 0.10, PV 0.02, SI -0.15, CS 0.09.

Headroom: static-to-oracle price gap 0.49 points; the MPI captures 0.11 of it.

Paired differences, mpi minus static (per-seed means; paired t / Wilcoxon, Holm over the metrics of this scenario):

| metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z |
|---|---|---|---|---|---|---|
| Stockout rate (%) | 0.012 | 1.69 | 0.126 | 0.325 | 0.138 | 0.53 |
| Lost sales (%) | 0.011 | 1.90 | 0.0892 | 0.325 | 0.0796 | 0.60 |
| Price (% of list) | -0.111 | -35.94 | 4.95e-11 | 2.97e-10 | 0.00195 | -11.36 |
| Overpay above hidden minimum (% of list) | -0.099 | -16.07 | 6.18e-08 | 3.09e-07 | 0.00195 | -5.08 |
| Wholesaler declines (% of order attempts) | 0.055 | 1.96 | 0.0813 | 0.325 | 0.109 | 0.62 |
| Holding cost (INR/store-day) | -0.287 | -1.74 | 0.116 | 0.325 | 0.232 | -0.55 |

## volatile prices  (supplier stock catalog, price-shock sigma 0.03)

| mode | Stockout rate (%) | Lost sales (%) | Price (% of list) | Overpay above hidden minimum (% of list) | Wholesaler declines (% of order attempts) | Holding cost (INR/store-day) | corr(MPI, M_true) | MAE of floor index |
|---|---|---|---|---|---|---|---|---|
| mpi | 0.25 ± 0.06 | 0.26 ± 0.07 | 84.50 ± 0.06 | 3.06 ± 0.43 | 0.17 ± 0.31 | 754.56 ± 40.62 | -0.00 | 0.142 |
| static | 0.24 ± 0.05 | 0.25 ± 0.06 | 84.63 ± 0.05 | 3.12 ± 0.41 | 0.14 ± 0.28 | 756.43 ± 40.21 | -0.00 | 0.223 |
| oracle | 0.28 ± 0.07 | 0.29 ± 0.07 | 83.67 ± 0.79 | 2.45 ± 0.23 | 0.00 ± 0.00 | 750.77 ± 41.38 | 0.00 | 0.000 |

Correlation with the hidden pressure M_true of each MPI input (mean over seeds): DP 0.10, 1-SA -0.07, PV -0.04, SI -0.06, CS 0.53.

Headroom: static-to-oracle price gap 0.96 points; the MPI captures 0.13 of it.

Paired differences, mpi minus static (per-seed means; paired t / Wilcoxon, Holm over the metrics of this scenario):

| metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z |
|---|---|---|---|---|---|---|
| Stockout rate (%) | 0.011 | 2.19 | 0.056 | 0.168 | 0.0277 | 0.69 |
| Lost sales (%) | 0.012 | 2.04 | 0.0722 | 0.168 | 0.0277 | 0.64 |
| Price (% of list) | -0.132 | -17.49 | 2.95e-08 | 1.77e-07 | 0.00195 | -5.53 |
| Overpay above hidden minimum (% of list) | -0.065 | -3.78 | 0.00434 | 0.0174 | 0.00391 | -1.20 |
| Wholesaler declines (% of order attempts) | 0.035 | 1.50 | 0.168 | 0.168 | 0.18 | 0.47 |
| Holding cost (INR/store-day) | -1.871 | -4.70 | 0.00112 | 0.00561 | 0.00195 | -1.49 |

## tight supply + volatile prices  (supplier stock 4 x MOQ, price-shock sigma 0.03)

| mode | Stockout rate (%) | Lost sales (%) | Price (% of list) | Overpay above hidden minimum (% of list) | Wholesaler declines (% of order attempts) | Holding cost (INR/store-day) | corr(MPI, M_true) | MAE of floor index |
|---|---|---|---|---|---|---|---|---|
| mpi | 6.44 ± 0.65 | 11.26 ± 1.47 | 86.58 ± 0.06 | 3.14 ± 0.64 | 1.97 ± 2.13 | 573.82 ± 36.60 | 0.09 | 0.147 |
| static | 6.42 ± 0.63 | 11.24 ± 1.46 | 86.67 ± 0.06 | 3.22 ± 0.62 | 1.76 ± 1.92 | 574.06 ± 36.31 | 0.09 | 0.185 |
| oracle | 6.39 ± 0.63 | 11.20 ± 1.47 | 85.87 ± 0.74 | 2.46 ± 0.21 | 0.00 ± 0.00 | 573.95 ± 36.68 | 0.09 | 0.000 |

Correlation with the hidden pressure M_true of each MPI input (mean over seeds): DP 0.12, 1-SA 0.06, PV -0.05, SI -0.08, CS 0.44.

Headroom: static-to-oracle price gap 0.80 points; the MPI captures 0.09 of it.

Paired differences, mpi minus static (per-seed means; paired t / Wilcoxon, Holm over the metrics of this scenario):

| metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z |
|---|---|---|---|---|---|---|
| Stockout rate (%) | 0.021 | 2.51 | 0.0335 | 0.1 | 0.0506 | 0.79 |
| Lost sales (%) | 0.018 | 2.81 | 0.0204 | 0.0817 | 0.0284 | 0.89 |
| Price (% of list) | -0.087 | -15.19 | 1.01e-07 | 6.06e-07 | 0.00195 | -4.80 |
| Overpay above hidden minimum (% of list) | -0.079 | -9.29 | 6.57e-06 | 3.29e-05 | 0.00195 | -2.94 |
| Wholesaler declines (% of order attempts) | 0.214 | 1.52 | 0.162 | 0.324 | 0.128 | 0.48 |
| Holding cost (INR/store-day) | -0.241 | -1.52 | 0.162 | 0.324 | 0.275 | -0.48 |

## tight + volatile, wider hidden range  (supplier stock 4 x MOQ, price-shock sigma 0.03)

| mode | Stockout rate (%) | Lost sales (%) | Price (% of list) | Overpay above hidden minimum (% of list) | Wholesaler declines (% of order attempts) | Holding cost (INR/store-day) | corr(MPI, M_true) | MAE of floor index |
|---|---|---|---|---|---|---|---|---|
| mpi | 15.50 ± 6.38 | 21.14 ± 5.95 | 86.54 ± 0.06 | 1.86 ± 0.85 | 79.89 ± 25.11 | 535.06 ± 36.76 | 0.30 | 0.157 |
| static | 15.32 ± 6.30 | 20.99 ± 5.87 | 86.61 ± 0.07 | 1.92 ± 0.85 | 79.65 ± 25.10 | 535.77 ± 36.45 | 0.30 | 0.169 |
| oracle | 6.69 ± 0.78 | 11.49 ± 1.58 | 87.29 ± 1.12 | 1.18 ± 0.54 | 0.00 ± 0.00 | 573.43 ± 36.48 | 0.17 | 0.000 |

Correlation with the hidden pressure M_true of each MPI input (mean over seeds): DP 0.40, 1-SA -0.03, PV -0.04, SI -0.13, CS 0.25.

Headroom: static-to-oracle price gap -0.69 points; the MPI captures 0.07 of it.

Paired differences, mpi minus static (per-seed means; paired t / Wilcoxon, Holm over the metrics of this scenario):

| metric | mean diff | t | p (t) | p (Holm) | p (Wilcoxon) | Cohen d_z |
|---|---|---|---|---|---|---|
| Stockout rate (%) | 0.171 | 2.98 | 0.0155 | 0.0465 | 0.0209 | 0.94 |
| Lost sales (%) | 0.150 | 3.86 | 0.00383 | 0.0153 | 0.0109 | 1.22 |
| Price (% of list) | -0.067 | -8.60 | 1.24e-05 | 7.43e-05 | 0.00195 | -2.72 |
| Overpay above hidden minimum (% of list) | -0.062 | -6.76 | 8.25e-05 | 0.000413 | 0.00195 | -2.14 |
| Wholesaler declines (% of order attempts) | 0.248 | 2.36 | 0.0424 | 0.0848 | 0.0195 | 0.75 |
| Holding cost (INR/store-day) | -0.717 | -1.44 | 0.184 | 0.184 | 0.131 | -0.46 |

_Runtime 535s._