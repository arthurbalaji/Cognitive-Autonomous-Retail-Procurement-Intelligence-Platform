package com.carpip.procurement;

import com.carpip.common.Json;
import com.carpip.common.Money;
import com.carpip.config.AppProps;
import com.carpip.domain.Product;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import com.carpip.events.OutboxService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.Year;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Threshold evaluation (paper Fig. 3, step 3) on the INVENTORY POSITION (stock + confirmed on-order).
 * A reorder fires when position <= reorderPoint, ROP > 0, no cooldown, and no in-flight AI PO
 * (guaranteed by the partial unique index uq_po_inflight even under races).
 */
@Service
public class ProcurementService {
    private static final Logger log = LoggerFactory.getLogger(ProcurementService.class);
    private final JdbcTemplate jdbc;
    private final Repos.ProductRepo products;
    private final Repos.PurchaseOrderRepo pos;
    private final Repos.TenantRepo tenants;
    private final OutboxService outbox;
    private final TransactionTemplate tx;
    private final AppProps props;

    public ProcurementService(JdbcTemplate jdbc, Repos.ProductRepo products, Repos.PurchaseOrderRepo pos, Repos.TenantRepo tenants,
                              OutboxService outbox, TransactionTemplate tx, AppProps props) {
        this.jdbc = jdbc;
        this.products = products;
        this.pos = pos;
        this.tenants = tenants;
        this.outbox = outbox;
        this.tx = tx;
        this.props = props;
    }

    public int onOrder(UUID productId) {
        Integer n = jdbc.queryForObject("SELECT COALESCE(on_order,0)::int FROM v_inventory_position WHERE product_id=?", Integer.class, productId);
        return n == null ? 0 : n;
    }

    /** Paper: Q = max((ROP - stock) * 2, 50). Applied to the inventory position. */
    public static int paperQuantity(int reorderPoint, int position) {
        return Math.max((reorderPoint - position) * 2, 50);
    }

    public Optional<UUID> evaluate(UUID productId, String trigger) {
        Product p = products.findById(productId).orElse(null);
        if (p == null || !p.active || p.reorderPoint <= 0) {
            return Optional.empty();
        }
        Tenant t = tenants.findById(p.tenantId).orElse(null);
        if (t == null || !"RETAILER".equals(t.type)) {
            return Optional.empty();
        }
        int position = p.currentStock + onOrder(productId);
        if (position > p.reorderPoint) {
            return Optional.empty();
        }
        if (p.reorderBlockedUntil != null && p.reorderBlockedUntil.isAfter(Instant.now())) {
            return Optional.empty();
        }
        try {
            UUID id = tx.execute(s -> createPo(p, trigger, "AI", paperQuantity(p.reorderPoint, position), false));
            return Optional.ofNullable(id);
        } catch (DataIntegrityViolationException dup) {
            log.debug("reorder suppressed for {}: in-flight PO already exists", p.sku);
            return Optional.empty();
        }
    }

    /** Creates the PO row (NEGOTIATING) and the procurement.requests outbox event in one transaction. */
    public UUID createPo(Product p, String trigger, String origin, int qty, boolean degraded) {
        Long seq = jdbc.queryForObject("SELECT nextval('po_number_seq')", Long.class);
        PurchaseOrder po = new PurchaseOrder();
        po.id = UUID.randomUUID();
        po.poNumber = "CPO-" + Year.now().getValue() + "-" + String.format("%06d", seq);
        po.retailerTenantId = p.tenantId;
        po.productId = p.id;
        po.origin = origin;
        po.trigger = trigger;
        po.status = "NEGOTIATING";
        po.quantity = qty;
        po.degraded = degraded;
        pos.saveAndFlush(po);
        history(po.id, null, "NEGOTIATING", "trigger=" + trigger, "system");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("poId", po.id);
        payload.put("productId", p.id);
        payload.put("trigger", trigger);
        payload.put("inventoryPosition", p.currentStock + onOrder(p.id));
        payload.put("reorderPoint", p.reorderPoint);
        outbox.publish("procurement.requests", p.tenantId + ":" + p.id, "procurement.requested", p.tenantId,
                Map.of("system", "carpip"), payload);
        log.info("PO {} created for {} ({}), qty {} trigger {}", po.poNumber, p.sku, p.tenantId, qty, trigger);
        return po.id;
    }

    public void history(UUID poId, String from, String to, String reason, String actor) {
        jdbc.update("INSERT INTO po_status_history(po_id, from_status, to_status, reason, actor) VALUES (?,?,?,?,?)", poId, from, to, reason, actor);
    }

    // ----------------------------------------------------------------- request builder
    public String negotiationMode() {
        try {
            String v = jdbc.queryForObject("SELECT value #>> '{}' FROM system_setting WHERE key='negotiation.mode'", String.class);
            return v == null ? "llm" : v.toLowerCase();
        } catch (Exception e) {
            return "llm";
        }
    }

