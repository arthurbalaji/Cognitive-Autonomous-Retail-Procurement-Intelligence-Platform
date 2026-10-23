#!/usr/bin/env python3
"""CARPIP demo bootstrap: provisions the POS, the ERP and CARPIP, wires every integration path, seeds history, trains models
and runs the federated (CDIN) rounds.  Idempotent: safe to re-run (`docker compose run --rm bootstrap`).

Integration paths created:
  Path A  R1, R2  Shopify-style POS  <-> CARPIP ShopifyAdapter          (webhooks + polling)
          WA      Zoho-style ERP     <-> CARPIP ZohoAdapter              (OAuth refresh-token + polling)
  Path B  R3      legacy POS         <-> CARPIP open REST + signed callbacks (fieldMap)
          WB, WC  custom ERPs        <-> CARPIP /api/erp/sync + signed webhooks + GraphQL
"""
from __future__ import annotations

import json
import os
import random
import secrets
import sys
import time
from datetime import date, timedelta

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datagen import generate as G  # noqa: E402

CARPIP = os.getenv("CARPIP_URL", "http://carpip-backend:8080").rstrip("/")
POS = os.getenv("POS_URL", "http://pos-backend:4000").rstrip("/")
ERP = os.getenv("ERP_URL", "http://erp-backend:8000").rstrip("/")
INTEL = os.getenv("INTELLIGENCE_URL", "http://carpip-intelligence:5000").rstrip("/")
ADMIN_EMAIL = os.getenv("CARPIP_ADMIN_EMAIL", "admin@carpip.local")
ADMIN_PASSWORD = os.environ["CARPIP_ADMIN_PASSWORD"]
POS_TOKEN = os.environ["POS_ADMIN_TOKEN"]
ERP_TOKEN = os.environ["ERP_ADMIN_TOKEN"]
INTERNAL = os.environ["INTERNAL_SERVICE_TOKEN"]
SEED = int(os.getenv("SEED", "42"))
SKUS = int(os.getenv("SKU_COUNT", "120"))
HISTORY = int(os.getenv("HISTORY_DAYS", "120"))
OUT = os.getenv("OUT_DIR", "/out")
DEMO_PW = "Demo@12345"
CDIN_ROUNDS = int(os.getenv("CDIN_BOOT_ROUNDS", "3"))
SKIP_ML = os.getenv("SKIP_ML", "false").lower() == "true"

RETAILERS = [
    dict(code="R1", name="Kovai Mart - Gandhipuram", handle="store-1", mode="SHOPIFY", city="Coimbatore", email="retailer1@carpip.demo", pin="1111"),
    dict(code="R2", name="Kovai Mart - RS Puram", handle="store-2", mode="SHOPIFY", city="Coimbatore", email="retailer2@carpip.demo", pin="2222"),
    dict(code="R3", name="Erode Fresh Mart", handle="store-3", mode="LEGACY", city="Erode", email="retailer3@carpip.demo", pin="3333"),
]
WHOLESALERS = [
    dict(code="WA", email="wholesaler-a@carpip.demo", erp_email="a@erp.demo"),
    dict(code="WB", email="wholesaler-b@carpip.demo", erp_email="b@erp.demo"),
    dict(code="WC", email="wholesaler-c@carpip.demo", erp_email="c@erp.demo"),
]
T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.0f}s] {msg}", flush=True)


class Api:
    def __init__(self, base: str, headers: dict | None = None, timeout: float = 120):
        self.base, self.headers, self.client = base, headers or {}, httpx.Client(timeout=timeout)

    def call(self, method: str, path: str, ok=(200, 201, 202), **kw):
        h = {**self.headers, **kw.pop("headers", {})}
        r = self.client.request(method, self.base + path, headers=h, **kw)
        if r.status_code not in ok:
            raise RuntimeError(f"{method} {self.base}{path} -> HTTP {r.status_code}: {r.text[:400]}")
        return r.json() if r.content and "json" in r.headers.get("content-type", "") else r.text

    def get(self, p, **kw):
        return self.call("GET", p, **kw)

    def post(self, p, body=None, **kw):
        return self.call("POST", p, json=body if body is not None else {}, **kw)

    def put(self, p, body=None, **kw):
        return self.call("PUT", p, json=body, **kw)


