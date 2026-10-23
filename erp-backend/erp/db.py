from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any

from sqlalchemy import create_engine, text

from . import config

engine = create_engine(config.DB_URL, pool_size=6, max_overflow=4, pool_pre_ping=True, pool_recycle=1800)


def rows(sql: str, _c=None, **p) -> list[dict[str, Any]]:
    if _c is not None:
        return [dict(r._mapping) for r in _c.execute(text(sql), p)]
    with engine.begin() as conn:     # begin(): commits on exit, so INSERT/UPDATE ... RETURNING work too
        return [dict(r._mapping) for r in conn.execute(text(sql), p)]


def one(sql: str, _c=None, **p):
    r = rows(sql, _c, **p)
    return r[0] if r else None


def scalar(sql: str, _c=None, **p):
    if _c is not None:
        return _c.execute(text(sql), p).scalar()
    with engine.begin() as conn:
        return conn.execute(text(sql), p).scalar()


def execute(sql: str, _c=None, **p) -> int:
    if _c is not None:
        return _c.execute(text(sql), p).rowcount
    with engine.begin() as conn:
        return conn.execute(text(sql), p).rowcount


@contextmanager
def tx():
    with engine.begin() as c:
        yield c


def wait_for_db(tries: int = 60) -> None:
    for _ in range(tries):
        try:
            scalar("SELECT 1")
            return
        except Exception:  # noqa: BLE001
            time.sleep(2)
    raise RuntimeError("database not reachable")
