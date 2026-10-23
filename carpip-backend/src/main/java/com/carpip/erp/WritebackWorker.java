package com.carpip.erp;

import com.carpip.audit.AuditService;
import com.carpip.common.Json;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Product;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import com.carpip.procurement.PurchaseOrderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Executes durable writebacks (paper step 6 "PO writeback"): submit/cancel POs at the wholesaler's ERP,
 * push incoming-stock notices and stock receipts to the retailer's POS. Exponential backoff, DEAD after 10 attempts.
 */
@Component
public class WritebackWorker {
    private static final Logger log = LoggerFactory.getLogger(WritebackWorker.class);
    private static final int MAX_ATTEMPTS = 10;

    private final JdbcTemplate jdbc;
    private final Repos.ConnectionRepo connections;
    private final Repos.PurchaseOrderRepo pos;
    private final Repos.ProductRepo products;
    private final Repos.TenantRepo tenants;
    private final AdapterRegistry adapters;
    private final PurchaseOrderService poService;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public WritebackWorker(JdbcTemplate jdbc, Repos.ConnectionRepo connections, Repos.PurchaseOrderRepo pos, Repos.ProductRepo products,
                           Repos.TenantRepo tenants, AdapterRegistry adapters, PurchaseOrderService poService, AuditService audit, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.connections = connections;
        this.pos = pos;
        this.products = products;
        this.tenants = tenants;
        this.adapters = adapters;
        this.poService = poService;
        this.audit = audit;
        this.tx = tx;
    }

