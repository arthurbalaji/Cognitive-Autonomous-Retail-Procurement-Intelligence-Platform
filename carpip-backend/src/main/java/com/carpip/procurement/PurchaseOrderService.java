package com.carpip.procurement;

import com.carpip.audit.AuditService;
import com.carpip.common.ApiException;
import com.carpip.common.Money;
import com.carpip.config.AppProps;
import com.carpip.domain.Product;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.carpip.erp.WritebackService;
import com.carpip.events.OutboxService;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Purchase-order state machine (contracts: docs/po-state-machine.md) and its side effects. */
@Service
public class PurchaseOrderService {
    private static final Logger log = LoggerFactory.getLogger(PurchaseOrderService.class);

    private static final Map<String, Set<String>> ALLOWED = Map.ofEntries(
            Map.entry("DRAFT", Set.of("NEGOTIATING", "PENDING_APPROVAL", "APPROVED", "CANCELLED")),
            Map.entry("NEGOTIATING", Set.of("NEGOTIATION_REJECTED", "PENDING_APPROVAL", "APPROVED", "NEGOTIATION_ERROR", "CANCELLED")),
            Map.entry("NEGOTIATION_ERROR", Set.of("NEGOTIATING", "PENDING_APPROVAL", "CANCELLED")),
            Map.entry("PENDING_APPROVAL", Set.of("APPROVED", "REJECTED_BY_USER", "EXPIRED", "CANCELLED")),
            Map.entry("APPROVED", Set.of("SUBMITTED", "CANCELLED")),
            Map.entry("SUBMITTED", Set.of("CONFIRMED", "PARTIALLY_CONFIRMED", "DECLINED_BY_SUPPLIER", "APPROVED", "CANCELLED", "SHIPPED", "DELIVERED")),
            Map.entry("CONFIRMED", Set.of("PARTIALLY_SHIPPED", "SHIPPED", "DELIVERED", "CANCELLED")),
            Map.entry("PARTIALLY_CONFIRMED", Set.of("PARTIALLY_SHIPPED", "SHIPPED", "DELIVERED", "CANCELLED")),
            Map.entry("PARTIALLY_SHIPPED", Set.of("PARTIALLY_SHIPPED", "SHIPPED", "DELIVERED")),
            Map.entry("SHIPPED", Set.of("DELIVERED")),
            Map.entry("DELIVERED", Set.of("PARTIALLY_RECEIVED", "RECEIVED")),
            Map.entry("PARTIALLY_RECEIVED", Set.of("PARTIALLY_RECEIVED", "RECEIVED", "CLOSED")),
            Map.entry("RECEIVED", Set.of("CLOSED")));

    /** Monotone progress rank used to ignore stale / out-of-order supplier events. */
    private static final Map<String, Integer> RANK = Map.ofEntries(
            Map.entry("SUBMITTED", 1), Map.entry("CONFIRMED", 2), Map.entry("PARTIALLY_CONFIRMED", 2),
            Map.entry("PARTIALLY_SHIPPED", 3), Map.entry("SHIPPED", 4), Map.entry("DELIVERED", 5),
            Map.entry("PARTIALLY_RECEIVED", 6), Map.entry("RECEIVED", 7), Map.entry("CLOSED", 8));

    private final Repos.PurchaseOrderRepo pos;
    private final Repos.ProductRepo products;
    private final Repos.TenantRepo tenants;
    private final ProcurementService procurement;
    private final OutboxService outbox;
    private final WritebackService writeback;
    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final AppProps props;

    public PurchaseOrderService(Repos.PurchaseOrderRepo pos, Repos.ProductRepo products, Repos.TenantRepo tenants,
                                ProcurementService procurement, OutboxService outbox, WritebackService writeback,
                                JdbcTemplate jdbc, AuditService audit, AppProps props) {
        this.pos = pos;
        this.products = products;
        this.tenants = tenants;
        this.procurement = procurement;
        this.outbox = outbox;
        this.writeback = writeback;
        this.jdbc = jdbc;
        this.audit = audit;
        this.props = props;
    }

    public static boolean isAllowed(String from, String to) {
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }

