package com.carpip.demo;

import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import com.carpip.common.ApiException;
import com.carpip.common.Json;
import com.carpip.events.DemoState;
import com.carpip.events.KafkaOps;
import com.carpip.events.OutboxRelay;
import com.carpip.procurement.IntelligenceClient;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.listener.MessageListenerContainer;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.sql.Date;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Operations console: system health, dead letters, time-scale, negotiation mode, history import, demo scenarios, metrics. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final KafkaOps kafkaOps;
    private final OutboxRelay relay;
    private final DemoState demoState;
    private final KafkaListenerEndpointRegistry registry;
    private final IntelligenceClient engine;
    private final com.carpip.config.AppProps props;
    private final String posUrl;
    private final String posToken;
    private final String erpUrl;
    private final String erpToken;

    public AdminController(JdbcTemplate jdbc, StringRedisTemplate redis, KafkaOps kafkaOps, OutboxRelay relay, DemoState demoState,
                           KafkaListenerEndpointRegistry registry, IntelligenceClient engine, com.carpip.config.AppProps props,
                           @Value("${demo.pos-url:http://pos-backend:4000}") String posUrl,
                           @Value("${demo.pos-admin-token:}") String posToken,
                           @Value("${demo.erp-url:http://erp-backend:8000}") String erpUrl,
                           @Value("${demo.erp-admin-token:}") String erpToken) {
        this.jdbc = jdbc;
        this.redis = redis;
        this.kafkaOps = kafkaOps;
        this.relay = relay;
        this.demoState = demoState;
        this.registry = registry;
        this.engine = engine;
        this.props = props;
        this.posUrl = posUrl;
        this.posToken = posToken;
        this.erpUrl = erpUrl;
        this.erpToken = erpToken;
    }

    // ----------------------------------------------------------------- health
    @GetMapping("/system/health")
    public Map<String, Object> health() {
        TenantContext.requireRole("ADMIN");
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> services = new LinkedHashMap<>();
        services.put("postgres", probe(() -> jdbc.queryForObject("SELECT 1", Integer.class) == 1));
        services.put("redis", probe(() -> "PONG".equalsIgnoreCase(redis.getConnectionFactory().getConnection().ping())));
        Map<String, Object> kafka = kafkaOps.health();
        services.put("kafka", Boolean.TRUE.equals(kafka.get("up")));
        Map<String, Object> intel = new LinkedHashMap<>();
        try {
            intel.put("health", engine.get("/health"));
            intel.put("llm", engine.get("/api/llm/status"));
            services.put("intelligence", true);
        } catch (Exception e) {
            services.put("intelligence", false);
            intel.put("error", e.getMessage());
        }
        out.put("services", services);
        out.put("kafka", kafka);
        out.put("intelligence", intel);
        Map<String, Object> outbox = new LinkedHashMap<>();
        outbox.put("backlog", relay.backlog());
        outbox.put("lastError", relay.lastError());
        outbox.put("relayPaused", demoState.relayPaused.get());
        outbox.put("consumersPaused", demoState.consumersPaused.get());
        out.put("outbox", outbox);
        out.put("connections", jdbc.queryForList("SELECT t.name, c.type, c.direction, c.health, c.last_sync_at, c.last_error FROM integration_connection c JOIN tenant t ON t.id=c.tenant_id ORDER BY t.name"));
        out.put("writebacks", jdbc.queryForMap("SELECT count(*) FILTER (WHERE status='PENDING') AS pending, count(*) FILTER (WHERE status='DEAD') AS dead, count(*) FILTER (WHERE status='DONE') AS done FROM writeback_task"));
        out.put("purchaseOrders", jdbc.queryForList("SELECT status, count(*) AS n FROM purchase_order GROUP BY status ORDER BY status"));
        out.put("timeScale", jdbc.queryForObject("SELECT (value #>> '{}')::float8 FROM system_setting WHERE key='demo.time_scale'", Double.class));
        out.put("negotiationMode", jdbc.queryForObject("SELECT value #>> '{}' FROM system_setting WHERE key='negotiation.mode'", String.class));
        return out;
    }

    private boolean probe(java.util.concurrent.Callable<Boolean> c) {
        try {
            return Boolean.TRUE.equals(c.call());
        } catch (Exception e) {
            return false;
        }
    }

    // ----------------------------------------------------------------- dead letters
    @GetMapping("/dlq")
    public Map<String, Object> dlq() {
        TenantContext.requireRole("ADMIN");
        return (Map<String, Object>) kafkaOps.health().getOrDefault("deadLetters", Map.of());
    }

    @GetMapping("/dlq/{topic}")
    public List<Map<String, Object>> peek(@PathVariable String topic, @RequestParam(defaultValue = "0") long from, @RequestParam(defaultValue = "50") int max) {
        TenantContext.requireRole("ADMIN");
        return kafkaOps.peek(topic, from, Math.min(max, 200));
    }

    @PostMapping("/dlq/{topic}/replay")
    public Map<String, Object> replay(@PathVariable String topic, @RequestParam long offset) {
        TenantContext.requireRole("ADMIN");
        return kafkaOps.replay(topic, offset);
    }

    // ----------------------------------------------------------------- settings
    public record TimeScale(double scale) {
    }

    public record Mode(String mode) {
    }

    public record Paused(boolean paused) {
    }

    @PutMapping("/demo/time-scale")
    public Map<String, Object> timeScale(@RequestBody TimeScale req) {
        TenantContext.requireRole("ADMIN");
        double s = Math.min(Math.max(req.scale(), 1), 3600);
        jdbc.update("INSERT INTO system_setting(key,value) VALUES ('demo.time_scale', to_jsonb(?::float8)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", s);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("scale", s);
        try {
            out.put("intelligence", engine.put("/api/demo/time-scale", Map.of("scale", s)));
        } catch (Exception e) {
            out.put("intelligenceError", e.getMessage());
        }
        return out;
    }

    @PutMapping("/settings/negotiation-mode")
    public Map<String, Object> negotiationMode(@RequestBody Mode req) {
        TenantContext.requireRole("ADMIN");
        String m = req.mode() == null ? "" : req.mode().toLowerCase();
        if (!List.of("llm", "rule", "off").contains(m)) {
            throw ApiException.bad("BAD_REQUEST", "mode must be llm | rule | off");
        }
        jdbc.update("INSERT INTO system_setting(key,value) VALUES ('negotiation.mode', to_jsonb(?::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", m);
        return Map.of("mode", m);
    }

    @PostMapping("/demo/kafka")
    public Map<String, Object> kafka(@RequestBody Paused req) {
        TenantContext.requireRole("ADMIN");
        demoState.relayPaused.set(req.paused());
        demoState.consumersPaused.set(req.paused());
        for (String id : List.of("carpip-inventory", "carpip-sales", "carpip-procurement")) {
            MessageListenerContainer c = registry.getListenerContainer(id);
            if (c != null) {
                if (req.paused()) {
                    c.pause();
                } else {
                    c.resume();
                }
            }
        }
        return Map.of("paused", req.paused());
    }

    // ----------------------------------------------------------------- history import (bootstrap)
    @PostMapping("/import/sales-history")
    public Map<String, Object> importHistory(@RequestBody byte[] raw) {
        TenantContext.requireRole("ADMIN");
        String[] lines = new String(raw, java.nio.charset.StandardCharsets.UTF_8).split("\n");
        Map<String, UUID> cache = new HashMap<>();
        List<Object[]> batch = new ArrayList<>();
        int skipped = 0;
        int imported = 0;
        String sql = "INSERT INTO sales_daily(tenant_id, product_id, day, units, revenue) VALUES (?,?,?,?,?) " +
                "ON CONFLICT (product_id, day) DO UPDATE SET units = EXCLUDED.units, revenue = EXCLUDED.revenue";
        for (String line : lines) {
            if (line.isBlank()) {
                continue;
            }
            JsonNode n = Json.read(line);
            UUID tenant = UUID.fromString(n.get("tenantId").asText());
            String key = tenant + "|" + n.get("gtin").asText();
            UUID pid = cache.computeIfAbsent(key, k -> jdbc.queryForList("SELECT id FROM product WHERE tenant_id=? AND gtin=?", UUID.class, tenant, n.get("gtin").asText())
                    .stream().findFirst().orElse(null));
            if (pid == null) {
                skipped++;
                continue;
            }
            batch.add(new Object[]{tenant, pid, Date.valueOf(n.get("day").asText()), n.get("units").asInt(), new BigDecimal(n.path("revenue").asText("0"))});
            imported++;
            if (batch.size() >= 2000) {
                jdbc.batchUpdate(sql, batch);
                batch.clear();
            }
        }
        if (!batch.isEmpty()) {
            jdbc.batchUpdate(sql, batch);
        }
        return Map.of("imported", imported, "skippedUnknownGtin", skipped);
    }

    @PostMapping("/import/competitor-prices")
    public Map<String, Object> importCompetitorPrices(@RequestBody byte[] raw) {
        TenantContext.requireRole("ADMIN");
        List<Object[]> batch = new ArrayList<>();
        for (String line : new String(raw, java.nio.charset.StandardCharsets.UTF_8).split("\n")) {
            if (line.isBlank()) {
                continue;
            }
            JsonNode n = Json.read(line);
            batch.add(new Object[]{n.get("gtin").asText(), new BigDecimal(n.get("price").asText()), n.path("daysAgo").asInt(0)});
        }
        jdbc.batchUpdate("INSERT INTO competitor_price(gtin, price, at) VALUES (?,?, now() - make_interval(days => ?))", batch);
        return Map.of("imported", batch.size());
    }

    // ----------------------------------------------------------------- scenarios
    public record Scenario(Map<String, Object> params) {
    }

    @PostMapping("/demo/scenarios/{name}")
    public Map<String, Object> scenario(@PathVariable String name, @RequestBody(required = false) Scenario req) {
        TenantContext.requireRole("ADMIN");
        if (!props.demoMode()) {
            throw ApiException.forbidden("demo mode is disabled");
        }
        Map<String, Object> p = req == null || req.params() == null ? new HashMap<>() : new HashMap<>(req.params());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("scenario", name);
        switch (name) {
            case "sales-spike" -> {
                out.put("triggered", pos("/pos/demo/sales-burst", p));
                out.put("expect", "One PO per SKU (never duplicates), Kafka lag spikes then drains, negotiations queue behind the LLM semaphore.");
            }
            case "supplier-stockout" -> {
                out.put("triggered", erp("/erp/demo/stockout", p));
                out.put("expect", "Supplier availability drops: SA falls, MPI rises, ranking excludes or demotes it; an open PO is declined and rerouted to rank #2.");
            }
            case "price-hike" -> {
                out.put("triggered", erp("/erp/demo/price-change", p));
                out.put("expect", "Price volatility (PV) rises, supplier floor price rises, new negotiations settle higher.");
            }
            case "bedrock-outage" -> {
                p.putIfAbsent("mode", "throttle");
                out.put("triggered", engine.post("/api/demo/llm-fault", p));
                out.put("expect", "LLM turns fall back to deterministic rule turns (source=RULE); negotiations still complete within bounds; RULE-ONLY banner appears.");
            }
            case "kafka-outage" -> {
                boolean paused = !Boolean.FALSE.equals(p.get("paused"));
                kafka(new Paused(paused));
                out.put("triggered", Map.of("paused", paused));
                out.put("expect", paused ? "Webhooks still return 200; outbox backlog grows; consumers idle. Resume to watch it drain and stock converge."
                        : "Backlog drains in order; stock levels converge with the POS.");
            }
            case "webhook-replay" -> {
                p.putIfAbsent("mode", "same");
                out.put("triggered", pos("/pos/demo/webhooks/replay", p));
                out.put("expect", "same id -> 200 duplicate; new id -> accepted but content-idempotent (no double sale); tampered -> 401 + audit entry; stale -> 401.");
            }
            case "out-of-order" -> {
                out.put("triggered", pos("/pos/demo/out-of-order", p));
                out.put("expect", "Older inventory update is ignored (STALE_IGNORED in stock movements); final stock equals the newest value.");
            }
            case "partial-shipment" -> {
                p.putIfAbsent("enabled", true);
                out.put("triggered", erp("/erp/demo/partial-shipment", p));
                out.put("expect", "Next PO is PARTIALLY_CONFIRMED (60%); a replan PO is raised for the gap.");
            }
            case "webhooks-down" -> {
                p.putIfAbsent("paused", true);
                out.put("triggered", pos("/pos/demo/webhooks/pause", p));
                out.put("expect", "POS stops delivering webhooks; polling reconciles within one interval and the connection shows WEBHOOK_DEGRADED.");
            }
            case "cdin-node-offline" -> {
                out.put("triggered", engine.post("/api/demo/cdin-offline", p));
                out.put("expect", "Next CDIN round completes with 2 of 3 nodes (quorum met); below quorum the round FAILS and the global model is unchanged.");
            }
            default -> throw ApiException.bad("UNKNOWN_SCENARIO", "unknown scenario " + name);
        }
        return out;
    }

    private Object pos(String path, Map<String, Object> body) {
        return external(posUrl + path, "X-Admin-Token", posToken, body);
    }

    private Object erp(String path, Map<String, Object> body) {
        return external(erpUrl + path, "X-Admin-Token", erpToken, body);
    }

    private Object external(String url, String header, String token, Map<String, Object> body) {
        try {
            com.carpip.erp.Http.Resp r = com.carpip.erp.Http.post(url, Map.of(header, token), Json.write(body));
            if (!r.ok()) {
                throw new ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY, "SCENARIO_FAILED", url + " -> HTTP " + r.status() + " " + r.body());
            }
            return r.json();
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY, "SCENARIO_FAILED", url + ": " + e.getMessage());
        }
    }

    // ----------------------------------------------------------------- metrics
    @GetMapping("/metrics")
    public Map<String, Object> metrics() {
        TenantContext.requireRole("ADMIN");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("negotiationByMode", jdbc.queryForList(
                "SELECT mode, count(*) AS negotiations, " +
                        "round(100.0 * count(*) FILTER (WHERE status='ACCEPTED') / NULLIF(count(*),0), 1) AS success_pct, " +
                        "round(avg(CASE WHEN status='ACCEPTED' AND base_price > 0 THEN 100.0 * (base_price - final_price) / base_price END)::numeric, 2) AS avg_discount_pct, " +
                        "round(avg(latency_ms)) AS avg_latency_ms, sum(tokens_in) AS tokens_in, sum(tokens_out) AS tokens_out, sum(guardrail_interventions) AS guardrail_interventions " +
                        "FROM negotiation GROUP BY mode ORDER BY mode"));
        out.put("poOutcomes", jdbc.queryForList("SELECT status, count(*) AS n, COALESCE(sum(discount_savings),0) AS savings FROM purchase_order GROUP BY status ORDER BY n DESC"));
        out.put("ingest", jdbc.queryForMap("SELECT count(*) AS inbound_events, count(*) FILTER (WHERE status='DUPLICATE' OR status='IGNORED') AS ignored FROM inbound_event"));
        out.put("stockMovements24h", jdbc.queryForList("SELECT reason, count(*) AS n FROM stock_movement WHERE at > now() - interval '24 hours' GROUP BY reason ORDER BY n DESC"));
        out.put("audit24h", jdbc.queryForList("SELECT action, count(*) AS n FROM audit_log WHERE at > now() - interval '24 hours' GROUP BY action ORDER BY n DESC LIMIT 15"));
        return out;
    }

    @GetMapping("/tenant-stats")
    public List<Map<String, Object>> tenantStats() {
        TenantContext.requireRole("ADMIN");
        return jdbc.queryForList("SELECT t.id, t.name, t.type, (SELECT count(*) FROM product p WHERE p.tenant_id = t.id) AS products, " +
                "(SELECT count(*) FROM supplier_offer o WHERE o.wholesaler_tenant_id = t.id AND o.active) AS offers FROM tenant t WHERE t.type <> 'ADMIN' ORDER BY t.name");
    }

    @GetMapping("/audit")
    public List<Map<String, Object>> audit(@RequestParam(defaultValue = "100") int limit) {
        Principal p = TenantContext.requireUser();
        int l = Math.min(Math.max(limit, 1), 500);
        if (p.isAdmin()) {
            return jdbc.queryForList("SELECT a.at, a.action, a.actor_type, a.actor_id, a.entity_type, a.entity_id, a.detail::text AS detail, t.name AS tenant " +
                    "FROM audit_log a LEFT JOIN tenant t ON t.id = a.tenant_id ORDER BY a.at DESC LIMIT " + l);
        }
        return jdbc.queryForList("SELECT a.at, a.action, a.actor_type, a.actor_id, a.entity_type, a.entity_id, a.detail::text AS detail FROM audit_log a " +
                "WHERE a.tenant_id = ? ORDER BY a.at DESC LIMIT " + l, p.tenantId());
    }
}
