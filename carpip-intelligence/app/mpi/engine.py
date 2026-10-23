"""Market Pulse Index computation over the database (bulk loads, one query per input family) + 15-minute scheduler."""
from __future__ import annotations

import json
import logging
import threading
from collections import defaultdict
from datetime import date

from .. import db, kafka_pub
from ..config import settings
from ..negotiation.quantity import paper_quantity
from . import factors as F

log = logging.getLogger(__name__)
_run_lock = threading.Lock()


def _inputs(product_ids: list[str] | None):
    pid_filter = "AND p.id = ANY(CAST(:ids AS uuid[]))" if product_ids else ""
    params = {"ids": product_ids} if product_ids else {}
    products = db.rows(
        f"""SELECT p.id::text AS id, p.tenant_id::text AS tenant_id, p.gtin, p.category, p.current_stock, p.reorder_point,
                   v.on_order::int AS on_order
            FROM product p JOIN v_inventory_position v ON v.product_id = p.id WHERE p.active {pid_filter}""", **params)
    offers = db.rows(
        """SELECT o.wholesaler_tenant_id::text AS w, o.gtin, o.available_qty, o.shipping_reliability::float8 AS rel, o.list_price::float8 AS price,
                  o.lead_time_days, EXTRACT(EPOCH FROM (now() - o.synced_at)) / 3600.0 AS age_h
           FROM supplier_offer o JOIN tenant t ON t.id = o.wholesaler_tenant_id AND t.status = 'ACTIVE' WHERE o.active AND o.gtin IS NOT NULL""")
    trade = db.rows("SELECT retailer_tenant_id::text AS r, wholesaler_tenant_id::text AS w FROM trade_relationship WHERE status = 'ACTIVE'")
    sales = db.rows(
        """SELECT product_id::text AS id, COALESCE(SUM(units) FILTER (WHERE day >= current_date - 28), 0)::float8 AS u28,
                  COALESCE(SUM(units) FILTER (WHERE day >= current_date - 56), 0)::float8 AS u56
           FROM sales_daily WHERE day >= current_date - 56 GROUP BY product_id""")
    fc = db.rows(
        """SELECT product_id::text AS id, COALESCE(SUM(yhat) FILTER (WHERE target_date < current_date + 14), 0)::float8 AS f14,
                  AVG(yhat) FILTER (WHERE target_date < current_date + 7)::float8 AS f7
           FROM intel_forecast WHERE target_date >= current_date GROUP BY product_id""")
    hist = db.rows("SELECT gtin, price::float8 AS price FROM supplier_price_history WHERE at > now() - interval '30 days' ORDER BY at")
    comp = db.rows("SELECT gtin, price::float8 AS price FROM competitor_price WHERE at > now() - interval '14 days' ORDER BY at")
    rdi = db.rows("SELECT gtin, rdi::float8 AS rdi FROM intel_rdi")
    last = db.rows("SELECT product_id::text AS id, mpi::float8 AS mpi, computed_at FROM v_mpi_latest")
    macro = db.setting("macro_signal", "0.5")
    return products, offers, trade, sales, fc, hist, comp, rdi, last, macro