    // ------------------------------------------------------------------ core transition
    @Transactional
    public PurchaseOrder transition(PurchaseOrder po, String to, String reason, String actor) {
        String from = po.status;
        if (!isAllowed(from, to)) {
            throw ApiException.conflict("PO_INVALID_TRANSITION", "cannot move PO " + po.poNumber + " from " + from + " to " + to);
        }
        po.status = to;
        po.updatedAt = Instant.now();
        pos.saveAndFlush(po);
        procurement.history(po.id, from, to, reason, actor);

        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("poId", po.id);
        ev.put("poNumber", po.poNumber);
        ev.put("from", from);
        ev.put("to", to);
        ev.put("retailerTenantId", po.retailerTenantId);
        ev.put("wholesalerTenantId", po.wholesalerTenantId);
        ev.put("productId", po.productId);
        ev.put("quantity", po.quantity);
        ev.put("totalAmount", po.totalAmount);
        ev.put("reason", reason);
        outbox.publish("po.lifecycle", po.id.toString(), "po.transitioned", po.retailerTenantId, Map.of("system", "carpip"), ev);

        // side effects (all durable: they only enqueue writeback tasks)
        switch (to) {
            case "APPROVED" -> writeback.enqueue(po.wholesalerTenantId, po.id, "SUBMIT_PO",
                    po.poNumber + ":SUBMIT:" + po.wholesalerTenantId, Map.of());
            case "CANCELLED" -> {
                if (RANK.getOrDefault(from, 0) >= RANK.get("SUBMITTED")) {
                    writeback.enqueue(po.wholesalerTenantId, po.id, "CANCEL_PO", po.poNumber + ":CANCEL", Map.of("reason", String.valueOf(reason)));
                    if (RANK.getOrDefault(from, 0) >= RANK.get("CONFIRMED")) {
                        pushIncoming(po, "CANCELLED");
                    }
                }
            }
            case "CONFIRMED", "PARTIALLY_CONFIRMED", "PARTIALLY_SHIPPED", "SHIPPED", "DELIVERED" -> pushIncoming(po, to);
            default -> {
            }
        }
        return po;
    }

    private void pushIncoming(PurchaseOrder po, String status) {
        writeback.enqueue(po.retailerTenantId, po.id, "PUSH_INCOMING",
                po.poNumber + ":PUSH:" + status + ":" + po.qtyShipped + ":" + (po.qtyConfirmed == null ? 0 : po.qtyConfirmed), Map.of("status", status));
    }

    /**
     * Move to a new status for supplier-driven events without ever throwing on a business conflict
     * (an exception through a joined transaction would poison the whole webhook transaction).
     * @return false when the move is not permitted (caller reports IGNORED_INVALID_TRANSITION).
     */
    private boolean step(PurchaseOrder po, String to, String reason, String actor) {
        if (po.status.equals(to) && !isAllowed(to, to)) {
            po.updatedAt = Instant.now();
            pos.saveAndFlush(po);
            return true; // same terminal-ish status, only quantities changed
        }
        if (!isAllowed(po.status, to)) {
            log.warn("PO {}: ignoring {} -> {} ({})", po.poNumber, po.status, to, reason);
            return false;
        }
        transition(po, to, reason, actor);
        return true;
    }

    private PurchaseOrder load(UUID retailerTenantId, UUID poId) {
        return pos.findById(poId).filter(p -> p.retailerTenantId.equals(retailerTenantId)).orElseThrow(() -> ApiException.notFound("purchase order"));
    }

    // ------------------------------------------------------------------ user actions
    @Transactional
    public PurchaseOrder approve(UUID tenantId, UUID poId, Integer qtyOverride, String actor) {
        PurchaseOrder po = load(tenantId, poId);
        if (!"PENDING_APPROVAL".equals(po.status)) {
            throw ApiException.conflict("PO_INVALID_TRANSITION", "only PENDING_APPROVAL orders can be approved (status " + po.status + ")");
        }
        if (po.quoteExpiresAt != null && po.quoteExpiresAt.isBefore(Instant.now())) {
            transition(po, "EXPIRED", "quote expired before approval", "system");
            throw ApiException.conflict("QUOTE_EXPIRED", "the negotiated quote has expired; re-negotiate");
        }
        if (po.wholesalerTenantId == null || po.unitPriceAgreed == null) {
            throw ApiException.conflict("NO_QUOTE", "order has no negotiated supplier quote");
        }
        if (qtyOverride != null && qtyOverride != po.quantity) {
            validateQuantity(po, qtyOverride);
            po.quantity = qtyOverride;
            po.totalAmount = Money.round2(po.unitPriceAgreed.multiply(BigDecimal.valueOf(qtyOverride)));
            if (po.basePrice != null) {
                po.discountSavings = Money.round2(po.basePrice.subtract(po.unitPriceAgreed).multiply(BigDecimal.valueOf(qtyOverride)));
            }
        }
        audit.log(tenantId, "USER", actor, "PO_APPROVED", "purchase_order", po.id.toString(), Map.of("poNumber", po.poNumber, "quantity", po.quantity));
        return transition(po, "APPROVED", "approved by " + actor, actor);
    }

