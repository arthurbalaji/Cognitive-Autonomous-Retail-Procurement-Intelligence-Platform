package com.carpip.audit;

import com.carpip.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

/** Append-only audit trail. Always written in its own transaction so failures upstream never erase it. */
@Service
public class AuditService {
    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private final JdbcTemplate jdbc;

    public AuditService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(UUID tenantId, String actorType, String actorId, String action, String entityType, String entityId,
                    Map<String, Object> detail) {
        try {
            jdbc.update("INSERT INTO audit_log(tenant_id, actor_type, actor_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?,?,?::jsonb)",
                    tenantId, actorType, actorId, action, entityType, entityId, detail == null ? null : Json.write(detail));
        } catch (Exception e) {
            log.warn("audit write failed for {}: {}", action, e.getMessage());
        }
    }
}
