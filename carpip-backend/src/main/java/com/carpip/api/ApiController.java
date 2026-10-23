package com.carpip.api;

import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import com.carpip.common.ApiException;
import com.carpip.domain.Product;
import com.carpip.domain.Repos;
import com.carpip.erp.InventoryBatchService;
import com.carpip.erp.SupplierCatalogService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Path B – open API layer (paper §3.3): POST /api/v1/inventory, /api/v1/orders, /api/erp/sync.
 * Auth: Authorization: Bearer ck_live_... (API key) or a user JWT. Tenant is derived from the credential only.
 */
@RestController
public class ApiController {
    private final InventoryBatchService batch;
    private final SupplierCatalogService catalog;
    private final Repos.ProductRepo products;
    private final Repos.ConnectionRepo connections;
    private final JdbcTemplate jdbc;

    public ApiController(InventoryBatchService batch, SupplierCatalogService catalog, Repos.ProductRepo products,
                         Repos.ConnectionRepo connections, JdbcTemplate jdbc) {
        this.batch = batch;
        this.catalog = catalog;
        this.products = products;
        this.connections = connections;
        this.jdbc = jdbc;
    }

    private void touch(UUID tenantId) {
        connections.findByTenantId(tenantId).ifPresent(c -> {
            c.lastSyncAt = java.time.Instant.now();
            c.health = "OK";
            c.lastError = null;
            connections.save(c);
        });
    }

    private ResponseEntity<Map<String, Object>> replayCheck(UUID tenantId, String key, byte[] raw, java.util.function.Supplier<Map<String, Object>> action) {
        String idem = batch.checkIdempotency(tenantId, key, raw);
        if ("SAME".equals(idem)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("duplicate", true);
            m.put("detail", "request with this Idempotency-Key was already processed");
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(m);
        }
        if ("MISMATCH".equals(idem)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", "IDEMPOTENCY_KEY_MISMATCH");
            m.put("detail", "this Idempotency-Key was already used with a different request body");
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(m);
        }
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(action.get());
    }

    @PostMapping("/api/v1/inventory")
    public ResponseEntity<Map<String, Object>> inventory(@RequestBody byte[] raw, @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        Principal p = TenantContext.requireRole("RETAILER");
        JsonNode body = com.carpip.common.Json.read(raw);
        ResponseEntity<Map<String, Object>> r = replayCheck(p.tenantId(), key, raw, () -> batch.inventory(p.tenantId(), body));
        touch(p.tenantId());
        return r;
    }

    @PostMapping("/api/v1/orders")
    public ResponseEntity<Map<String, Object>> orders(@RequestBody byte[] raw, @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        Principal p = TenantContext.requireRole("RETAILER");
        JsonNode body = com.carpip.common.Json.read(raw);
        ResponseEntity<Map<String, Object>> r = replayCheck(p.tenantId(), key, raw, () -> batch.orders(p.tenantId(), body));
        touch(p.tenantId());
        return r;
    }

    @GetMapping("/api/v1/inventory")
    public List<Map<String, Object>> stock(@RequestParam(required = false) String sku) {
        Principal p = TenantContext.requireRole("RETAILER");
        List<Product> ps = sku == null ? products.findByTenantId(p.tenantId()) : products.findByTenantIdAndSku(p.tenantId(), sku).map(List::of).orElse(List.of());
        List<Map<String, Object>> out = new ArrayList<>();
        for (Product x : ps) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("sku", x.sku);
            m.put("gtin", x.gtin);
            m.put("name", x.name);
            m.put("quantity", x.currentStock);
            m.put("reorderPoint", x.reorderPoint);
            out.add(m);
        }
        return out;
    }

    @GetMapping("/api/v1/purchase-orders")
    public List<Map<String, Object>> purchaseOrders(@RequestParam(required = false) String status) {
        Principal p = TenantContext.requireRole("RETAILER");
        String sql = "SELECT po.po_number, po.status, po.quantity, po.qty_confirmed, po.qty_shipped, po.qty_received, po.unit_price_agreed, po.expected_delivery_date, " +
                "pr.sku, pr.name, t.name AS supplier FROM purchase_order po JOIN product pr ON pr.id = po.product_id LEFT JOIN tenant t ON t.id = po.wholesaler_tenant_id " +
                "WHERE po.retailer_tenant_id = ?" + (status == null ? "" : " AND po.status = ?") + " ORDER BY po.created_at DESC LIMIT 200";
        return status == null ? jdbc.queryForList(sql, p.tenantId()) : jdbc.queryForList(sql, p.tenantId(), status);
    }

    /** Wholesaler catalog push (paper Fig. 2: POST /api/erp/sync). */
    @PostMapping("/api/erp/sync")
    public ResponseEntity<Map<String, Object>> sync(@RequestBody JsonNode body) {
        Principal p = TenantContext.requireRole("WHOLESALER");
        if (!body.path("items").isArray()) {
            throw ApiException.bad("BAD_REQUEST", "items[] is required");
        }
        List<JsonNode> items = new ArrayList<>();
        body.get("items").forEach(items::add);
        boolean full = "FULL".equalsIgnoreCase(body.path("mode").asText("DELTA"));
        SupplierCatalogService.Result r = catalog.upsert(p.tenantId(), items, full);
        touch(p.tenantId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("accepted", r.upserted());
        out.put("rejected", r.rejected());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(out);
    }

    /** Federated-learning nodes pull only their own tenant's daily unit sales (scope cdin:node). */
    @GetMapping("/api/v1/cdin/training-data")
    public List<Map<String, Object>> trainingData(@RequestParam(defaultValue = "180") int days) {
        Principal p = TenantContext.requireRole("RETAILER");
        int d = Math.min(Math.max(days, 7), 400);
        return jdbc.queryForList("SELECT pr.gtin, to_char(s.day,'YYYY-MM-DD') AS day, s.units FROM sales_daily s JOIN product pr ON pr.id = s.product_id " +
                "WHERE s.tenant_id = ? AND pr.gtin IS NOT NULL AND s.day >= current_date - ?::int ORDER BY pr.gtin, s.day", p.tenantId(), d);
    }
}
