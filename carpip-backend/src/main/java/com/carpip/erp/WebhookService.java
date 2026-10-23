package com.carpip.erp;

import com.carpip.audit.AuditService;
import com.carpip.common.Json;
import com.carpip.config.AppProps;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import com.carpip.events.OutboxService;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * POST /api/erp/webhook/{tenantPublicId}: verify (raw-bytes HMAC) -> replay window -> dedupe -> translate -> outbox.
 * Everything after verification runs in ONE transaction, so an accepted webhook is either fully recorded
 * (inbound_event + outbox rows) or not at all. Replies 200 in milliseconds; Kafka is never on this path.
 */
@Service
public class WebhookService {
    private static final Logger log = LoggerFactory.getLogger(WebhookService.class);
    private static final int MAX_BODY = 1_048_576;

    public record Outcome(int status, Map<String, Object> body) {
    }

    private final Repos.TenantRepo tenants;
    private final Repos.ConnectionRepo connections;
    private final AdapterRegistry adapters;
    private final OutboxService outbox;
    private final SupplierEventService supplierEvents;
    private final AuditService audit;
    private final JdbcTemplate jdbc;
    private final AppProps props;

    public WebhookService(Repos.TenantRepo tenants, Repos.ConnectionRepo connections, AdapterRegistry adapters, OutboxService outbox,
                          SupplierEventService supplierEvents, AuditService audit, JdbcTemplate jdbc, AppProps props) {
        this.tenants = tenants;
        this.connections = connections;
        this.adapters = adapters;
        this.outbox = outbox;
        this.supplierEvents = supplierEvents;
        this.audit = audit;
        this.jdbc = jdbc;
        this.props = props;
    }

    private static Outcome out(int status, String key, String value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put(key, value);
        return new Outcome(status, m);
    }

    @Transactional
    public Outcome handle(String tenantPublicId, Map<String, String> headers, byte[] body) {
        if (body.length > MAX_BODY) {
            return out(413, "error", "payload too large");
        }
        Optional<Tenant> t = tenants.findByPublicId(tenantPublicId);
        if (t.isEmpty()) {
            return out(404, "error", "unknown tenant");
        }
        Optional<IntegrationConnection> oc = connections.findByTenantId(t.get().id);
        if (oc.isEmpty() || !"ACTIVE".equals(oc.get().status)) {
            return out(404, "error", "no active connection for tenant");
        }
        IntegrationConnection c = oc.get();
        ErpAdapter adapter = adapters.get(c.type);

        if (!adapter.verifyWebhook(c, headers, body)) {
            audit.log(t.get().id, "SYSTEM", c.type, "WEBHOOK_SIGNATURE_INVALID", "integration_connection", c.id.toString(),
                    Map.of("topic", headers.getOrDefault("x-shopify-topic", String.valueOf(headers.get("x-carpip-event-id")))));
            return out(401, "error", "invalid signature");
        }
        Long ts = adapter.eventTimestamp(headers);
        if (ts != null && Math.abs(Instant.now().getEpochSecond() - ts) > props.webhookToleranceS()) {
            audit.log(t.get().id, "SYSTEM", c.type, "WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE", "integration_connection", c.id.toString(),
                    Map.of("skewSeconds", Instant.now().getEpochSecond() - ts));
            return out(401, "error", "timestamp_out_of_tolerance");
        }
        JsonNode json;
        try {
            json = Json.read(body);
        } catch (IllegalArgumentException e) {
            return out(400, "error", "malformed json");
        }
        String eventId = adapter.eventId(headers, json);
        if (eventId == null || eventId.isBlank()) {
            return out(400, "error", "missing event id");
        }
        String source = "SHOPIFY".equals(c.type) ? "pos-shopify" : c.type.toLowerCase();
        String topic = headers.getOrDefault("x-shopify-topic", json.path("type").asText(null));
        UUID inboundId = UUID.randomUUID();
        int inserted = jdbc.update("INSERT INTO inbound_event(id, tenant_id, connection_id, source, external_event_id, topic, signature_valid, payload, status) " +
                        "VALUES (?,?,?,?,?,?,true,?::jsonb,'RECEIVED') ON CONFLICT (tenant_id, source, external_event_id) DO NOTHING",
                inboundId, t.get().id, c.id, source, eventId, topic, new String(body, java.nio.charset.StandardCharsets.UTF_8));
        if (inserted == 0) {
            return out(200, "status", "duplicate");
        }

        String status = "PROCESSED";
        String detail = null;
        try {
            if ("SUPPLIER_ERP".equals(c.direction)) {
                String r = supplierEvents.handle(c, json);
                detail = r;
                if (r.startsWith("IGNORED")) {
                    status = "IGNORED";
                }
            } else {
                List<ErpAdapter.CanonicalEvent> events = adapter.parseWebhook(c, headers, json);
                int published = 0;
                for (ErpAdapter.CanonicalEvent ev : events) {
                    Map<String, Object> src = new LinkedHashMap<>();
                    src.put("system", source);
                    src.put("connectionId", c.id);
                    src.put("externalId", eventId);
                    switch (ev.kind()) {
                        case "SALE" -> {
                            outbox.publish("sales.events", ev.key(), ev.eventType(), t.get().id, src, ev.payload(), UUID.randomUUID().toString(), ev.occurredAt());
                            published++;
                        }
                        case "INVENTORY" -> {
                            outbox.publish("inventory.updates", ev.key(), ev.eventType(), t.get().id, src, ev.payload(), UUID.randomUUID().toString(), ev.occurredAt());
                            published++;
                        }
                        case "RESYNC" -> {
                            Map<String, Object> cur = new HashMap<>(c.syncCursor == null ? Map.of() : c.syncCursor);
                            cur.put("needSync", true);
                            c.syncCursor = cur;
                            status = "UNMAPPED";
                            detail = ev.eventType();
                        }
                        default -> log.debug("unknown canonical kind {}", ev.kind());
                    }
                }
                if (events.isEmpty()) {
                    status = "IGNORED";
                } else if (published == 0 && !"UNMAPPED".equals(status)) {
                    status = "IGNORED";
                }
            }
            Map<String, Object> cur = new HashMap<>(c.syncCursor == null ? Map.of() : c.syncCursor);
            cur.put("lastWebhookAt", Instant.now().toString());
            c.syncCursor = cur;
            if ("CUSTOM_REST".equals(c.type)) {
                c.lastSyncAt = Instant.now();
                c.health = "OK";
            }
            connections.save(c);
        } catch (RuntimeException e) {
            log.error("webhook processing failed for {} {}: {}", c.type, eventId, e.getMessage());
            throw e; // roll back (incl. inbound_event row) so the sender's retry is processed again
        }
        jdbc.update("UPDATE inbound_event SET status=?, error=? WHERE id=?", status, detail, inboundId);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", status.toLowerCase());
        if (detail != null) {
            m.put("detail", detail);
        }
        return new Outcome(200, m);
    }
}
