"""Neural forecasting models (CPU PyTorch). Paper hyper-parameters:
LSTM 64->32 + Dropout(0.2) + Dense, Adam lr 1e-3, batch 64;  Transformer 4 heads, d_model 64, ff 128, dropout 0.1, cosine annealing.
Both map a 30-day window of [scaled units, sin(dow), cos(dow)] to the next H days (scaled)."""
from __future__ import annotations

import copy
import math

import numpy as np
import torch
import torch.nn as nn

N_FEATURES = 3


class LSTMForecaster(nn.Module):
    def __init__(self, n_features: int = N_FEATURES, horizon: int = 14):
        super().__init__()
        self.l1 = nn.LSTM(n_features, 64, batch_first=True)
        self.l2 = nn.LSTM(64, 32, batch_first=True)
        self.drop = nn.Dropout(0.2)
        self.out = nn.Linear(32, horizon)

    def forward(self, x):
        h, _ = self.l1(x)
        h, _ = self.l2(h)
        return self.out(self.drop(h[:, -1]))


class TransformerForecaster(nn.Module):
    def __init__(self, n_features: int = N_FEATURES, window: int = 30, horizon: int = 14, d_model: int = 64, heads: int = 4,
                 ff: int = 128, dropout: float = 0.1, layers: int = 2):
        super().__init__()
        self.inp = nn.Linear(n_features, d_model)
        self.pos = nn.Parameter(torch.zeros(1, window, d_model))
        layer = nn.TransformerEncoderLayer(d_model, heads, ff, dropout, batch_first=True)
        self.enc = nn.TransformerEncoder(layer, layers)
        self.out = nn.Linear(d_model, horizon)

    def forward(self, x):
        h = self.enc(self.inp(x) + self.pos)
        return self.out(h[:, -1])


def arch_hash(kind: str, horizon: int, window: int) -> str:
    return f"{kind}:h{horizon}:w{window}:f{N_FEATURES}"


def make(kind: str, horizon: int, window: int) -> nn.Module:
    if kind == "LSTM":
        return LSTMForecaster(N_FEATURES, horizon)
    if kind == "TRANSFORMER":
        return TransformerForecaster(N_FEATURES, window, horizon)
    raise ValueError(kind)


def fit(model: nn.Module, x_tr: np.ndarray, y_tr: np.ndarray, x_va: np.ndarray, y_va: np.ndarray, epochs: int, batch: int = 128,
        lr: float = 1e-3, cosine: bool = False, patience: int = 4, prox_ref: dict | None = None, prox_mu: float = 0.0, seed: int = 42) -> dict:
    """Mini-batch Adam training with early stopping on the chronological validation split.
    prox_ref/prox_mu implement the FedProx proximal term used by CDIN nodes (0 for ordinary training)."""
    torch.manual_seed(seed)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(epochs, 1)) if cosine else None
    xt, yt = torch.from_numpy(x_tr).float(), torch.from_numpy(y_tr).float()
    xv, yv = torch.from_numpy(x_va).float(), torch.from_numpy(y_va).float()
    best, best_state, bad = math.inf, None, 0
    hist = []
    ref = {k: v.detach().clone() for k, v in prox_ref.items()} if prox_ref else None
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(xt))
        tot = 0.0
        for i in range(0, len(xt), batch):
            idx = perm[i:i + batch]
            opt.zero_grad()
            loss = nn.functional.mse_loss(model(xt[idx]), yt[idx])
            if ref is not None and prox_mu > 0:
                loss = loss + (prox_mu / 2.0) * sum(((p - ref[n]) ** 2).sum() for n, p in model.named_parameters() if n in ref)
            if not torch.isfinite(loss):
                return {"ok": False, "reason": "non-finite loss", "history": hist}
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += float(loss) * len(idx)
        if sched:
            sched.step()
        model.eval()
        with torch.no_grad():
            vl = float(nn.functional.mse_loss(model(xv), yv)) if len(xv) else float("nan")
        hist.append((tot / max(len(xt), 1), vl))
        if len(xv) and vl < best - 1e-6:
            best, best_state, bad = vl, copy.deepcopy(model.state_dict()), 0
        else:
            bad += 1
            if len(xv) and bad >= patience:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    return {"ok": True, "val_loss": best if best != math.inf else None, "epochs": len(hist), "history": hist}


def predict(model: nn.Module, x: np.ndarray, batch: int = 1024) -> np.ndarray:
    model.eval()
    outs = []
    with torch.no_grad():
        for i in range(0, len(x), batch):
            outs.append(model(torch.from_numpy(x[i:i + batch]).float()).numpy())
    return np.concatenate(outs) if outs else np.zeros((0, 0), dtype=np.float32)