    @Transactional
    public PurchaseOrder reject(UUID tenantId, UUID poId, String reason, String actor) {
        PurchaseOrder po = load(tenantId, poId);
        if (reason == null || reason.isBlank()) {
            throw ApiException.bad("REASON_REQUIRED", "a rejection reason is required");
        }
        po.cancelReason = reason;
        audit.log(tenantId, "USER", actor, "PO_REJECTED", "purchase_order", po.id.toString(), Map.of("poNumber", po.poNumber, "reason", reason));
        return transition(po, "REJECTED_BY_USER", reason, actor);
    }

    @Transactional
    public PurchaseOrder cancel(UUID tenantId, UUID poId, String reason, String actor) {
        PurchaseOrder po = load(tenantId, poId);
        po.cancelReason = reason;
        audit.log(tenantId, "USER", actor, "PO_CANCELLED", "purchase_order", po.id.toString(), Map.of("poNumber", po.poNumber, "reason", String.valueOf(reason)));
        return transition(po, "CANCELLED", reason == null ? "cancelled by user" : reason, actor);
    }

    /** Receiving goods: enqueue a stock adjustment on the POS; the PO advances once the POS confirms. */
    @Transactional
    public Map<String, Object> receive(UUID tenantId, UUID poId, Integer qty, String actor) {
        PurchaseOrder po = load(tenantId, poId);
        if (!List.of("DELIVERED", "PARTIALLY_RECEIVED").contains(po.status)) {
            throw ApiException.conflict("PO_INVALID_TRANSITION", "goods can only be received once delivered (status " + po.status + ")");
        }
        int remaining = po.qtyShipped - po.qtyReceived;
        if (remaining <= 0) {
            throw ApiException.conflict("NOTHING_TO_RECEIVE", "all delivered quantity has already been received");
        }
        boolean capped = qty != null && qty > remaining;
        int q = qty == null ? remaining : Math.min(qty, remaining);
        if (q <= 0) {
            throw ApiException.bad("BAD_QUANTITY", "quantity must be positive");
        }
        writeback.enqueue(po.retailerTenantId, po.id, "ADJUST_STOCK", po.poNumber + ":RCV:" + po.qtyReceived + ":" + q, Map.of("qty", q));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("poNumber", po.poNumber);
        out.put("receiving", q);
        out.put("cappedToShipped", capped);
        out.put("status", "RECEIPT_QUEUED");
        return out;
    }

    /** Called by the writeback worker once the retailer's POS has applied the stock receipt. */
    @Transactional
    public void onReceiptApplied(UUID poId, int qty) {
        PurchaseOrder po = pos.findById(poId).orElse(null);
        if (po == null) {
            return;
        }
        po.qtyReceived += qty;
        int expected = po.qtyShipped;
        String next = po.qtyReceived >= expected ? "RECEIVED" : "PARTIALLY_RECEIVED";
        transition(po, next, "received " + qty, "system");
        if ("RECEIVED".equals(next)) {
            transition(po, "CLOSED", "fully received", "system");
        }
    }

    private void validateQuantity(PurchaseOrder po, int qty) {
        Product p = products.findById(po.productId).orElseThrow();
        List<Map<String, Object>> o = jdbc.queryForList("SELECT moq, pack_size, available_qty FROM supplier_offer WHERE wholesaler_tenant_id=? AND gtin=? AND active LIMIT 1",
                po.wholesalerTenantId, p.gtin);
        if (o.isEmpty()) {
            throw ApiException.conflict("NO_OFFER", "supplier no longer lists this item");
        }
        int moq = ((Number) o.get(0).get("moq")).intValue();
        int pack = ((Number) o.get(0).get("pack_size")).intValue();
        int avail = ((Number) o.get(0).get("available_qty")).intValue();
        if (qty < moq) {
            throw ApiException.bad("BELOW_MOQ", "quantity below supplier MOQ " + moq);
        }
        if (pack > 1 && qty % pack != 0) {
            throw ApiException.bad("PACK_SIZE", "quantity must be a multiple of pack size " + pack);
        }
        if (qty > avail) {
            throw ApiException.bad("EXCEEDS_AVAILABLE", "supplier only has " + avail + " available");
        }
    }

