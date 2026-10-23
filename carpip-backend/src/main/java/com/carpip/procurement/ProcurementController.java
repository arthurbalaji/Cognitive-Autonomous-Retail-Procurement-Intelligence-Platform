package com.carpip.procurement;

import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import com.carpip.common.ApiException;
import com.carpip.domain.Product;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ProcurementController {
    private final JdbcTemplate jdbc;
    private final Repos.ProductRepo products;
    private final Repos.TenantRepo tenants;
    private final Repos.PurchaseOrderRepo pos;
    private final ProcurementService procurement;
    private final PurchaseOrderService poService;
    private final ManualOrderService manual;
    private final IntelligenceClient engine;
    private final org.springframework.transaction.support.TransactionTemplate tx;

    public ProcurementController(JdbcTemplate jdbc, Repos.ProductRepo products, Repos.TenantRepo tenants, Repos.PurchaseOrderRepo pos,
                                 ProcurementService procurement, PurchaseOrderService poService, ManualOrderService manual, IntelligenceClient engine,
                                 org.springframework.transaction.support.TransactionTemplate tx) {
        this.tx = tx;
        this.jdbc = jdbc;
        this.products = products;
        this.tenants = tenants;
        this.pos = pos;
        this.procurement = procurement;
        this.poService = poService;
        this.manual = manual;
        this.engine = engine;
    }

    public record PlanRequest(UUID productId, Integer quantity) {
    }

    public record RunRequest(UUID productId, Integer quantity, String mode, UUID supplierTenantId) {
    }

    public record ApproveRequest(Integer quantity) {
    }

    public record ReasonRequest(String reason) {
    }

    public record ReceiveRequest(Integer quantity) {
    }

    private String actor() {
        Principal p = TenantContext.require();
        return p.userId() == null ? "apikey:" + p.tenantId() : p.userId().toString();
    }

    // ----------------------------------------------------------------- planning & manual runs
    @SuppressWarnings("unchecked")
    @PostMapping("/procurement/plan")
    public Map<String, Object> plan(@RequestBody PlanRequest req) {
        Principal pr = TenantContext.requireRole("RETAILER");
        Product p = products.findByIdAndTenantId(req.productId(), pr.tenantId()).orElseThrow(() -> ApiException.notFound("product"));
        Tenant t = tenants.findById(pr.tenantId()).orElseThrow();
        List<Map<String, Object>> cands = procurement.candidates(p);
        if (cands.isEmpty()) {
            throw ApiException.conflict("NO_SUPPLIERS", "no trade-related supplier lists this product");
        }
        Map<String, Object> body = procurement.buildRequest(null, p, t, cands, "plan");
        if (req.quantity() != null) {
            ((Map<String, Object>) body.get("context")).put("quantity", req.quantity());
        }
        return engine.post("/api/procure/plan", body);
    }

    @PostMapping("/procurement/runs")
    public Map<String, Object> run(@RequestBody RunRequest req) {
        Principal pr = TenantContext.requireRole("RETAILER");
        Product p = products.findByIdAndTenantId(req.productId(), pr.tenantId()).orElseThrow(() -> ApiException.notFound("product"));
        int pos0 = p.currentStock + procurement.onOrder(p.id);
        int qty = req.quantity() != null ? req.quantity() : ProcurementService.paperQuantity(Math.max(p.reorderPoint, 1), pos0);
        if (qty <= 0) {
            throw ApiException.bad("BAD_QUANTITY", "quantity must be positive");
        }
        String mode = req.mode() == null ? "NEGOTIATE" : req.mode().toUpperCase();
        Map<String, Object> out = new LinkedHashMap<>();
        if ("LIST_PRICE".equals(mode)) {
            if (req.supplierTenantId() == null) {
                throw ApiException.bad("BAD_REQUEST", "supplierTenantId required for LIST_PRICE");
            }
            PurchaseOrder po = manual.createListPricePo(pr.tenantId(), p.id, req.supplierTenantId(), qty, actor());
            out.put("purchaseOrderId", po.id);
            out.put("poNumber", po.poNumber);
            out.put("status", po.status);
            return out;
        }
        if (!"NEGOTIATE".equals(mode)) {
            throw ApiException.bad("BAD_REQUEST", "mode must be NEGOTIATE or LIST_PRICE");
        }
        UUID poId = tx.execute(s -> procurement.createPo(p, "MANUAL", "MANUAL", qty, false));
        out.put("purchaseOrderId", poId);
        out.put("status", "NEGOTIATING");
        return out;
    }

    // ----------------------------------------------------------------- purchase orders
    private static final String PO_SQL =
            "SELECT po.id, po.po_number, po.origin, po.trigger, po.status, po.negotiation_status, po.quantity, po.qty_confirmed, po.qty_shipped, po.qty_received, " +
                    "po.unit_price_agreed, po.base_price, po.discount_savings, po.total_amount, po.currency, po.order_by_date, po.expected_delivery_date, po.quote_expires_at, " +
                    "po.external_ref, po.cancel_reason, po.degraded, po.created_at, po.updated_at, po.product_id, p.sku, p.name AS product_name, p.gtin, " +
                    "rt.name AS retailer, po.retailer_tenant_id, wt.name AS wholesaler, po.wholesaler_tenant_id FROM purchase_order po " +
                    "JOIN product p ON p.id = po.product_id JOIN tenant rt ON rt.id = po.retailer_tenant_id LEFT JOIN tenant wt ON wt.id = po.wholesaler_tenant_id ";

    @GetMapping("/purchase-orders")
    public List<Map<String, Object>> list(@RequestParam(required = false) String status, @RequestParam(defaultValue = "100") int limit) {
        Principal pr = TenantContext.requireUser();
        List<Object> args = new ArrayList<>();
        StringBuilder w = new StringBuilder(" WHERE 1=1 ");
        if (pr.isRetailer()) {
            w.append("AND po.retailer_tenant_id = ? ");
            args.add(pr.tenantId());
        } else if (pr.isWholesaler()) {
            w.append("AND po.wholesaler_tenant_id = ? AND po.status NOT IN ('DRAFT','NEGOTIATING','NEGOTIATION_ERROR','PENDING_APPROVAL','APPROVED','NEGOTIATION_REJECTED','REJECTED_BY_USER','EXPIRED') ");
            args.add(pr.tenantId());
        }
        if (status != null && !status.isBlank()) {
            w.append("AND po.status IN (").append(String.join(",", java.util.Collections.nCopies(status.split(",").length, "?"))).append(") ");
            args.addAll(List.of(status.split(",")));
        }
        return jdbc.queryForList(PO_SQL + w + "ORDER BY po.created_at DESC LIMIT " + Math.min(Math.max(limit, 1), 500), args.toArray());
    }

    private PurchaseOrder visible(UUID id) {
        Principal pr = TenantContext.requireUser();
        PurchaseOrder po = pos.findById(id).orElseThrow(() -> ApiException.notFound("purchase order"));
        boolean ok = pr.isAdmin() || po.retailerTenantId.equals(pr.tenantId())
                || (pr.isWholesaler() && pr.tenantId().equals(po.wholesalerTenantId));
        if (!ok) {
            throw ApiException.notFound("purchase order");
        }
        return po;
    }

    @GetMapping("/purchase-orders/{id}")
    public Map<String, Object> detail(@PathVariable UUID id) {
        Principal pr = TenantContext.requireUser();
        visible(id);
        Map<String, Object> m = new LinkedHashMap<>(jdbc.queryForMap(PO_SQL + " WHERE po.id = ?", id));
        m.put("decision", jdbc.queryForObject("SELECT decision::text FROM purchase_order WHERE id=?", String.class, id) == null ? null
                : com.carpip.common.Json.read(jdbc.queryForObject("SELECT decision::text FROM purchase_order WHERE id=?", String.class, id)));
        m.put("history", jdbc.queryForList("SELECT from_status, to_status, reason, actor, at FROM po_status_history WHERE po_id=? ORDER BY at, id", id));
        m.put("negotiations", negotiations(id, pr));
        if (!pr.isWholesaler()) {
            m.put("writebacks", jdbc.queryForList("SELECT kind, status, attempts, last_error, created_at, updated_at FROM writeback_task WHERE po_id=? ORDER BY created_at", id));
        }
        return m;
    }

    private List<Map<String, Object>> negotiations(UUID poId, Principal pr) {
        List<Map<String, Object>> list = jdbc.queryForList("SELECT n.*, t.name AS supplier FROM negotiation n JOIN tenant t ON t.id = n.wholesaler_tenant_id " +
                "WHERE n.po_id = ? ORDER BY n.created_at, n.rank NULLS LAST", poId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> n : list) {
            if (pr.isWholesaler() && !pr.tenantId().equals(n.get("wholesaler_tenant_id"))) {
                continue;
            }
            Map<String, Object> m = new LinkedHashMap<>(n);
            if (pr.isRetailer()) {
                m.put("floor_price", null); // the wholesaler's private floor is never disclosed to the retailer
            }
            if (pr.isWholesaler()) {
                m.put("retailer_max", null);
                m.put("retailer_target", null);
            }
            m.put("turns", jdbc.queryForList("SELECT turn_no, actor, action, price, deterministic_price, llm_proposed_price, clamped, source, message, at FROM negotiation_log " +
                    "WHERE negotiation_id = ? ORDER BY turn_no, id", n.get("id")));
            out.add(m);
        }
        return out;
    }

    @GetMapping("/negotiations")
    public List<Map<String, Object>> negotiationList(@RequestParam(defaultValue = "50") int limit) {
        Principal pr = TenantContext.requireUser();
        String where = pr.isAdmin() ? "" : pr.isRetailer() ? "WHERE n.retailer_tenant_id = ? " : "WHERE n.wholesaler_tenant_id = ? ";
        String sql = "SELECT n.id, n.po_id, po.po_number, p.name AS product, n.status, n.mode, n.base_price, n.final_price, n.quantity, n.rank, n.selected, " +
                "n.mpi_used, n.latency_ms, n.tokens_in, n.tokens_out, n.guardrail_interventions, n.created_at, t.name AS supplier, rt.name AS retailer " +
                "FROM negotiation n JOIN purchase_order po ON po.id = n.po_id JOIN product p ON p.id = po.product_id JOIN tenant t ON t.id = n.wholesaler_tenant_id " +
                "JOIN tenant rt ON rt.id = n.retailer_tenant_id " + where + "ORDER BY n.created_at DESC LIMIT " + Math.min(Math.max(limit, 1), 300);
        return pr.isAdmin() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, pr.tenantId());
    }

    @GetMapping("/negotiations/{id}")
    public Map<String, Object> negotiation(@PathVariable UUID id) {
        Principal pr = TenantContext.requireUser();
        UUID poId = jdbc.queryForList("SELECT po_id FROM negotiation WHERE id=?", UUID.class, id).stream().findFirst().orElseThrow(() -> ApiException.notFound("negotiation"));
        visible(poId);
        return negotiations(poId, pr).stream().filter(n -> id.equals(n.get("id"))).findFirst().orElseThrow(() -> ApiException.notFound("negotiation"));
    }

    // ----------------------------------------------------------------- actions
    @PostMapping("/purchase-orders/{id}/approve")
    public Map<String, Object> approve(@PathVariable UUID id, @RequestBody(required = false) ApproveRequest req) {
        Principal pr = TenantContext.requireRole("RETAILER");
        PurchaseOrder po = poService.approve(pr.tenantId(), id, req == null ? null : req.quantity(), actor());
        return Map.of("poNumber", po.poNumber, "status", po.status);
    }

    @PostMapping("/purchase-orders/{id}/reject")
    public Map<String, Object> reject(@PathVariable UUID id, @RequestBody ReasonRequest req) {
        Principal pr = TenantContext.requireRole("RETAILER");
        PurchaseOrder po = poService.reject(pr.tenantId(), id, req.reason(), actor());
        return Map.of("poNumber", po.poNumber, "status", po.status);
    }

    @PostMapping("/purchase-orders/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable UUID id, @RequestBody(required = false) ReasonRequest req) {
        Principal pr = TenantContext.requireRole("RETAILER");
        PurchaseOrder po = poService.cancel(pr.tenantId(), id, req == null ? null : req.reason(), actor());
        return Map.of("poNumber", po.poNumber, "status", po.status);
    }

    @PostMapping("/purchase-orders/{id}/receive")
    public Map<String, Object> receive(@PathVariable UUID id, @RequestBody(required = false) ReceiveRequest req) {
        Principal pr = TenantContext.requireRole("RETAILER");
        return poService.receive(pr.tenantId(), id, req == null ? null : req.quantity(), actor());
    }
}
