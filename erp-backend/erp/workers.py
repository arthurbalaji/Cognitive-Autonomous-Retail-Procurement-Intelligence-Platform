"""Background workers: signed webhook outbox to CARPIP, periodic catalog push (/api/erp/sync), optional warehouse auto-progress."""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from datetime import datetime, timezone

import httpx

from . import config, db, domain
from .security import carpip_sign

log = logging.getLogger("erp.workers")
BACKOFF = [1, 5, 30, 120, 600, 600, 600, 600]


def _log(company_id, direction, method, path, status, note):
    try:
        db.execute("INSERT INTO integration_log(company_id, direction, method, path, status, note) VALUES (:c,:d,:m,:p,:s,:n)", c=company_id, d=direction, m=method, p=path, s=status, n=note[:300])
    except Exception:  # noqa: BLE001
        pass


# ------------------------------------------------------------------ webhook outbox (ordered per company)
def send_pending() -> int:
    due = db.rows("""SELECT o.id, o.company_id, o.type, o.event_id, o.body, o.attempts, c.carpip_base_url, c.carpip_tenant_public_id, c.carpip_webhook_secret
                     FROM outbox_events o JOIN companies c ON c.id = o.company_id
                     WHERE o.status='PENDING' AND o.next_attempt_at <= now() ORDER BY o.id LIMIT 40""")
    blocked: set[int] = set()
    sent = 0
    with httpx.Client(timeout=8.0) as client:
        for e in due:
            if e["company_id"] in blocked:
                continue                        # keep per-company ordering: confirmed -> shipped -> delivered
            body = e["body"].encode()
            ts = str(int(time.time()))
            url = f"{e['carpip_base_url'].rstrip('/')}/api/erp/webhook/{e['carpip_tenant_public_id']}"
            headers = {"Content-Type": "application/json", "X-Carpip-Timestamp": ts, "X-Carpip-Event-Id": e["event_id"],
                       "X-Carpip-Signature": carpip_sign(e["carpip_webhook_secret"], ts, e["event_id"], body)}
            code, err = 0, None
            try:
                r = client.post(url, content=body, headers=headers)
                code = r.status_code
                if not r.is_success:
                    err = r.text[:200]
            except Exception as ex:  # noqa: BLE001
                err = str(ex)[:200]
            attempts = e["attempts"] + 1
            if 200 <= code < 300:
                db.execute("UPDATE outbox_events SET status='SENT', attempts=:a, last_status=:s, last_error=NULL, sent_at=now() WHERE id=:i", a=attempts, s=code, i=e["id"])
                _log(e["company_id"], "OUT", "POST", f"/api/erp/webhook ({e['type']})", code, "delivered")
                sent += 1
            elif 400 <= code < 500 and code not in (408, 429):
                db.execute("UPDATE outbox_events SET status='FAILED', attempts=:a, last_status=:s, last_error=:e WHERE id=:i", a=attempts, s=code, e=err, i=e["id"])
                _log(e["company_id"], "OUT", "POST", f"/api/erp/webhook ({e['type']})", code, f"rejected: {err}")
            elif attempts >= len(BACKOFF):
                db.execute("UPDATE outbox_events SET status='FAILED', attempts=:a, last_status=:s, last_error=:e WHERE id=:i", a=attempts, s=code or None, e=err, i=e["id"])
                blocked.add(e["company_id"])
            else:
                db.execute("UPDATE outbox_events SET attempts=:a, last_status=:s, last_error=:e, next_attempt_at=now() + make_interval(secs => :d) WHERE id=:i",
                           a=attempts, s=code or None, e=err, d=BACKOFF[attempts - 1], i=e["id"])
                blocked.add(e["company_id"])
    return sent