    // ------------------------------------------------------------------ supplier-side events
    /**
     * Applies a supplier (ERP) lifecycle event. Idempotent and monotone: duplicates and out-of-order events
     * (rank lower than current) are ignored. Events for a PO that belongs to another wholesaler are rejected.
     */
    @Transactional
    public String onSupplierEvent(UUID wholesalerTenantId, String type, JsonNode body) {
        String poNumber = body.path("po_number").asText(body.path("poNumber").asText(null));
        if (poNumber == null) {
            return "IGNORED_NO_PO_NUMBER";
        }
        PurchaseOrder po = pos.findByPoNumber(poNumber).orElse(null);
        if (po == null) {
            return "IGNORED_UNKNOWN_PO";
        }
        if (po.wholesalerTenantId == null || !po.wholesalerTenantId.equals(wholesalerTenantId)) {
            audit.log(wholesalerTenantId, "SYSTEM", "erp", "CROSS_TENANT_PO_EVENT_REJECTED", "purchase_order", poNumber, Map.of("type", type));
            return "IGNORED_NOT_YOUR_PO";
        }
        if ("APPROVED".equals(po.status) && !"sales_order.cancelled".equals(type)) {
            // the supplier acted before our submit ack was recorded (auto-confirm race): the submit evidently succeeded
            transition(po, "SUBMITTED", "implicit: supplier event arrived before submit ack", "system");
        }
        int cur = RANK.getOrDefault(po.status, 0);
        switch (type) {
            case "sales_order.confirmed" -> {
                int conf = sumQty(body, "confirmed_qty", "confirmedQty");
                if (conf <= 0) {
                    return handleDecline(po, "supplier confirmed zero quantity");
                }
                if (cur >= RANK.get("CONFIRMED")) {
                    return "IGNORED_STALE";
                }
                po.qtyConfirmed = Math.min(conf, po.quantity);
                applyEta(po, body);
                boolean partial = conf < po.quantity;
                po.totalAmount = Money.round2(po.unitPriceAgreed.multiply(BigDecimal.valueOf(po.qtyConfirmed)));
                if (!step(po, partial ? "PARTIALLY_CONFIRMED" : "CONFIRMED", "supplier confirmed " + conf, "erp")) {
                    return "IGNORED_INVALID_TRANSITION";
                }
            }
            case "sales_order.rejected" -> {
                return handleDecline(po, body.path("reason").asText("rejected by supplier"));
            }
            case "shipment.created" -> {
                if (cur >= RANK.get("DELIVERED") || cur == 0) {
                    return "IGNORED_STALE";
                }
                int shipped = sumQty(body, "shipped_qty", "shippedQty");
                po.qtyShipped = Math.max(po.qtyShipped, 0) + shipped;
                applyEta(po, body);
                int target = po.qtyConfirmed == null ? po.quantity : po.qtyConfirmed;
                if (po.qtyConfirmed == null) {
                    po.qtyConfirmed = po.quantity;
                }
                if (!step(po, po.qtyShipped >= target ? "SHIPPED" : "PARTIALLY_SHIPPED", "shipment " + shipped, "erp")) {
                    return "IGNORED_INVALID_TRANSITION";
                }
            }
            case "sales_order.delivered" -> {
                if (cur >= RANK.get("DELIVERED") || cur == 0) {
                    return "IGNORED_STALE";
                }
                int delivered = sumQty(body, "delivered_qty", "deliveredQty");
                if (po.qtyConfirmed == null) {
                    po.qtyConfirmed = po.quantity;
                }
                po.qtyShipped = delivered > 0 ? delivered : po.qtyShipped;
                if (!step(po, "DELIVERED", "delivered " + po.qtyShipped, "erp")) {
                    return "IGNORED_INVALID_TRANSITION";
                }
                if (props.autoReceive() && po.qtyShipped > 0) {
                    writeback.enqueue(po.retailerTenantId, po.id, "ADJUST_STOCK", po.poNumber + ":RCV:" + po.qtyReceived + ":" + (po.qtyShipped - po.qtyReceived),
                            Map.of("qty", po.qtyShipped - po.qtyReceived));
                }
            }
            case "sales_order.cancelled" -> {
                if (!isAllowed(po.status, "CANCELLED")) {
                    return "IGNORED_STALE";
                }
                po.cancelReason = body.path("reason").asText("cancelled by supplier");
                if (!step(po, "CANCELLED", po.cancelReason, "erp")) {
                    return "IGNORED_INVALID_TRANSITION";
                }
            }
            default -> {
                return "IGNORED_UNKNOWN_EVENT";
            }
        }
        return "APPLIED";
    }

