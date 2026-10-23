"""Database access (SQLAlchemy Core, role carpip_intel) and small helpers."""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Any, Iterable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import settings

log = logging.getLogger(__name__)
_engine: Engine | None = None
_lock = threading.Lock()


def engine() -> Engine:
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                _engine = create_engine(settings.DB_URL, pool_size=5, max_overflow=5, pool_pre_ping=True, pool_recycle=1800)
    return _engine


@contextmanager
def conn():
    with engine().begin() as c:
        yield c


def rows(sql: str, **params) -> list[dict[str, Any]]:
    with engine().connect() as c:
        return [dict(r._mapping) for r in c.execute(text(sql), params)]


def one(sql: str, **params) -> dict[str, Any] | None:
    r = rows(sql, **params)
    return r[0] if r else None


def scalar(sql: str, **params):
    with engine().connect() as c:
        return c.execute(text(sql), params).scalar()


def execute(sql: str, **params) -> int:
    with engine().begin() as c:
        return c.execute(text(sql), params).rowcount


def executemany(sql: str, batch: Iterable[dict[str, Any]]) -> None:
    batch = list(batch)
    if not batch:
        return
    with engine().begin() as c:
        c.execute(text(sql), batch)


def setting(key: str, default=None):
    r = one("SELECT value #>> '{}' AS v FROM system_setting WHERE key = :k", k=key)
    return default if r is None or r["v"] is None else r["v"]


def time_scale() -> float:
    try:
        return max(1.0, float(setting("demo.time_scale", "1")))
    except Exception:  # noqa: BLE001
        return 1.0
