"""Best-effort Kafka publisher (negotiation.events / mpi.updates). Business correctness never depends on it."""
from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone

from .config import settings

log = logging.getLogger(__name__)
_producer = None
_lock = threading.Lock()
_failures = 0


def _get():
    global _producer
    if _producer is None:
        with _lock:
            if _producer is None:
                from kafka import KafkaProducer  # imported lazily

                _producer = KafkaProducer(
                    bootstrap_servers=settings.KAFKA_BOOTSTRAP,
                    value_serializer=lambda v: json.dumps(v, default=str).encode(),
                    key_serializer=lambda k: k.encode() if k else None,
                    acks=1,
                    linger_ms=20,
                    max_block_ms=1500,
                    request_timeout_ms=3000,
                    retries=1,
                )
    return _producer


def publish(topic: str, key: str | None, event_type: str, tenant_id: str, payload: dict) -> None:
    global _failures
    env = {
        "eventId": str(uuid.uuid4()),
        "eventType": event_type,
        "schemaVersion": 1,
        "tenantId": tenant_id,
        "occurredAt": datetime.now(timezone.utc).isoformat(),
        "source": {"system": "intelligence"},
        "payload": payload,
    }
    try:
        _get().send(topic, key=key, value=env)
        _failures = 0
    except Exception as e:  # noqa: BLE001 - best effort by design
        _failures += 1
        if _failures in (1, 10, 100):
            log.warning("kafka publish to %s failed (%d consecutive): %s", topic, _failures, e)
