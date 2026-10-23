package com.carpip.sse;

import com.carpip.auth.TenantContext;
import com.carpip.common.Json;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestController
class StreamEndpoint {
    private final SseHub hub;

    StreamEndpoint(SseHub hub) {
        this.hub = hub;
    }

    @GetMapping("/api/stream/events")
    public SseEmitter stream() {
        return hub.register(TenantContext.requireUser());
    }
}

/** Mirrors Kafka topics into the live UI feed. Never throws (a UI problem must not dead-letter business events). */
@Component
class StreamConsumer {
    private static final Logger log = LoggerFactory.getLogger(StreamConsumer.class);
    private final SseHub hub;

    StreamConsumer(SseHub hub) {
        this.hub = hub;
    }

    @KafkaListener(topics = {"sales.events", "inventory.updates", "po.lifecycle", "negotiation.events", "mpi.updates"},
            groupId = "carpip-ui-stream", id = "carpip-ui-stream")
    public void on(@Payload String value, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        try {
            JsonNode e = Json.read(value);
            if (!e.hasNonNull("tenantId")) {
                return;
            }
            UUID tenant = UUID.fromString(e.get("tenantId").asText());
            JsonNode p = e.path("payload");
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("topic", topic);
            m.put("eventType", e.path("eventType").asText());
            m.put("tenantId", tenant);
            m.put("at", e.path("occurredAt").asText());
            Map<String, Object> brief = new LinkedHashMap<>();
            for (String k : new String[]{"sku", "productId", "quantity", "mode", "reason", "poNumber", "from", "to", "totalAmount", "mpi", "trend",
                    "supplierName", "turn", "actor", "action", "price", "source", "clamped", "outcome", "message", "negotiationId", "externalOrderId", "isRefund"}) {
                if (p.has(k) && !p.get(k).isContainerNode()) {
                    brief.put(k, p.get(k).isNumber() ? p.get(k).numberValue() : p.get(k).asText());
                }
            }
            m.put("payload", brief);
            UUID wholesaler = p.hasNonNull("wholesalerTenantId") ? UUID.fromString(p.get("wholesalerTenantId").asText()) : null;
            hub.broadcast(m, tenant, wholesaler);
        } catch (Exception ex) {
            log.debug("ui-stream skipped message from {}: {}", topic, ex.getMessage());
        }
    }
}
