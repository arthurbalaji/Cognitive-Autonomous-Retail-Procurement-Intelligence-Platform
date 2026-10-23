package com.carpip.events;

import com.carpip.common.Json;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Transactional outbox: events are inserted in the SAME database transaction as the state change,
 * then relayed to Kafka by {@link OutboxRelay}. Webhooks therefore succeed even when Kafka is down.
 */
@Service
public class OutboxService {
    private final JdbcTemplate jdbc;

    public OutboxService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String publish(String topic, String key, String eventType, UUID tenantId, Map<String, Object> source, Object payload) {
        return publish(topic, key, eventType, tenantId, source, payload, UUID.randomUUID().toString(), null);
    }

    public String publish(String topic, String key, String eventType, UUID tenantId, Map<String, Object> source, Object payload,
                          String eventId, Instant occurredAt) {
        Map<String, Object> env = new LinkedHashMap<>();
        env.put("eventId", eventId);
        env.put("eventType", eventType);
        env.put("schemaVersion", 1);
        env.put("tenantId", tenantId);
        env.put("occurredAt", occurredAt == null ? Instant.now() : occurredAt);
        env.put("ingestedAt", Instant.now());
        env.put("source", source == null ? Map.of("system", "carpip") : source);
        String corr = MDC.get("correlationId");
        env.put("correlationId", corr == null ? UUID.randomUUID().toString() : corr);
        env.put("payload", payload);
        jdbc.update("INSERT INTO outbox_event(topic, msg_key, payload) VALUES (?,?,?)", topic, key, Json.write(env));
        return eventId;
    }
}
