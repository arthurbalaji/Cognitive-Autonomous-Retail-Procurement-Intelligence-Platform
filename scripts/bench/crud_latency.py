#!/usr/bin/env python3
"""Measures CARPIP core API latency under concurrent load (paper reports ~42 ms average CRUD on a 12th-gen i7 workstation).
  python scripts/bench/crud_latency.py [--n 600] [--c 20]
Writes docs/results/crud_latency.md. Laptop numbers are not comparable to the paper's hardware."""
import argparse
import concurrent.futures as cf
import os
import statistics
import time

import httpx

B = os.getenv("CARPIP_URL", "http://127.0.0.1:8080")
ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=600)
ap.add_argument("--c", type=int, default=20)
a = ap.parse_args()

tok = httpx.post(f"{B}/api/auth/login", json={"email": "retailer1@carpip.demo", "password": "Demo@12345"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}
prods = httpx.get(f"{B}/api/products?size=50", headers=H).json()["items"]
pid = prods[0]["id"]
import itertools
_rot = itertools.cycle(prods)     # PATCH a different product each time: concurrent writers to ONE row get 409 by design (optimistic locking)

CASES = {
    "READ  GET /api/products?size=20": lambda c: c.get(f"{B}/api/products?size=20", headers=H),
    "READ  GET /api/products/{id}": lambda c: c.get(f"{B}/api/products/{pid}", headers=H),
    "READ  GET /api/purchase-orders": lambda c: c.get(f"{B}/api/purchase-orders?limit=50", headers=H),
    "READ  GET /api/dashboard/summary": lambda c: c.get(f"{B}/api/dashboard/summary", headers=H),
    "WRITE PATCH /api/products/{id} (reorder point)": lambda c: (lambda p: c.patch(f"{B}/api/products/{p['id']}", json={"retailPrice": p["retail_price"]}, headers=H))(next(_rot)),
    "GRAPHQL stockStatus(first:20) [100 req: limit is 120/min/user]": lambda c: c.post(f"{B}/graphql", json={"query": "{ stockStatus(first:20){ sku currentStock reorderPoint mpi } }"}, headers=H),
}


def run(name, fn):
    lat = []
    errs = 0

    def one(_):
        with httpx.Client(timeout=30) as c:
            t = time.perf_counter()
            r = fn(c)
            return (time.perf_counter() - t) * 1000, r.status_code

    with cf.ThreadPoolExecutor(a.c) as ex:
        for ms, code in ex.map(one, range(a.n)):
            lat.append(ms)
            errs += code >= 400
    lat.sort()
    q = lambda p: lat[min(len(lat) - 1, int(len(lat) * p))]
    return name, statistics.fmean(lat), q(0.5), q(0.95), q(0.99), errs


rows = []
for n, f in CASES.items():
    full = a.n
    if n.startswith("GRAPHQL"):
        a.n = min(a.n, 100)
    rows.append(run(n, f))
    a.n = full
out = ["# CARPIP core API latency", "", f"{a.n} requests per case, {a.c} concurrent clients, new connection per request (worst case), laptop Docker.", "",
       "| Case | avg ms | p50 | p95 | p99 | errors |", "|---|---|---|---|---|---|"]
for n, avg, p50, p95, p99, e in rows:
    out.append(f"| {n} | {avg:.1f} | {p50:.1f} | {p95:.1f} | {p99:.1f} | {e} |")
text = "\n".join(out)
print(text)
os.makedirs("docs/results", exist_ok=True)
open("docs/results/crud_latency.md", "w").write(text + "\n")
