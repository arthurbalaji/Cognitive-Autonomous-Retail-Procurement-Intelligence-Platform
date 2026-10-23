"""Run with:  python -m cdin_node     (env: NODE_NAME, CREDS_FILE, INTELLIGENCE_URL, CARPIP_BACKEND_URL)

Loop: heartbeat/poll the coordinator -> for a new round download the global LSTM -> fetch THIS tenant's daily sales from the
CARPIP API (never leaves the node) -> train locally with a FedProx proximal term -> upload weights, sample count and coarse
per-GTIN growth ratios.  Raw sales and tenant identity beyond the API key are never transmitted.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import threading
import time
from datetime import date, timedelta

import numpy as np
import requests
import torch
from safetensors.torch import load as st_load
from safetensors.torch import save as st_save

from app.config import settings
from app.forecasting import data as D
from app.forecasting import models as M

NAME = os.getenv("NODE_NAME", "cdin-node")
CREDS = os.getenv("CREDS_FILE", "/creds/cdin-node.json")
INTEL = os.getenv("INTELLIGENCE_URL", "http://carpip-intelligence:5000").rstrip("/")
BACKEND = os.getenv("CARPIP_BACKEND_URL", "http://carpip-backend:8080").rstrip("/")
POLL_S = float(os.getenv("POLL_S", "5"))

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format=f"%(asctime)s %(levelname)s [{NAME}] %(message)s")
log = logging.getLogger("cdin-node")


def wait_for_key() -> str:
    while True:
        if os.path.exists(CREDS):
            try:
                with open(CREDS, "r", encoding="utf-8") as f:
                    return json.load(f)["apiKey"]
            except Exception as e:  # noqa: BLE001
                log.warning("credentials unreadable (%s); retrying", e)
        else:
            log.info("waiting for credentials file %s (written by the bootstrap job)", CREDS)
        time.sleep(5)


class Node:
    def __init__(self, key: str):
        self.key = key
        self.h = {"Authorization": f"Bearer {key}"}
        self.last_done: str | None = None
        self.training = threading.Event()
        self.state: dict = {}

    def poll(self) -> dict | None:
        r = requests.get(f"{INTEL}/api/cdin/rounds/current", headers=self.h, timeout=10)
        if r.status_code == 401:
            log.error("coordinator rejected our API key (revoked or wrong scope)")
            return None
        r.raise_for_status()
        return r.json()

    # ------------------------------------------------------------------ local data
    def local_panel(self) -> tuple[np.ndarray, list[str], date, date] | None:
        r = requests.get(f"{BACKEND}/api/v1/cdin/training-data?days=400", headers=self.h, timeout=60)
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return None
        gtins = sorted({x["gtin"] for x in rows})
        days = [date.fromisoformat(x["day"]) for x in rows]
        start, end = min(days), max(days)
        end = min(end, date.today() - timedelta(days=1))
        n = (end - start).days + 1
        idx = {g: i for i, g in enumerate(gtins)}
        units = np.zeros((len(gtins), n), dtype=np.float32)
        for x in rows:
            d = (date.fromisoformat(x["day"]) - start).days
            if 0 <= d < n:
                units[idx[x["gtin"]], d] = max(float(x["units"]), 0.0)
        return units, gtins, start, end

    # ------------------------------------------------------------------ one round
    def do_round(self, rnd: dict) -> None:
        torch.set_num_threads(settings.TORCH_THREADS)
        W, H = rnd["window"], rnd["horizon"]
        base = rnd["baseVersion"]
        mr = requests.get(f"{INTEL}/api/cdin/models/{base}", headers=self.h, timeout=60)
        mr.raise_for_status()
        if hashlib.sha256(mr.content).hexdigest() != mr.headers.get("X-Sha256"):
            raise RuntimeError("global model checksum mismatch")
        glob = st_load(mr.content)
        model = M.make("LSTM", H, W)
        model.load_state_dict(glob)
        if rnd.get("archHash") != M.arch_hash("LSTM", H, W):
            raise RuntimeError("architecture mismatch with coordinator")

        panel = self.local_panel()
        if panel is None:
            log.warning("no local data yet; skipping round")
            return
        units, gtins, start, end = panel
        n_days = units.shape[1]
        if n_days < W + H + 25:
            log.warning("only %d days of local history; skipping", n_days)
            return
        split = int(n_days * 0.8)
        dow = D.dow_features(start, n_days)
        scales = D.fit_scales(units, split)                   # local scaler, never shared
        active = units[:, :split].sum(axis=1) > 0
        xtr, ytr, _ = D.make_windows(units, scales, dow, W, H, 0, split, active)
        xva, yva, _ = D.make_windows(units, scales, dow, W, H, split, n_days, active)
        if len(xtr) < 100:
            log.warning("too few local windows (%d); skipping", len(xtr))
            return
        t0 = time.time()
        res = M.fit(model, xtr, ytr, xva, yva, rnd["epochs"], prox_ref=dict(glob), prox_mu=rnd["mu"], patience=99, seed=settings.SEED + hash(NAME) % 1000)
        if not res.get("ok"):
            log.error("local training failed: %s", res.get("reason"))
            return
        # coarse regional-signal: predicted next-14-day mean vs the last 14 actual days, bucketed to 0.05 (no raw values leave)
        x_inf = D.last_window(units, scales, D.dow_features(start, n_days), W)
        pred = M.predict(model, x_inf) * scales[:, None]
        growth = {}
        for i, g in enumerate(gtins):
            recent = float(units[i, -14:].mean())
            if recent >= 0.5:
                ratio = float(np.clip(pred[i, :14].mean() / recent, 0.5, 2.0))
                growth[g] = round(round(ratio / 0.05) * 0.05, 2)
        state = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
        blob = st_save(state)
        meta = {"baseVersion": base, "numSamples": int(len(xtr)), "valLoss": res.get("val_loss"), "growth": growth,
                "sha256": hashlib.sha256(blob).hexdigest()}
        up = requests.post(f"{INTEL}/api/cdin/rounds/{rnd['id']}/updates", headers=self.h, timeout=120,
                           files={"weights": ("weights.safetensors", blob, "application/octet-stream")}, data={"meta": json.dumps(meta)})
        log.info("round %s: trained %.0fs on %d windows (val %.5f) -> upload HTTP %s %s", rnd["roundNo"], time.time() - t0, len(xtr),
                 res.get("val_loss") or float("nan"), up.status_code, up.text[:120])
        if up.status_code in (200, 409):
            self.last_done = rnd["id"]

    def train_async(self, rnd: dict) -> None:
        def run():
            try:
                self.do_round(rnd)
                self.last_done = rnd["id"]    # never loop on a permanent skip condition; the next round retries
            except Exception as e:  # noqa: BLE001
                log.exception("round failed: %s", e)
                self.last_done = rnd["id"]
            finally:
                self.training.clear()
        self.training.set()
        threading.Thread(target=run, daemon=True, name="train").start()

    def loop(self) -> None:
        while True:
            try:
                s = self.poll()
                if s is not None:
                    rnd = s.get("round")
                    if s.get("paused"):
                        log.info("node is offline (demo scenario); not participating")
                    elif rnd and rnd["id"] != self.last_done and not s.get("alreadySubmitted") and not self.training.is_set():
                        log.info("new round %s (base v%s)", rnd["roundNo"], rnd["baseVersion"])
                        self.train_async(rnd)
                    elif s.get("alreadySubmitted") and rnd:
                        self.last_done = rnd["id"]
            except requests.RequestException as e:
                log.warning("coordinator unreachable: %s", e)
            except Exception as e:  # noqa: BLE001
                log.exception("poll loop error: %s", e)
            time.sleep(POLL_S)


if __name__ == "__main__":
    log.info("starting; coordinator=%s backend=%s", INTEL, BACKEND)
    Node(wait_for_key()).loop()
