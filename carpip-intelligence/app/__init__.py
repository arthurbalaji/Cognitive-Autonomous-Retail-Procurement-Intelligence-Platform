"""CARPIP cognitive intelligence engine (Flask). Python 3.11, decoupled from the Java transactional backend."""
from __future__ import annotations

import logging
import os
import threading


from .config import settings

_started = threading.Event()


def create_app():
    from flask import Flask, jsonify   # lazy: the pure-math modules (and their tests) must import without Flask installed

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s [%(threadName)s] %(name)s: %(message)s")
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    app = Flask(__name__)
    app.json.sort_keys = False

    from .api import cdin, demo, forecast, health, llm_api, mpi_api, negotiate

    for bp in (health.bp, negotiate.bp, mpi_api.bp, forecast.bp, cdin.bp, llm_api.bp, demo.bp):
        app.register_blueprint(bp)

    @app.errorhandler(Exception)
    def _unhandled(e):  # noqa: ANN001
        from werkzeug.exceptions import HTTPException

        if isinstance(e, HTTPException):
            r = jsonify({"type": "about:blank", "status": e.code, "code": e.name.upper().replace(" ", "_"), "detail": e.description})
            r.status_code = e.code
            return r
        logging.getLogger("app").exception("unhandled error")
        r = jsonify({"type": "about:blank", "status": 500, "code": "INTERNAL", "detail": f"{type(e).__name__}: {e}"})
        r.status_code = 500
        return r

    _start_background()
    return app


def _start_background() -> None:
    if _started.is_set():
        return
    _started.set()
    from apscheduler.schedulers.background import BackgroundScheduler
    from datetime import datetime, timedelta, timezone

    from . import db
    from .cdin import coordinator
    from .forecasting import service as forecast_service
    from .mpi import engine as mpi_engine

    log = logging.getLogger("scheduler")
    sched = BackgroundScheduler(timezone="UTC", job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60})

    def mpi_job():
        mpi_engine.run_job()

    def auto_round():
        if not settings.FEATURE_CDIN:
            return
        alive = [n for n in coordinator.status()["nodes"] if n["alive"] and not n["offline"]]
        if len(alive) >= settings.CDIN_MIN_QUORUM:
            coordinator.open_round()

    def nightly_inference():
        for t in forecast_service.retail_tenants():
            try:
                forecast_service.infer_tenant(t)
            except Exception:  # noqa: BLE001
                log.exception("scheduled inference failed for %s", t)

    first = datetime.now(timezone.utc) + timedelta(seconds=25)
    sched.add_job(mpi_job, "interval", seconds=max(5, settings.MPI_INTERVAL_S), id="mpi", next_run_time=first)
    sched.add_job(coalesce_safe(coordinator.tick), "interval", seconds=5, id="cdin_tick")
    sched.add_job(coalesce_safe(auto_round), "interval", seconds=max(30, settings.CDIN_ROUND_INTERVAL_S), id="cdin_rounds",
                  next_run_time=datetime.now(timezone.utc) + timedelta(seconds=settings.CDIN_ROUND_INTERVAL_S))
    sched.add_job(nightly_inference, "interval", hours=6, id="forecast_infer", next_run_time=datetime.now(timezone.utc) + timedelta(hours=6))
    sched.start()
    app_sched["s"] = sched
    try:
        coordinator.ensure_initial()
        os.makedirs(settings.MODEL_DIR, exist_ok=True)
        scale = db.time_scale()
        if scale > 1:
            reschedule_mpi(scale)
    except Exception as e:  # noqa: BLE001 - DB may not be ready yet; first request will retry ensure_initial
        log.warning("startup tasks deferred: %s", e)
    log.info("scheduler started (MPI every %ss)", settings.MPI_INTERVAL_S)


app_sched: dict = {}


def coalesce_safe(fn):
    def wrapper():
        try:
            fn()
        except Exception:  # noqa: BLE001
            logging.getLogger("scheduler").exception("job %s failed", getattr(fn, "__name__", "?"))
    wrapper.__name__ = getattr(fn, "__name__", "job")
    return wrapper


def reschedule_mpi(scale: float) -> float:
    """Demo time-scale: MPI cadence = MPI_INTERVAL_S / scale (never below 5 s). Timestamps stay real."""
    interval = max(5.0, settings.MPI_INTERVAL_S / max(scale, 1.0))
    s = app_sched.get("s")
    if s:
        s.reschedule_job("mpi", trigger="interval", seconds=interval)
    return interval
