package com.carpip.erp;

import com.carpip.common.Hmac;
import com.carpip.common.Json;
import com.carpip.common.Money;
import com.carpip.domain.Product;
import com.carpip.domain.Repos;
import com.carpip.inventory.InventoryService;
import com.carpip.inventory.SalesService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Path B ingestion: POST /api/v1/inventory and /api/v1/orders. Payloads may be arbitrary: a per-connection
 * fieldMap (config.fieldMap) renames external field names to the canonical ones before validation.
 * Bad rows are reported per row; good rows are applied (202 with accepted / duplicates / rejected).
 */
@Service
public class InventoryBatchService {
    private final Repos.ProductRepo products;
    private final Repos.ConnectionRepo connections;
    private final ProductSyncService productSync;
    private final InventoryService inventory;
    private final SalesService sales;
    private final JdbcTemplate jdbc;

    public InventoryBatchService(Repos.ProductRepo products, Repos.ConnectionRepo connections, ProductSyncService productSync,
                                 InventoryService inventory, SalesService sales, JdbcTemplate jdbc) {
        this.products = products;
        this.connections = connections;
        this.productSync = productSync;
        this.inventory = inventory;
        this.sales = sales;
        this.jdbc = jdbc;
    }

    /** @return null if first time; "SAME" for an exact replay; "MISMATCH" if the key was used with a different body. */
    public String checkIdempotency(UUID tenantId, String key, byte[] body) {
        if (key == null || key.isBlank()) {
            return null;
        }
        String hash = Hmac.sha256Hex(new String(body, java.nio.charset.StandardCharsets.UTF_8));
        int n = jdbc.update("INSERT INTO processed_event(consumer_group, event_id) VALUES (?,?) ON CONFLICT DO NOTHING", "idem:" + tenantId, key);
        if (n > 0) {
            jdbc.update("INSERT INTO processed_event(consumer_group, event_id) VALUES (?,?) ON CONFLICT DO NOTHING", "idemhash:" + tenantId + ":" + key, hash);
            return null;
        }
        Integer same = jdbc.queryForObject("SELECT count(*) FROM processed_event WHERE consumer_group=? AND event_id=?", Integer.class, "idemhash:" + tenantId + ":" + key, hash);
        return same != null && same > 0 ? "SAME" : "MISMATCH";
    }

    @SuppressWarnings("unchecked")
    private JsonNode mapped(UUID tenantId, JsonNode item) {
        Map<String, Object> fm = connections.findByTenantId(tenantId).map(c -> c.config).map(cfg -> cfg.get("fieldMap"))
                .filter(o -> o instanceof Map).map(o -> (Map<String, Object>) o).orElse(Map.of());
        if (fm.isEmpty() || !item.isObject()) {
            return item;
        }
        com.fasterxml.jackson.databind.node.ObjectNode out = Json.M.createObjectNode();
        item.fields().forEachRemaining(e -> out.set(e.getKey(), e.getValue()));
        fm.forEach((canonical, external) -> {
            JsonNode v = item.get(String.valueOf(external));
            if (v != null && !out.has(canonical)) {
                out.set(canonical, v);
            }
        });
        return out;
    }

    private Optional<Product> find(UUID tenantId, JsonNode item) {
        String sku = item.path("sku").asText("");
        if (!sku.isBlank()) {
            Optional<Product> p = products.findByTenantIdAndSku(tenantId, sku);
            if (p.isPresent()) {
                return p;
            }
        }
        String gtin = item.path("gtin").asText("");
        if (!gtin.isBlank()) {
            return products.findByTenantIdAndGtin(tenantId, gtin);
        }
        return Optional.empty();
    }