def wait_for(name: str, url: str, tries: int = 150) -> None:
    for i in range(tries):
        try:
            if httpx.get(url, timeout=5).status_code < 500:
                log(f"{name} is up")
                return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(3)
    raise SystemExit(f"{name} did not become ready ({url})")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    state_path = os.path.join(OUT, "state.json")
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}

    log("waiting for services")
    wait_for("CARPIP backend", f"{CARPIP}/actuator/health/readiness")
    wait_for("POS", f"{POS}/healthz")
    wait_for("ERP", f"{ERP}/healthz")
    wait_for("Intelligence engine", f"{INTEL}/ready")

    # ------------------------------------------------------------------ dataset
    end = date.today() - timedelta(days=1)
    catalog = G.build_catalog(SKUS, SEED)
    hists = [G.history(catalog, s, HISTORY, end, SEED) for s in range(3)]
    demo = G.pick_demo_skus(catalog, hists)
    stocks = [G.initial_stock(catalog, hists[s], s, SEED, demo[s]) for s in range(3)]
    log(f"synthetic dataset ready: {len(catalog)} SKUs x 3 stores x {HISTORY} days (digest {G.digest(catalog, hists)})")

    # ------------------------------------------------------------------ CARPIP: tenants, users, keys
    carpip = Api(CARPIP)
    token = carpip.post("/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})["token"]
    carpip.headers = {"Authorization": f"Bearer {token}"}
    existing = {t["name"]: t for t in carpip.get("/api/admin/tenants")}

    def ensure_tenant(name: str, ttype: str, email: str, region: str) -> dict:
        if name in existing:
            return existing[name]
        t = carpip.post("/api/admin/tenants", {"name": name, "type": ttype, "region": region, "adminEmail": email, "adminPassword": DEMO_PW})
        existing[name] = t
        return t

    for r in RETAILERS:
        r["tenant"] = ensure_tenant(r["name"], "RETAILER", r["email"], r["city"])
    for w in WHOLESALERS:
        meta = G.WHOLESALERS[w["code"]]
        w["name"], w["meta"] = meta["name"], meta
        w["tenant"] = ensure_tenant(meta["name"], "WHOLESALER", w["email"], meta["region"])
    log("CARPIP tenants ready: " + ", ".join(f"{x['code']}={x['tenant']['publicId']}" for x in RETAILERS + WHOLESALERS))

    def key(tenant: dict, name: str, scopes: str) -> str:
        return carpip.post(f"/api/admin/tenants/{tenant['id']}/api-keys", {"name": name, "scopes": scopes})["key"]

    for w in WHOLESALERS:
        w["api_key"] = key(w["tenant"], "ERP integration", "catalog:write,graphql:read")
        w["secret"] = secrets.token_hex(24)
    for r in RETAILERS:
        r["node_key"] = key(r["tenant"], "CDIN node", "cdin:node")
    r3 = RETAILERS[2]
    r3["api_key"] = key(r3["tenant"], "legacy POS integration", "inventory:write,orders:write")

    # ------------------------------------------------------------------ POS
    pos = Api(POS, {"X-Admin-Token": POS_TOKEN})
    for i, r in enumerate(RETAILERS):
        pos.post("/pos/admin/shops", {"handle": r["handle"], "name": r["name"], "mode": r["mode"], "city": r["city"], "pin": r["pin"], "cashier": f"Cashier {i + 1}"})
        tok = pos.post(f"/pos/admin/shops/{r['handle']}/token")
        r["pos"] = tok
        res = pos.post(f"/pos/admin/shops/{r['handle']}/catalog", {"products": G.pos_catalog(catalog, stocks[i])}, timeout=300)
        log(f"POS {r['handle']} ({r['mode']}): catalog {res}")
    legacy_secret = secrets.token_hex(24)
    pos.post(f"/pos/admin/shops/{r3['handle']}/carpip", {"baseUrl": CARPIP, "tenantPublicId": r3["tenant"]["publicId"], "apiKey": r3["api_key"], "webhookSecret": legacy_secret})

    # ------------------------------------------------------------------ ERP
    erp = Api(ERP, {"X-Admin-Token": ERP_TOKEN})
    for w in WHOLESALERS:
        meta = w["meta"]
        res = erp.post("/erp/admin/companies", {
            "code": w["code"], "name": meta["name"], "mode": meta["mode"], "carpipTenantPublicId": w["tenant"]["publicId"], "carpipBaseUrl": CARPIP,
            "carpipApiKey": w["api_key"], "carpipWebhookSecret": w["secret"], "autoConfirm": True, "autoProgress": w["code"] != "WB",
            "users": [{"email": w["erp_email"], "password": DEMO_PW, "name": f"{meta['name']} Manager"}]})
        w["zoho"] = res.get("zoho")
        on_time, total = meta["ontime"]
        cres = erp.post(f"/erp/admin/companies/{w['code']}/catalog", {"items": G.wholesaler_catalog(catalog, w["code"], SEED, date.today()),
                                                                      "deliveryHistory": {"onTime": on_time, "total": total}}, timeout=300)
        log(f"ERP {w['code']} ({meta['mode']}): catalog {cres}")

    # ------------------------------------------------------------------ CARPIP: connections
    conns = {c["tenantId"]: c for c in carpip.get("/api/integrations/connections")}

    def connect(tenant: dict, **body) -> dict:
        return carpip.post("/api/integrations/connections", {"tenantId": tenant["id"], **body})

    for r in RETAILERS[:2]:
        r["conn"] = connect(r["tenant"], type="SHOPIFY", baseUrl=f"http://{r['pos']['domain']}:4000", credentials={"accessToken": r["pos"]["access_token"]},
                            webhookSecret=r["pos"]["webhook_secret"], config={"shop": r["pos"]["domain"]})
    r3["conn"] = connect(r3["tenant"], type="CUSTOM_REST", baseUrl=f"http://{r3['pos']['domain']}:4000", credentials={}, webhookSecret=legacy_secret,
                         config={"fieldMap": {"sku": "item_code", "gtin": "barcode", "quantity": "qty", "asOf": "ts"}})
    for w in WHOLESALERS:
        if w["meta"]["mode"] == "ZOHO":
            z = w["zoho"] or {}                         # the ERP returns the (stored) OAuth client on every upsert
            w["conn"] = connect(w["tenant"], type="ZOHO", baseUrl=ERP, credentials={"clientId": z["clientId"], "clientSecret": z["clientSecret"],
                                                                                    "refreshToken": z["refreshToken"], "orgId": z["orgId"]}, config={})
        else:
            w["conn"] = connect(w["tenant"], type="CUSTOM_REST", baseUrl=ERP, credentials={}, webhookSecret=w["secret"], config={"companyCode": w["code"]})
    log("CARPIP integration connections created (SHOPIFY x2, CUSTOM_REST legacy POS, ZOHO, CUSTOM_REST ERP x2)")

    # trade relationships: everyone trades with everyone except R3 - WC (deliberately: exercises the "no relationship" edge case)
    for r in RETAILERS:
        for w in WHOLESALERS:
            if r["code"] == "R3" and w["code"] == "WC":
                continue
            carpip.post("/api/admin/trade-relationships", {"retailerTenantId": r["tenant"]["id"], "wholesalerTenantId": w["tenant"]["id"]})

    # ------------------------------------------------------------------ first sync of every channel
    for w in WHOLESALERS:
        if w["meta"]["mode"] == "PATH_B":
            erp.post(f"/erp/admin/companies/{w['code']}/sync-now", timeout=120)
        else:
            res = carpip.post(f"/api/integrations/connections/{w['conn']['id']}/sync", timeout=180)
            log(f"{w['code']} Zoho sync: {res}")
    for r in RETAILERS[:2]:
        wh = carpip.post(f"/api/integrations/connections/{r['conn']['id']}/register-webhooks")
        res = carpip.post(f"/api/integrations/connections/{r['conn']['id']}/sync", timeout=300)
        log(f"{r['handle']} Shopify: webhooks {wh['created'] or wh['existing']}; sync {res}")
    pos.post(f"/pos/admin/shops/{r3['handle']}/push-inventory", timeout=120)
    for _ in range(60):                                   # the legacy POS delivers asynchronously: wait until CARPIP has the whole catalog
        have = next((t["products"] for t in carpip.get("/api/admin/tenant-stats") if t["id"] == r3["tenant"]["id"]), 0)
        if have >= len(catalog):
            break
        time.sleep(2)
    log(f"legacy store loaded into CARPIP through the open REST API: {have} products")
    for w in WHOLESALERS:
        t = carpip.post(f"/api/integrations/connections/{w['conn']['id']}/test")
        log(f"{w['code']} connection test: ok={t.get('ok')}")

    # ------------------------------------------------------------------ history + reorder points + competitor signals
    for i, r in enumerate(RETAILERS):
        nd = G.sales_ndjson(catalog, hists[i], end, r["tenant"]["id"])
        res = carpip.call("POST", "/api/admin/import/sales-history", content=nd.encode(), headers={"Content-Type": "application/json"}, timeout=600)
        log(f"sales history {r['handle']}: {res}")
    rng = random.Random(SEED + 7)
    comp = []
    for p in catalog:
        if rng.random() < 0.3:
            drift = rng.choice([-0.06, -0.02, 0.04, 0.09])
            for k, ago in enumerate((12, 8, 4, 1)):
                comp.append(json.dumps({"gtin": p.gtin, "price": f"{p.retail * (1 + drift * k / 3):.2f}", "daysAgo": ago}))
    carpip.call("POST", "/api/admin/import/competitor-prices", content="\n".join(comp).encode(), headers={"Content-Type": "application/json"})
    rop = carpip.post("/api/products/recompute-rop")
    log(f"dynamic reorder points computed: {rop}")

    # ------------------------------------------------------------------ nodes + ML
    for i, r in enumerate(RETAILERS):
        with open(os.path.join(OUT, f"cdin-node-{i + 1}.json"), "w") as f:
            json.dump({"apiKey": r["node_key"], "tenant": r["name"]}, f)
    intel = Api(INTEL, {"X-Internal-Token": INTERNAL})
    if SKIP_ML:
        log("SKIP_ML=true: skipping federated rounds and model training")
    else:
        run_ml(intel)
    intel.post("/api/mpi/recompute", {})
    log("MPI computed for all products")

    write_credentials(RETAILERS, WHOLESALERS, demo, state)
    state.update({"bootstrapped": True, "at": time.time(), "digest": G.digest(catalog, hists)})
    json.dump(state, open(state_path, "w"))
    log("BOOTSTRAP COMPLETE - open http://localhost:3000 (CARPIP), http://localhost:3100 (POS), http://localhost:3200 (ERP)")


def run_ml(intel: Api) -> None:
    status = intel.get("/api/cdin/status")
    if status.get("enabled") and (status.get("globalVersion") or 1) < CDIN_ROUNDS + 1:
        log("waiting for CDIN nodes to register (profile 'cdin' must be enabled)")
        for _ in range(60):
            nodes = intel.get("/api/cdin/status")["nodes"]
            if sum(1 for n in nodes if n["alive"]) >= 2:
                break
            time.sleep(5)
        else:
            log("WARNING: fewer than 2 CDIN nodes alive; skipping federated rounds (forecasts will use local LSTMs)")
        for n in range(CDIN_ROUNDS):
            if sum(1 for x in intel.get("/api/cdin/status")["nodes"] if x["alive"]) < 2:
                break
            rnd = intel.post("/api/cdin/rounds")
            log(f"CDIN round {rnd['roundNo']} opened (base v{rnd['baseVersion']})")
            for _ in range(120):
                time.sleep(5)
                rs = intel.get("/api/cdin/status")["rounds"]
                cur = next((x for x in rs if x["round_no"] == rnd["roundNo"]), None)
                if cur and cur["status"] != "OPEN":
                    log(f"CDIN round {rnd['roundNo']} -> {cur['status']} ({cur['participants']} nodes)")
                    break
    log("training the forecasting ensemble (LSTM + Transformer + XGBoost) per tenant - this takes a few minutes on CPU")
    intel.post("/api/forecast/train", {"tenantId": "all"})
    for _ in range(360):
        time.sleep(5)
        jobs = intel.get("/api/forecast/status")["jobs"]
        if jobs and all(j["status"] in ("DONE", "SKIPPED", "FAILED") for j in jobs.values()):
            for t, j in jobs.items():
                res = j.get("result", {})
                m = (res.get("metrics") or {}).get("ENSEMBLE", {})
                log(f"forecast {t[:8]}: {j['status']} v{res.get('version')} ensemble MAE={m.get('mae')} MAPE={m.get('mape')} lstm={res.get('lstmSource')}")
            return
    log("WARNING: forecast training did not finish within 30 minutes (it continues in the background)")


def write_credentials(retailers, wholesalers, demo, state) -> None:
    lines = ["# CARPIP demo credentials (generated - demo only)", "", "| System | URL |", "|---|---|",
             "| CARPIP | http://localhost:3000 |", "| Demo POS | http://localhost:3100 |", "| Demo ERP | http://localhost:3200 |",
             "| GraphiQL | http://localhost:8080/graphiql |", "", "## CARPIP logins (password `%s`)" % DEMO_PW, "",
             f"- Platform admin: `{ADMIN_EMAIL}` / `{ADMIN_PASSWORD}`"]
    for r in retailers:
        lines.append(f"- Retailer **{r['name']}**: `{r['email']}`")
    for w in wholesalers:
        lines.append(f"- Wholesaler **{w['name']}**: `{w['email']}`")
    lines += ["", "## POS (cashier PIN)", ""]
    for r in retailers:
        lines.append(f"- `{r['handle']}` {r['name']} ({r['mode']}): PIN `{r['pin']}`  - demo SKUs just above reorder point: {', '.join(sorted(demo[retailers.index(r)]))}")
    lines += ["", "## ERP logins (password `%s`)" % DEMO_PW, ""]
    for w in wholesalers:
        lines.append(f"- {w['name']} ({w['meta']['mode']}): `{w['erp_email']}`")
    open("/out/credentials.md", "w").write("\n".join(lines) + "\n")
    os.makedirs("/demo", exist_ok=True)
    try:
        open("/demo/credentials.md", "w").write("\n".join(lines) + "\n")
    except OSError:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"BOOTSTRAP FAILED: {e}", file=sys.stderr, flush=True)
        raise