# ------------------------------------------------------------------ catalog push to CARPIP (Path B)
def push_catalog(company_id: int) -> dict:
    co = db.one("SELECT * FROM companies WHERE id=:i", i=company_id)
    if not co or co["mode"] != "PATH_B" or not co["carpip_base_url"] or not co["carpip_api_key"]:
        return {"skipped": True}
    with db.engine.connect() as c:
        items = domain.catalog(c, company_id)
    body = {"mode": "FULL", "asOf": datetime.now(timezone.utc).isoformat(), "items": items}
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.post(f"{co['carpip_base_url'].rstrip('/')}/api/erp/sync", json=body, headers={"Authorization": f"Bearer {co['carpip_api_key']}"})
        _log(company_id, "OUT", "POST", "/api/erp/sync", r.status_code, f"{len(items)} items")
        ok = r.is_success
        if ok:
            db.execute("DELETE FROM settings WHERE key=:k", k=f"dirty:{company_id}")
        return {"status": r.status_code, "items": len(items), "response": r.text[:300]}
    except Exception as ex:  # noqa: BLE001
        _log(company_id, "OUT", "POST", "/api/erp/sync", 0, f"failed: {ex}")
        return {"status": 0, "error": str(ex)[:200]}


def sync_loop() -> None:
    last_full: dict[int, float] = {}
    while True:
        try:
            for co in db.rows("SELECT id FROM companies WHERE mode='PATH_B' AND carpip_base_url IS NOT NULL AND carpip_api_key IS NOT NULL"):
                cid = co["id"]
                dirty = db.one("SELECT 1 AS x FROM settings WHERE key=:k", k=f"dirty:{cid}") is not None
                if dirty or time.time() - last_full.get(cid, 0) > config.SYNC_INTERVAL_S:
                    push_catalog(cid)
                    last_full[cid] = time.time()
        except Exception:  # noqa: BLE001
            log.exception("catalog sync loop error")
        time.sleep(3)


# ------------------------------------------------------------------ warehouse automation (demo / unattended mode)
def progress_loop() -> None:
    while True:
        try:
            delays = [float(x) for x in domain.get_setting("progress_delays", "3,6,10").split(",")]
            for co in db.rows("SELECT * FROM companies"):
                if co["auto_confirm"]:
                    for so in db.rows("SELECT id FROM sales_orders WHERE company_id=:c AND status='RECEIVED' AND updated_at < now() - interval '2 seconds' LIMIT 10", c=co["id"]):
                        try:
                            domain.confirm_sales_order(co, so["id"], None, "auto-confirm")
                        except domain.ErpError as e:
                            log.info("auto-confirm skipped: %s", e.detail)
                if not co["auto_progress"]:
                    continue
                for so in db.rows("SELECT id FROM sales_orders WHERE company_id=:c AND status IN ('CONFIRMED','PARTIALLY_CONFIRMED') AND updated_at < now() - make_interval(secs => :d) LIMIT 10", c=co["id"], d=delays[1]):
                    try:
                        domain.ship_sales_order(co, so["id"], None, "AutoFreight", None, 1)
                    except domain.ErpError as e:
                        log.info("auto-ship skipped: %s", e.detail)
                for so in db.rows("SELECT id FROM sales_orders WHERE company_id=:c AND status IN ('SHIPPED','PARTIALLY_SHIPPED') AND updated_at < now() - make_interval(secs => :d) LIMIT 10", c=co["id"], d=delays[2] - delays[1]):
                    try:
                        domain.deliver_sales_order(co, so["id"])
                    except domain.ErpError as e:
                        log.info("auto-deliver skipped: %s", e.detail)
        except Exception:  # noqa: BLE001
            log.exception("progress loop error")
        time.sleep(1.5)


def outbox_loop() -> None:
    while True:
        try:
            send_pending()
        except Exception:  # noqa: BLE001
            log.exception("outbox loop error")
        time.sleep(1.0)


def start() -> None:
    for fn in (outbox_loop, sync_loop, progress_loop):
        threading.Thread(target=fn, daemon=True, name=fn.__name__).start()


_ = (json, uuid)
