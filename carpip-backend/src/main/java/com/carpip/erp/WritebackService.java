package com.carpip.erp;

import com.carpip.common.Json;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Repos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Durable queue of calls to external systems (PO submit/cancel, incoming-stock push, stock adjust). */
@Service
public class WritebackService {
    private static final Logger log = LoggerFactory.getLogger(WritebackService.class);
    private final JdbcTemplate jdbc;
    private final Repos.ConnectionRepo connections;

    public WritebackService(JdbcTemplate jdbc, Repos.ConnectionRepo connections) {
        this.jdbc = jdbc;
        this.connections = connections;
    }

    /** Idempotent on the key: re-enqueueing the same logical operation is a no-op. */
    public boolean enqueue(UUID connectionTenantId, UUID poId, String kind, String key, Map<String, Object> payload) {
        Optional<IntegrationConnection> c = connections.findByTenantId(connectionTenantId);
        if (c.isEmpty()) {
            log.warn("no integration connection for tenant {}; skipping {} for PO {}", connectionTenantId, kind, poId);
            return false;
        }
        int n = jdbc.update("INSERT INTO writeback_task(id, connection_id, tenant_id, po_id, kind, idempotency_key, payload) VALUES (?,?,?,?,?,?,?::jsonb) " +
                        "ON CONFLICT (idempotency_key) DO NOTHING",
                UUID.randomUUID(), c.get().id, connectionTenantId, poId, kind, key, Json.write(payload == null ? Map.of() : payload));
        return n > 0;
    }
}
