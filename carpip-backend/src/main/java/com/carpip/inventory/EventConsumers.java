package com.carpip.inventory;

import com.carpip.common.Json;
import com.carpip.common.Money;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.UUID;

/**
 * Kafka consumers for the paper's two topics. Malformed / newer-schema messages raise
 * IllegalArgumentException (non-retryable) and are routed straight to the .DLT topic.
 */
@Component
public class EventConsumers {
    private static final Logger log = LoggerFactory.getLogger(EventConsumers.class);
    private final InventoryService inventory;
    private final SalesService sales;

    public EventConsumers(InventoryService inventory, SalesService sales) {
        this.inventory = inventory;
        this.sales = sales;
    }

    private static JsonNode envelope(String value) {
        JsonNode e = Json.read(value);
        if (!e.hasNonNull("eventId") || !e.hasNonNull("tenantId") || !e.has("payload")) {
            throw new IllegalArgumentException("malformed envelope");
        }
        if (e.path("schemaVersion").asInt(1) > 1) {
            throw new IllegalArgumentException("unsupported schemaVersion " + e.path("schemaVersion").asInt());
        }
        return e;
    }

    @KafkaListener(topics = "inventory.updates", groupId = "carpip-inventory", id = "carpip-inventory")
    public void onInventory(String value) {
        JsonNode e = envelope(value);
        JsonNode p = e.get("payload");
        UUID tenantId = UUID.fromString(e.get("tenantId").asText());
        UUID productId = UUID.fromString(p.get("productId").asText());
        String mode = p.path("mode").asText("ABSOLUTE");
        Instant sv = p.hasNonNull("sourceVersion") ? Instant.parse(p.get("sourceVersion").asText()) : null;
        InventoryApplier.Result r = inventory.apply(tenantId, productId, mode, p.get("quantity").asInt(), sv,
                p.path("reason").asText("WEBHOOK"), p.path("reference").asText(null), "carpip-inventory", e.get("eventId").asText());
        log.debug("inventory {} -> {} ({})", productId, r.outcome(), r.after());
    }

    @KafkaListener(topics = "sales.events", groupId = "carpip-sales", id = "carpip-sales")
    public void onSale(String value) {
        JsonNode e = envelope(value);
        JsonNode p = e.get("payload");
        UUID tenantId = UUID.fromString(e.get("tenantId").asText());
        sales.record(tenantId, UUID.fromString(p.get("productId").asText()), e.path("source").path("system").asText("unknown"),
                p.get("externalOrderId").asText(), p.get("externalLineId").asText(), p.get("quantity").asInt(),
                p.hasNonNull("unitPrice") ? Money.bd(p.get("unitPrice").asText()) : null, p.path("isRefund").asBoolean(false),
                Instant.parse(p.get("occurredAt").asText()), "carpip-sales", e.get("eventId").asText());
    }
}