def compute(product_ids: list[str] | None = None, force: bool = False) -> dict[str, dict]:
    """Computes MPI for the given products (or all active). Persists snapshots when material and returns {product_id: result}."""
    products, offers, trade, sales, fc, hist, comp, rdi, last, macro = _inputs(product_ids)
    related: dict[str, set[str]] = defaultdict(set)
    for t in trade:
        related[t["r"]].add(t["w"])
    offers_by_gtin: dict[str, list[dict]] = defaultdict(list)
    for o in offers:
        offers_by_gtin[o["gtin"]].append(o)
    sales_by = {s["id"]: s for s in sales}
    fc_by = {f["id"]: f for f in fc}
    hist_by: dict[str, list[float]] = defaultdict(list)
    for h in hist:
        hist_by[h["gtin"]].append(h["price"])
    comp_by: dict[str, list[float]] = defaultdict(list)
    for c in comp:
        comp_by[c["gtin"]].append(c["price"])
    rdi_by = {r["gtin"]: r["rdi"] for r in rdi} if settings.FEATURE_CDIN else {}
    last_by = {l["id"]: l for l in last}
    try:
        macro_v = float(macro)
    except (TypeError, ValueError):
        macro_v = None

    out: dict[str, dict] = {}
    to_store: list[dict] = []
    to_publish: list[tuple[str, str, dict]] = []
    for p in products:
        gtin = p["gtin"]
        rel_offers = [o for o in offers_by_gtin.get(gtin, []) if o["w"] in related.get(p["tenant_id"], set())] if gtin else []
        position = p["current_stock"] + p["on_order"]
        s = sales_by.get(p["id"], {})
        f = fc_by.get(p["id"])
        trailing28 = (s.get("u28", 0.0) or 0.0) / 28.0
        trailing56 = (s.get("u56", 0.0) or 0.0) / 56.0
        demand = f["f7"] if f and f.get("f7") is not None else (trailing28 if s else None)
        lead = min((o["lead_time_days"] for o in rel_offers), default=3)
        q_hat = paper_quantity(p["reorder_point"], position)
        freshness = min((o["age_h"] for o in rel_offers), default=None)

        dp, dp_prior = F.demand_pressure(position, p["reorder_point"], demand, lead, settings.SAFETY_DAYS)
        sa, sa_prior = F.supply_availability([F.Offer(o["available_qty"], o["rel"], o["price"], o["lead_time_days"]) for o in rel_offers], q_hat, freshness)
        pv, pv_prior = F.price_volatility([o["price"] for o in rel_offers], hist_by.get(gtin, []) if gtin else [])
        si, si_prior = F.seasonal_index(p["category"], f["f14"] if f else None, trailing56 if s else None)
        cs, cs_prior = F.competitive_signal(rdi_by.get(gtin) if gtin else None, macro_v, comp_by.get(gtin) if gtin else None)
        if not settings.FEATURE_MPI:   # ablation 1: static bounds (MPI frozen at the neutral value)
            res = F.MpiResult(0.5, dp, sa, pv, si, cs, "STABLE", "DISABLED", ["feature-off"])
        else:
            prev = last_by.get(p["id"], {}).get("mpi")
            res = F.assemble(dp, sa, pv, si, cs, {"dp": dp_prior, "sa": sa_prior or not rel_offers, "pv": pv_prior, "si": si_prior, "cs": cs_prior},
                             settings.MPI_WEIGHTS, prev)
        item = {"mpi": res.mpi, "dp": res.dp, "sa": res.sa, "pv": res.pv, "si": res.si, "cs": res.cs, "trend": res.trend,
                "quality": res.quality, "priors": res.priors, "position": position, "demand": demand, "lead": lead, "offers": len(rel_offers)}
        out[p["id"]] = item
        prev_row = last_by.get(p["id"])
        material = (force or prev_row is None or abs(res.mpi - (prev_row["mpi"] or 0)) >= 0.005
                    or (prev_row.get("computed_at") and (db.scalar("SELECT EXTRACT(EPOCH FROM (now() - :t))", t=prev_row["computed_at"]) or 0) > 3600))
        if material:
            to_store.append({"t": p["tenant_id"], "p": p["id"], "mpi": res.mpi, "dp": res.dp, "sa": res.sa, "pv": res.pv, "si": res.si, "cs": res.cs,
                             "trend": res.trend, "q": res.quality, "inputs": json.dumps({k: item[k] for k in ("position", "demand", "lead", "offers", "priors")}, default=str)})
            to_publish.append((p["tenant_id"], p["id"], {"productId": p["id"], "mpi": res.mpi, "trend": res.trend, "quality": res.quality,
                                                         "factors": {"dp": res.dp, "sa": res.sa, "pv": res.pv, "si": res.si, "cs": res.cs}}))
    db.executemany(
        """INSERT INTO intel_mpi_snapshot(tenant_id, product_id, supplier_tenant_id, mpi, dp, sa, pv, si, cs, trend, quality, inputs)
           VALUES (CAST(:t AS uuid), CAST(:p AS uuid), NULL, :mpi, :dp, :sa, :pv, :si, :cs, :trend, :q, CAST(:inputs AS jsonb))""", to_store)
    for tenant, pid, payload in to_publish:
        kafka_pub.publish("mpi.updates", f"{tenant}:{pid}", "mpi.computed", tenant, payload)
    return out


def compute_one(product_id: str) -> dict:
    r = compute([product_id], force=True)
    if product_id not in r:
        raise KeyError(f"unknown or inactive product {product_id}")
    return r[product_id]


def run_job() -> dict:
    """Scheduled / manual full run. Single-flight (a slow run is never overlapped)."""
    if not _run_lock.acquire(blocking=False):
        return {"skipped": "already running"}
    try:
        t0 = date.today()
        r = compute()
        db.execute("DELETE FROM intel_mpi_snapshot WHERE computed_at < now() - interval '7 days'")
        log.info("MPI run: %d products", len(r))
        return {"products": len(r), "date": t0.isoformat()}
    except Exception as e:  # noqa: BLE001
        log.exception("MPI run failed")
        return {"error": str(e)}
    finally:
        _run_lock.release()