    private int sumQty(JsonNode body, String a, String b) {
        int sum = 0;
        JsonNode lines = body.path("lines");
        if (lines.isArray()) {
            for (JsonNode l : lines) {
                sum += l.path(a).asInt(l.path(b).asInt(0));
            }
        }
        return sum;
    }

    private void applyEta(PurchaseOrder po, JsonNode body) {
        String eta = body.path("eta").asText(null);
        if (eta != null && !eta.isBlank()) {
            try {
                po.expectedDeliveryDate = LocalDate.parse(eta.substring(0, 10));
            } catch (Exception ignored) {
                log.debug("unparseable eta {}", eta);
            }
        }
    }

    /** Supplier declined: reroute to the next ranked, still-valid quote; otherwise terminal DECLINED_BY_SUPPLIER. */
    @SuppressWarnings("unchecked")
    private String handleDecline(PurchaseOrder po, String reason) {
        UUID declined = po.wholesalerTenantId;
        Map<String, Object> next = null;
        boolean quoteValid = po.quoteExpiresAt == null || po.quoteExpiresAt.isAfter(Instant.now());
        if (quoteValid && po.decision != null && po.decision.get("rankedSuppliers") instanceof List<?> ranked) {
            for (Object o : ranked) {
                Map<String, Object> r = (Map<String, Object>) o;
                String sid = String.valueOf(r.get("supplierTenantId"));
                if (!sid.equals(declined.toString()) && "ACCEPTED".equals(r.get("outcome")) && !Boolean.FALSE.equals(r.get("feasible"))
                        && !alreadyTried(po, sid)) {
                    next = r;
                    break;
                }
            }
        }
        if (next == null) {
            po.cancelReason = reason;
            return step(po, "DECLINED_BY_SUPPLIER", reason, "erp") ? "APPLIED_DECLINED" : "IGNORED_INVALID_TRANSITION";
        }
        UUID newSupplier = UUID.fromString(String.valueOf(next.get("supplierTenantId")));
        BigDecimal price = Money.bd(next.get("agreedUnitPrice"));
        int qty = ((Number) next.get("quantity")).intValue();
        List<Map<String, Object>> neg = jdbc.queryForList("SELECT base_price FROM negotiation WHERE po_id=? AND wholesaler_tenant_id=? ORDER BY created_at DESC LIMIT 1", po.id, newSupplier);
        BigDecimal base = neg.isEmpty() ? po.basePrice : Money.bd(neg.get(0).get("base_price"));
        po.wholesalerTenantId = newSupplier;
        po.unitPriceAgreed = price;
        po.basePrice = base;
        po.quantity = qty;
        po.qtyConfirmed = null;
        po.totalAmount = Money.round2(price.multiply(BigDecimal.valueOf(qty)));
        po.discountSavings = base == null ? BigDecimal.ZERO : Money.round2(base.subtract(price).multiply(BigDecimal.valueOf(qty)));
        po.externalRef = null;
        jdbc.update("UPDATE negotiation SET selected = (wholesaler_tenant_id = ?) WHERE po_id = ?", newSupplier, po.id);
        audit.log(po.retailerTenantId, "SYSTEM", "erp", "PO_REROUTED", "purchase_order", po.poNumber, Map.of("declinedBy", declined.toString(), "newSupplier", newSupplier.toString(), "reason", reason));
        return step(po, "APPROVED", "supplier declined (" + reason + "); rerouted to next-ranked supplier", "system") ? "APPLIED_REROUTED" : "IGNORED_INVALID_TRANSITION";
    }

    private boolean alreadyTried(PurchaseOrder po, String supplierId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM po_status_history WHERE po_id=? AND reason LIKE ?", Integer.class, po.id, "%rerouted%" + "");
        // a supplier is considered tried if the PO was previously routed to it (tracked via audit); keep simple: never loop > 2 hops
        return n != null && n >= 2;
    }
}