    public List<Map<String, Object>> candidates(Product p) {
        if (p.gtin == null) {
            return List.of();
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT o.wholesaler_tenant_id, o.supplier_sku, o.list_price, o.price_tiers::text AS price_tiers, o.available_qty, o.moq, o.pack_size, " +
                        "o.lead_time_days, o.shipping_reliability, o.nearest_expiry, o.shelf_life_days, o.max_discount_pct, t.name " +
                        "FROM supplier_offer o JOIN trade_relationship r ON r.wholesaler_tenant_id = o.wholesaler_tenant_id AND r.retailer_tenant_id = ? AND r.status='ACTIVE' " +
                        "JOIN tenant t ON t.id = o.wholesaler_tenant_id AND t.status='ACTIVE' " +
                        "WHERE o.gtin = ? AND o.active ORDER BY o.list_price", p.tenantId, p.gtin);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("supplierTenantId", r.get("wholesaler_tenant_id").toString());
            c.put("alias", r.get("name"));
            c.put("supplierSku", r.get("supplier_sku"));
            c.put("listPrice", Money.str(Money.bd(r.get("list_price"))));
            c.put("priceTiers", Json.read((String) r.get("price_tiers")));
            c.put("availableQty", r.get("available_qty"));
            c.put("moq", r.get("moq"));
            c.put("packSize", r.get("pack_size"));
            c.put("leadTimeDays", r.get("lead_time_days"));
            c.put("reliability", Money.str(Money.bd(r.get("shipping_reliability"))));
            c.put("nearestExpiry", r.get("nearest_expiry") == null ? null : r.get("nearest_expiry").toString());
            c.put("shelfLifeDays", r.get("shelf_life_days"));
            c.put("maxDiscountPct", Money.str(Money.bd(r.get("max_discount_pct"))));
            out.add(c);
        }
        return out;
    }

    public Map<String, Object> buildRequest(PurchaseOrder po, Product p, Tenant retailer, List<Map<String, Object>> candidates, String mode) {
        BigDecimal basePrice = null;
        for (Map<String, Object> c : candidates) {
            BigDecimal lp = Money.bd(c.get("listPrice"));
            if (basePrice == null || lp.compareTo(basePrice) < 0) {
                basePrice = lp;
            }
        }
        if (basePrice == null) {
            basePrice = p.basePrice == null ? BigDecimal.ZERO : p.basePrice;
        }
        int onOrder = onOrder(p.id);
        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put("sku", p.sku);
        ctx.put("name", p.name);
        ctx.put("category", p.category);
        ctx.put("basePrice", Money.str(basePrice));
        ctx.put("currentStock", p.currentStock);
        ctx.put("reorderPoint", p.reorderPoint);
        ctx.put("quantity", po == null ? paperQuantity(p.reorderPoint, p.currentStock + onOrder) : po.quantity);
        ctx.put("mpi", null);
        Map<String, Object> policy = new LinkedHashMap<>();
        policy.put("retailPrice", p.retailPrice == null ? null : Money.str(p.retailPrice));
        policy.put("targetMarginPct", retailer.setting("target_margin_pct", "0.25"));
        policy.put("safetyDays", Integer.parseInt(retailer.setting("safety_days", "3")));
        policy.put("autonomy", retailer.setting("autonomy_mode", "AUTO"));
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("requestId", UUID.randomUUID().toString());
        req.put("tenantId", p.tenantId.toString());
        req.put("productId", p.id.toString());
        req.put("gtin", p.gtin);
        req.put("poId", po == null ? null : po.id.toString());
        req.put("trigger", po == null ? "PLAN" : po.trigger);
        req.put("inventoryPosition", p.currentStock + onOrder);
        req.put("onOrder", onOrder);
        req.put("context", ctx);
        req.put("retailerPolicy", policy);
        req.put("candidates", candidates);
        Map<String, Object> opts = new LinkedHashMap<>();
        opts.put("mode", mode);
        opts.put("deadlineS", 40);
        opts.put("perishable", p.perishable);
        opts.put("shelfLifeDays", p.shelfLifeDays);
        req.put("options", opts);
        return req;
    }

    // ----------------------------------------------------------------- periodic re-evaluation
    /** Catch-up scan: covers cooldown expiry, partially confirmed orders (gap re-plan) and declined suppliers. */
    @Scheduled(fixedDelay = 30_000, initialDelay = 60_000)
    public void scan() {
        try {
            List<UUID> ids = jdbc.queryForList(
                    "SELECT p.id FROM v_inventory_position v JOIN product p ON p.id = v.product_id " +
                            "WHERE p.active AND p.reorder_point > 0 AND v.current_stock + v.on_order <= p.reorder_point " +
                            "AND (p.reorder_blocked_until IS NULL OR p.reorder_blocked_until < now()) " +
                            "AND NOT EXISTS (SELECT 1 FROM purchase_order po WHERE po.product_id = p.id AND po.origin = 'AI' " +
                            "AND po.status IN ('NEGOTIATING','NEGOTIATION_ERROR','PENDING_APPROVAL','APPROVED','SUBMITTED')) LIMIT 50", UUID.class);
            for (UUID id : ids) {
                evaluate(id, "SCAN");
            }
        } catch (Exception e) {
            log.warn("procurement scan failed: {}", e.getMessage());
        }
    }
}