    public Map<String, Object> inventory(UUID tenantId, JsonNode body) {
        List<Map<String, Object>> rejected = new ArrayList<>();
        int accepted = 0;
        JsonNode items = body.path("items");
        if (!items.isArray()) {
            throw new IllegalArgumentException("items[] is required");
        }
        String batchId = body.path("batchId").asText(UUID.randomUUID().toString());
        for (int i = 0; i < items.size(); i++) {
            JsonNode it = mapped(tenantId, items.get(i));
            try {
                if (!it.hasNonNull("quantity")) {
                    rejected.add(row(i, "MISSING_QUANTITY", "quantity is required"));
                    continue;
                }
                String mode = it.path("mode").asText("ABSOLUTE").toUpperCase();
                if (!mode.equals("ABSOLUTE") && !mode.equals("DELTA")) {
                    rejected.add(row(i, "BAD_MODE", "mode must be ABSOLUTE or DELTA"));
                    continue;
                }
                Optional<Product> p = find(tenantId, it);
                if (p.isEmpty()) {
                    p = productSync.upsertFromPush(tenantId, it);
                }
                if (p.isEmpty()) {
                    rejected.add(row(i, "UNKNOWN_SKU", "unknown sku/gtin and no 'name' supplied to auto-create it"));
                    continue;
                }
                Instant asOf = it.hasNonNull("asOf") ? Instant.parse(it.get("asOf").asText()) : (it.hasNonNull("ts") ? Instant.parse(it.get("ts").asText()) : null);
                if (asOf == null && mode.equals("ABSOLUTE")) {
                    asOf = Instant.now();
                }
                // DELTA items are deduped per (batchId,index); ABSOLUTE ones by their asOf version
                String dedupe = mode.equals("DELTA") ? "api-inv:" + tenantId : null;
                String evId = mode.equals("DELTA") ? batchId + ":" + i : null;
                var r = inventory.apply(tenantId, p.get().id, mode, it.get("quantity").asInt(), asOf, "API", batchId, dedupe, evId);
                if (r.outcome() == com.carpip.inventory.InventoryApplier.Outcome.DUPLICATE) {
                    rejected.add(row(i, "DUPLICATE", "already applied"));
                } else {
                    accepted++;
                }
            } catch (RuntimeException e) {
                rejected.add(row(i, "ERROR", String.valueOf(e.getMessage())));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("batchId", batchId);
        out.put("accepted", accepted);
        out.put("rejected", rejected);
        return out;
    }

    public Map<String, Object> orders(UUID tenantId, JsonNode body) {
        String orderId = body.path("orderId").asText(null);
        if (orderId == null || !body.path("lines").isArray()) {
            throw new IllegalArgumentException("orderId and lines[] are required");
        }
        Instant at = body.hasNonNull("occurredAt") ? Instant.parse(body.get("occurredAt").asText()) : Instant.now();
        boolean adjust = body.path("adjustStock").asBoolean(false);
        List<Map<String, Object>> rejected = new ArrayList<>();
        int accepted = 0;
        JsonNode lines = body.get("lines");
        for (int i = 0; i < lines.size(); i++) {
            JsonNode l = mapped(tenantId, lines.get(i));
            try {
                Optional<Product> p = find(tenantId, l);
                if (p.isEmpty()) {
                    rejected.add(row(i, "UNKNOWN_SKU", "unknown sku/gtin"));
                    continue;
                }
                int qty = l.path("quantity").asInt(0);
                if (qty <= 0) {
                    rejected.add(row(i, "BAD_QUANTITY", "quantity must be > 0"));
                    continue;
                }
                String lineId = l.path("lineId").asText(String.valueOf(i));
                boolean fresh = sales.record(tenantId, p.get().id, "pos-legacy", orderId, lineId, qty,
                        l.hasNonNull("unitPrice") ? Money.bd(l.get("unitPrice").asText()) : null, false, at, null, null);
                if (fresh && adjust) {
                    inventory.apply(tenantId, p.get().id, "DELTA", -qty, null, "SALE", orderId, "api-orders:" + tenantId, orderId + ":" + lineId);
                }
                if (fresh) {
                    accepted++;
                } else {
                    rejected.add(row(i, "DUPLICATE", "line already recorded"));
                }
            } catch (RuntimeException e) {
                rejected.add(row(i, "ERROR", String.valueOf(e.getMessage())));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("orderId", orderId);
        out.put("accepted", accepted);
        out.put("rejected", rejected);
        return out;
    }

    private static Map<String, Object> row(int idx, String code, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("index", idx);
        m.put("code", code);
        m.put("detail", detail);
        return m;
    }
}