    @Scheduled(fixedDelay = 1000, initialDelay = 5000)
    public void run() {
        List<Map<String, Object>> due = jdbc.queryForList(
                "SELECT id, connection_id, po_id, kind, idempotency_key, payload::text AS payload, attempts FROM writeback_task " +
                        "WHERE status='PENDING' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20");
        for (Map<String, Object> t : due) {
            try {
                process(t);
            } catch (Exception e) {
                log.error("writeback task {} crashed: {}", t.get("id"), e.toString());
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void process(Map<String, Object> t) {
        UUID id = (UUID) t.get("id");
        String kind = (String) t.get("kind");
        UUID poId = (UUID) t.get("po_id");
        int attempts = ((Number) t.get("attempts")).intValue();
        IntegrationConnection c = connections.findById((UUID) t.get("connection_id")).orElse(null);
        PurchaseOrder po = poId == null ? null : pos.findById(poId).orElse(null);
        if (c == null || po == null) {
            finish(id, "DEAD", "connection or purchase order missing", null);
            return;
        }
        // skip obsolete tasks
        if ("SUBMIT_PO".equals(kind) && !"APPROVED".equals(po.status)) {
            finish(id, "DONE", "skipped: PO is " + po.status, null);
            return;
        }
        if ("CANCEL_PO".equals(kind) && po.externalRef == null) {
            finish(id, "DONE", "skipped: PO was never accepted by the supplier system", null);
            return;
        }
        Map<String, Object> payload = Json.map((String) t.get("payload"));
        try {
            Map<String, Object> view = buildView(kind, po, c, payload, (String) t.get("idempotency_key"));
            Map<String, Object> resp = adapters.get(c.type).writeback(c, kind, view);
            onSuccess(kind, po, payload, resp);
            finish(id, "DONE", null, resp);
            if (c.health != null && !"OK".equals(c.health) && !"STALE".equals(c.health)) {
                c.health = "OK";
                c.lastError = null;
                connections.save(c);
            }
        } catch (Exception e) {
            int next = attempts + 1;
            String msg = e.getMessage() == null ? e.toString() : e.getMessage();
            if (next >= MAX_ATTEMPTS) {
                finish(id, "DEAD", msg, null);
                audit.log(po.retailerTenantId, "SYSTEM", "writeback", "WRITEBACK_DEAD", "purchase_order", po.poNumber, Map.of("kind", kind, "error", abbreviate(msg)));
                log.error("writeback {} for {} is DEAD after {} attempts: {}", kind, po.poNumber, next, msg);
            } else {
                long delay = Math.min(300, (long) Math.pow(2, next));
                jdbc.update("UPDATE writeback_task SET attempts=?, last_error=?, next_attempt_at=?, updated_at=now() WHERE id=?",
                        next, abbreviate(msg), Timestamp.from(Instant.now().plusSeconds(delay)), id);
                log.warn("writeback {} for {} failed (attempt {}), retry in {}s: {}", kind, po.poNumber, next, delay, msg);
            }
            c.health = "ERROR";
            c.lastError = abbreviate(msg);
            connections.save(c);
        }
    }

    private void onSuccess(String kind, PurchaseOrder po, Map<String, Object> payload, Map<String, Object> resp) {
        switch (kind) {
            case "SUBMIT_PO" -> tx.executeWithoutResult(s -> {
                PurchaseOrder fresh = pos.findById(po.id).orElseThrow();
                Object ref = resp.get("salesOrderId");
                if (ref != null) {
                    fresh.externalRef = ref.toString();
                }
                if ("APPROVED".equals(fresh.status)) {
                    poService.transition(fresh, "SUBMITTED", "submitted to supplier ERP", "system");
                } else {
                    pos.save(fresh); // supplier already acted (implicit SUBMITTED): just keep the reference
                }
            });
            case "ADJUST_STOCK" -> poService.onReceiptApplied(po.id, ((Number) payload.getOrDefault("qty", 0)).intValue());
            default -> {
            }
        }
    }

    private Map<String, Object> buildView(String kind, PurchaseOrder po, IntegrationConnection c, Map<String, Object> payload, String idemKey) {
        Product p = products.findById(po.productId).orElseThrow();
        Tenant retailer = tenants.findById(po.retailerTenantId).orElseThrow();
        Tenant wholesaler = po.wholesalerTenantId == null ? null : tenants.findById(po.wholesalerTenantId).orElse(null);
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("idempotencyKey", idemKey);
        v.put("poNumber", po.poNumber);
        v.put("status", payload.getOrDefault("status", po.status));
        v.put("sku", p.sku);
        v.put("gtin", p.gtin);
        v.put("name", p.name);
        v.put("productId", p.id);
        v.put("inventoryItemId", p.externalIds == null ? null : p.externalIds.get("inventory_item_id"));
        v.put("currency", po.currency);
        v.put("unitPrice", po.unitPriceAgreed);
        v.put("unitCost", po.unitPriceAgreed);
        v.put("quantity", po.quantity);
        v.put("quantityOrdered", po.quantity);
        v.put("quantityExpected", po.qtyConfirmed == null ? po.quantity : po.qtyConfirmed);
        v.put("quantityShipped", po.qtyShipped);
        v.put("expectedDelivery", po.expectedDeliveryDate == null ? null : po.expectedDeliveryDate.toString());
        v.put("eta", po.expectedDeliveryDate == null ? null : po.expectedDeliveryDate.toString());
        v.put("externalRef", po.externalRef);
        v.put("reason", payload.get("reason"));
        v.put("retailerName", retailer.name);
        v.put("retailerPublicId", retailer.publicId);
        v.put("supplierName", wholesaler == null ? null : wholesaler.name);
        if (payload.containsKey("qty")) {
            v.put("qty", payload.get("qty"));
            v.put("quantityReceived", payload.get("qty"));
        }
        if (po.wholesalerTenantId != null && p.gtin != null) {
            List<String> sk = jdbc.queryForList("SELECT supplier_sku FROM supplier_offer WHERE wholesaler_tenant_id=? AND gtin=? LIMIT 1", String.class, po.wholesalerTenantId, p.gtin);
            v.put("supplierSku", sk.isEmpty() ? p.sku : sk.get(0));
        } else {
            v.put("supplierSku", p.sku);
        }
        if ("SUBMIT_PO".equals(kind)) {
            Map<String, Object> ret = new LinkedHashMap<>();
            ret.put("tenantPublicId", retailer.publicId);
            ret.put("name", retailer.name);
            v.put("retailer", ret);
            Map<String, Object> line = new LinkedHashMap<>();
            line.put("gtin", p.gtin);
            line.put("sku", v.get("supplierSku"));
            line.put("name", p.name);
            line.put("quantity", po.quantity);
            line.put("unitPrice", po.unitPriceAgreed);
            v.put("lines", List.of(line));
            v.put("requestedDeliveryDate", v.get("expectedDelivery"));
            Map<String, Object> neg = new HashMap<>();
            neg.put("basePrice", po.basePrice);
            neg.put("savings", po.discountSavings);
            neg.put("origin", po.origin);
            v.put("negotiation", neg);
            v.put("quoteExpiresAt", po.quoteExpiresAt == null ? null : po.quoteExpiresAt.toString());
        }
        return v;
    }

    private void finish(UUID id, String status, String note, Map<String, Object> resp) {
        jdbc.update("UPDATE writeback_task SET status=?, last_error=?, response=?::jsonb, updated_at=now() WHERE id=?",
                status, note, resp == null ? null : Json.write(resp), id);
    }

    private static String abbreviate(String s) {
        return s == null ? null : s.length() > 400 ? s.substring(0, 400) : s;
    }
}
