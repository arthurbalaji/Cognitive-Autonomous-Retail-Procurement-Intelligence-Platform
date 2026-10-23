package com.carpip.catalog;

import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import com.carpip.common.ApiException;
import com.carpip.domain.Product;
import com.carpip.domain.Repos;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class CatalogController {
    private final JdbcTemplate jdbc;
    private final Repos.ProductRepo products;
    private final RopService rop;

    public CatalogController(JdbcTemplate jdbc, Repos.ProductRepo products, RopService rop) {
        this.jdbc = jdbc;
        this.products = products;
        this.rop = rop;
    }

    private static final String LIST_SQL =
            "SELECT p.id, p.sku, p.gtin, p.name, p.category, p.current_stock, p.reorder_point, p.rop_source, p.base_price, p.retail_price, p.perishable, " +
                    "v.on_order, (p.current_stock + v.on_order) AS position, m.mpi, m.trend, m.quality, p.reorder_blocked_until, " +
                    "(SELECT po.status FROM purchase_order po WHERE po.product_id = p.id AND po.status NOT IN ('CLOSED','CANCELLED','NEGOTIATION_REJECTED','REJECTED_BY_USER','EXPIRED','DECLINED_BY_SUPPLIER') " +
                    " ORDER BY po.created_at DESC LIMIT 1) AS open_po_status, " +
                    "(SELECT COALESCE(SUM(s.units),0) FROM sales_daily s WHERE s.product_id = p.id AND s.day >= current_date - 7) AS units_7d " +
                    "FROM product p JOIN v_inventory_position v ON v.product_id = p.id LEFT JOIN v_mpi_latest m ON m.product_id = p.id ";

    @GetMapping("/api/products")
    public Map<String, Object> list(@RequestParam(required = false) String q, @RequestParam(defaultValue = "false") boolean belowRop,
                                    @RequestParam(required = false) String category,
                                    @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "50") int size) {
        Principal pr = TenantContext.requireRole("RETAILER", "ADMIN");
        int s = Math.min(Math.max(size, 1), 200);
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE p.active ");
        if (pr.isRetailer()) {
            where.append("AND p.tenant_id = ? ");
            args.add(pr.tenantId());
        }
        if (q != null && !q.isBlank()) {
            where.append("AND (p.name ILIKE ? OR p.sku ILIKE ? OR p.gtin = ?) ");
            args.add("%" + q + "%");
            args.add("%" + q + "%");
            args.add(q);
        }
        if (category != null && !category.isBlank()) {
            where.append("AND p.category = ? ");
            args.add(category);
        }
        if (belowRop) {
            where.append("AND p.reorder_point > 0 AND (p.current_stock + v.on_order) <= p.reorder_point ");
        }
        Long total = jdbc.queryForObject("SELECT count(*) FROM product p JOIN v_inventory_position v ON v.product_id = p.id" + where, Long.class, args.toArray());
        List<Object> a2 = new ArrayList<>(args);
        a2.add(s);
        a2.add(Math.max(page, 0) * s);
        List<Map<String, Object>> rows = jdbc.queryForList(LIST_SQL + where + " ORDER BY (p.current_stock + v.on_order)::float8 / NULLIF(p.reorder_point,0) NULLS LAST, p.name LIMIT ? OFFSET ?", a2.toArray());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", total);
        out.put("page", page);
        out.put("items", rows);
        return out;
    }

    private Product mine(UUID id) {
        Principal pr = TenantContext.requireRole("RETAILER", "ADMIN");
        Product p = products.findById(id).orElseThrow(() -> ApiException.notFound("product"));
        if (pr.isRetailer() && !p.tenantId.equals(pr.tenantId())) {
            throw ApiException.notFound("product"); // 404, never 403, for other tenants' resources
        }
        return p;
    }

    @GetMapping("/api/products/{id}")
    public Map<String, Object> get(@PathVariable UUID id) {
        Product p = mine(id);
        List<Map<String, Object>> r = jdbc.queryForList(LIST_SQL + " WHERE p.id = ?", id);
        Map<String, Object> m = new LinkedHashMap<>(r.get(0));
        m.put("shelfLifeDays", p.shelfLifeDays);
        m.put("externalIds", p.externalIds);
        return m;
    }

    public record PatchProduct(Integer reorderPoint, String ropSource, java.math.BigDecimal retailPrice) {
    }

    @PatchMapping("/api/products/{id}")
    public Map<String, Object> patch(@PathVariable UUID id, @RequestBody PatchProduct req) {
        Product p = mine(id);
        if (req.reorderPoint() != null) {
            if (req.reorderPoint() < 0) {
                throw ApiException.bad("BAD_REQUEST", "reorderPoint must be >= 0");
            }
            p.reorderPoint = req.reorderPoint();
            p.ropSource = "MANUAL";
        }
        if (req.ropSource() != null && List.of("AUTO", "MANUAL").contains(req.ropSource())) {
            p.ropSource = req.ropSource();
        }
        if (req.retailPrice() != null) {
            p.retailPrice = req.retailPrice();
        }
        p.updatedAt = Instant.now();
        products.save(p);
        return get(id);
    }

    @GetMapping("/api/products/{id}/forecast")
    public List<Map<String, Object>> forecast(@PathVariable UUID id) {
        mine(id);
        return jdbc.queryForList("SELECT to_char(target_date,'YYYY-MM-DD') AS date, yhat, yhat_lo, yhat_hi, model_version FROM intel_forecast WHERE product_id=? ORDER BY target_date", id);
    }

    @GetMapping("/api/products/{id}/mpi")
    public List<Map<String, Object>> mpi(@PathVariable UUID id, @RequestParam(defaultValue = "96") int last) {
        mine(id);
        return jdbc.queryForList("SELECT * FROM (SELECT computed_at, mpi, dp, sa, pv, si, cs, trend, quality FROM intel_mpi_snapshot WHERE product_id=? AND supplier_tenant_id IS NULL " +
                "ORDER BY computed_at DESC LIMIT ?) x ORDER BY computed_at", id, Math.min(Math.max(last, 1), 500));
    }

    @GetMapping("/api/products/{id}/movements")
    public List<Map<String, Object>> movements(@PathVariable UUID id) {
        mine(id);
        return jdbc.queryForList("SELECT at, mode, delta, qty_before, qty_after, reason, reference FROM stock_movement WHERE product_id=? ORDER BY at DESC, id DESC LIMIT 60", id);
    }

    @GetMapping("/api/products/{id}/sales")
    public List<Map<String, Object>> sales(@PathVariable UUID id, @RequestParam(defaultValue = "60") int days) {
        mine(id);
        return jdbc.queryForList("SELECT to_char(day,'YYYY-MM-DD') AS date, units, revenue FROM sales_daily WHERE product_id=? AND day >= current_date - ?::int ORDER BY day",
                id, Math.min(Math.max(days, 7), 365));
    }

    @GetMapping("/api/suppliers/offers")
    public List<Map<String, Object>> offers(@RequestParam(required = false) String gtin) {
        Principal pr = TenantContext.requireUser();
        String sql = "SELECT o.id, o.wholesaler_tenant_id, t.name AS supplier, o.supplier_sku, o.gtin, o.name, o.category, o.pack_size, o.moq, o.list_price, o.price_tiers, " +
                "o.available_qty, o.lead_time_days, o.shipping_reliability, o.nearest_expiry, o.max_discount_pct, o.active, o.synced_at FROM supplier_offer o " +
                "JOIN tenant t ON t.id = o.wholesaler_tenant_id WHERE o.active ";
        List<Object> args = new ArrayList<>();
        if (pr.isWholesaler()) {
            sql += "AND o.wholesaler_tenant_id = ? ";
            args.add(pr.tenantId());
        } else if (pr.isRetailer()) {
            sql += "AND o.wholesaler_tenant_id IN (SELECT wholesaler_tenant_id FROM trade_relationship WHERE retailer_tenant_id = ? AND status='ACTIVE') ";
            args.add(pr.tenantId());
        }
        if (gtin != null) {
            sql += "AND o.gtin = ? ";
            args.add(gtin);
        }
        sql += "ORDER BY o.name, o.list_price LIMIT 500";
        return jdbc.queryForList(sql, args.toArray());
    }

    @PostMapping("/api/products/recompute-rop")
    public Map<String, Object> recomputeRop() {
        Principal pr = TenantContext.requireRole("RETAILER", "ADMIN");
        int n = pr.isAdmin() ? rop.recomputeAll() : rop.recompute(pr.tenantId());
        return Map.of("updated", n);
    }
}
