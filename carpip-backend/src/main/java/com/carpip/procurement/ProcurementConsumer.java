package com.carpip.procurement;

import com.carpip.common.Json;
import com.carpip.common.Money;
import com.carpip.domain.Product;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import com.carpip.events.OutboxService;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** procurement.requests consumer: builds the lean payload, calls the Flask engine, persists the outcome. */
@Component
public class ProcurementConsumer {
    private static final Logger log = LoggerFactory.getLogger(ProcurementConsumer.class);
    private static final int MAX_ENGINE_ATTEMPTS = 5;

    private final Repos.PurchaseOrderRepo pos;
    private final Repos.ProductRepo products;
    private final Repos.TenantRepo tenants;
    private final ProcurementService procurement;
    private final ProcurementResultService results;
    private final IntelligenceClient engine;
    private final JdbcTemplate jdbc;
    private final PurchaseOrderService poService;
    private final OutboxService outbox;
    private final TransactionTemplate tx;

    public ProcurementConsumer(Repos.PurchaseOrderRepo pos, Repos.ProductRepo products, Repos.TenantRepo tenants,
                               ProcurementService procurement, ProcurementResultService results, IntelligenceClient engine,
                               JdbcTemplate jdbc, PurchaseOrderService poService, OutboxService outbox, TransactionTemplate tx) {
        this.pos = pos;
        this.products = products;
        this.tenants = tenants;
        this.procurement = procurement;
        this.results = results;
        this.engine = engine;
        this.jdbc = jdbc;
        this.poService = poService;
        this.outbox = outbox;
        this.tx = tx;
    }

    @KafkaListener(topics = "procurement.requests", groupId = "carpip-procurement", id = "carpip-procurement", concurrency = "2")
    public void onRequest(String value) {
        JsonNode e = Json.read(value);
        if (!e.has("payload") || !e.path("payload").hasNonNull("poId")) {
            throw new IllegalArgumentException("malformed procurement request");
        }
        run(UUID.fromString(e.get("payload").get("poId").asText()));
    }

    public void run(UUID poId) {
        PurchaseOrder po = pos.findById(poId).orElse(null);
        if (po == null || !"NEGOTIATING".equals(po.status)) {
            return; // redelivery after success, cancelled, etc.
        }
        Product p = products.findById(po.productId).orElseThrow(() -> new IllegalArgumentException("unknown product"));
        Tenant retailer = tenants.findById(po.retailerTenantId).orElseThrow();
        List<Map<String, Object>> candidates = procurement.candidates(p);
        UUID runId = UUID.randomUUID();
        Map<String, Object> req = procurement.buildRequest(po, p, retailer, candidates, procurement.negotiationMode());
        jdbc.update("INSERT INTO procurement_run(id, tenant_id, product_id, po_id, trigger, request) VALUES (?,?,?,?,?,?::jsonb)",
                runId, po.retailerTenantId, p.id, po.id, po.trigger, Json.write(req));
        if (candidates.isEmpty()) {
            results.noSuppliers(po.id, runId);
            return;
        }
        Map<String, Object> resp;
        try {
            resp = engine.negotiate(req);
        } catch (Exception ex) {
            log.warn("engine call failed for PO {}: {}", po.poNumber, ex.getMessage());
            results.markError(po.id, runId, abbreviate(ex.getMessage()));
            return;
        }
        results.apply(po.id, runId, resp);
    }

    /** NEGOTIATION_ERROR POs are retried; after repeated failures a stock-out falls back to a list-price PO needing approval. */
    @Scheduled(fixedDelay = 20_000, initialDelay = 45_000)
    public void retryFailed() {
        try {
            List<UUID> ids = jdbc.queryForList("SELECT id FROM purchase_order WHERE status='NEGOTIATION_ERROR' AND updated_at < now() - interval '25 seconds' LIMIT 20", UUID.class);
            for (UUID id : ids) {
                PurchaseOrder po = pos.findById(id).orElse(null);
                if (po == null || !"NEGOTIATION_ERROR".equals(po.status)) {
                    continue;
                }
                int attempts = po.decision != null && po.decision.get("attempts") instanceof Number n ? n.intValue() : 1;
                Product p = products.findById(po.productId).orElse(null);
                if (attempts >= MAX_ENGINE_ATTEMPTS && p != null) {
                    tx.executeWithoutResult(s -> degrade(po.id));
                } else {
                    tx.executeWithoutResult(s -> {
                        PurchaseOrder fresh = pos.findById(id).orElseThrow();
                        poService.transition(fresh, "NEGOTIATING", "retry engine call", "system");
                        outbox.publish("procurement.requests", fresh.retailerTenantId + ":" + fresh.productId, "procurement.requested",
                                fresh.retailerTenantId, Map.of("system", "carpip"), Map.of("poId", fresh.id, "productId", fresh.productId, "trigger", "RETRY"));
                    });
                }
            }
        } catch (Exception e) {
            log.warn("retry job failed: {}", e.getMessage());
        }
    }

    /** Degraded mode: engine unavailable too long. Order the most reliable cheap supplier at list price, pending human approval. */
    private void degrade(UUID poId) {
        PurchaseOrder po = pos.findById(poId).orElseThrow();
        Product p = products.findById(po.productId).orElseThrow();
        List<Map<String, Object>> cands = procurement.candidates(p);
        Map<String, Object> best = null;
        for (Map<String, Object> c : cands) {
            if (((Number) c.get("availableQty")).intValue() <= 0) {
                continue;
            }
            if (best == null || Money.bd(c.get("reliability")).compareTo(Money.bd(best.get("reliability"))) > 0) {
                best = c;
            }
        }
        if (best == null) {
            poService.transition(po, "NEGOTIATING", "degraded fallback: re-checking suppliers", "system");
            results.noSuppliers(po.id, null);
            return;
        }
        int moq = ((Number) best.get("moq")).intValue();
        int pack = Math.max(1, ((Number) best.get("packSize")).intValue());
        int qty = Math.max(po.quantity, moq);
        qty = ((qty + pack - 1) / pack) * pack;
        qty = Math.min(qty, ((Number) best.get("availableQty")).intValue());
        qty = (qty / pack) * pack;
        po.wholesalerTenantId = UUID.fromString((String) best.get("supplierTenantId"));
        po.unitPriceAgreed = Money.bd(best.get("listPrice"));
        po.basePrice = po.unitPriceAgreed;
        po.quantity = Math.max(qty, moq);
        po.totalAmount = Money.round2(po.unitPriceAgreed.multiply(java.math.BigDecimal.valueOf(po.quantity)));
        po.negotiationStatus = "SKIPPED";
        po.degraded = true;
        po.decision = new HashMap<>(Map.of("outcome", "DEGRADED", "note", "cognitive engine unavailable; list-price order awaiting approval"));
        poService.transition(po, "PENDING_APPROVAL", "DEGRADED: engine unavailable, list-price order", "system");
    }

    private static String abbreviate(String s) {
        return s == null ? "unknown error" : s.length() > 300 ? s.substring(0, 300) : s;
    }
}
