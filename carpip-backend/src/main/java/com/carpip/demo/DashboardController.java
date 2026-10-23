package com.carpip.demo;

import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class DashboardController {
    private final JdbcTemplate jdbc;

    public DashboardController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/dashboard/summary")
    public Map<String, Object> summary() {
        Principal p = TenantContext.requireUser();
        if (p.isRetailer()) {
            return retailer(p.tenantId());
        }
        if (p.isWholesaler()) {
            return wholesaler(p.tenantId());
        }
        return admin();
    }

    private Map<String, Object> retailer(UUID t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("role", "RETAILER");
        m.put("kpis", jdbc.queryForMap(
                "SELECT count(*) AS products, " +
                        "count(*) FILTER (WHERE p.reorder_point > 0 AND p.current_stock + v.on_order <= p.reorder_point) AS below_rop, " +
                        "count(*) FILTER (WHERE p.current_stock <= 0) AS stockouts, " +
                        "COALESCE(round(avg(mp.mpi)::numeric, 3), 0) AS avg_mpi " +
                        "FROM product p JOIN v_inventory_position v ON v.product_id = p.id LEFT JOIN v_mpi_latest mp ON mp.product_id = p.id WHERE p.tenant_id = ? AND p.active", t));
        m.put("openPurchaseOrders", jdbc.queryForList(
                "SELECT status, count(*) AS n FROM purchase_order WHERE retailer_tenant_id = ? AND status NOT IN ('CLOSED','CANCELLED','NEGOTIATION_REJECTED','REJECTED_BY_USER','EXPIRED','DECLINED_BY_SUPPLIER') GROUP BY status ORDER BY n DESC", t));
        m.put("savings", jdbc.queryForMap(
                "SELECT COALESCE(sum(discount_savings),0) AS total_savings, count(*) AS orders FROM purchase_order WHERE retailer_tenant_id = ? AND negotiation_status = 'ACCEPTED' " +
                        "AND status NOT IN ('CANCELLED','REJECTED_BY_USER','EXPIRED')", t));
        m.put("negotiation", jdbc.queryForMap(
                "SELECT count(*) AS total, count(*) FILTER (WHERE status='ACCEPTED') AS accepted, COALESCE(round(avg(latency_ms)),0) AS avg_latency_ms, " +
                        "COALESCE(sum(guardrail_interventions),0) AS guardrail_interventions FROM negotiation WHERE retailer_tenant_id = ?", t));
        m.put("pendingApprovals", jdbc.queryForObject("SELECT count(*) FROM purchase_order WHERE retailer_tenant_id=? AND status='PENDING_APPROVAL'", Integer.class, t));
        m.put("salesSeries", jdbc.queryForList(
                "SELECT to_char(d.day,'YYYY-MM-DD') AS date, COALESCE(sum(s.units),0) AS units, COALESCE(sum(s.revenue),0) AS revenue " +
                        "FROM generate_series(current_date - 29, current_date, interval '1 day') d(day) " +
                        "LEFT JOIN sales_daily s ON s.day = d.day::date AND s.tenant_id = ? GROUP BY d.day ORDER BY d.day", t));
        m.put("recentOrders", jdbc.queryForList(
                "SELECT po.id, po.po_number, po.status, po.quantity, po.unit_price_agreed, po.total_amount, po.discount_savings, p.name AS product, w.name AS supplier, po.created_at " +
                        "FROM purchase_order po JOIN product p ON p.id = po.product_id LEFT JOIN tenant w ON w.id = po.wholesaler_tenant_id " +
                        "WHERE po.retailer_tenant_id = ? ORDER BY po.created_at DESC LIMIT 8", t));
        m.put("lowStock", jdbc.queryForList(
                "SELECT p.id, p.sku, p.name, p.current_stock, p.reorder_point, v.on_order, mp.mpi FROM product p JOIN v_inventory_position v ON v.product_id = p.id " +
                        "LEFT JOIN v_mpi_latest mp ON mp.product_id = p.id WHERE p.tenant_id = ? AND p.active AND p.reorder_point > 0 " +
                        "ORDER BY (p.current_stock + v.on_order)::float8 / p.reorder_point LIMIT 8", t));
        return m;
    }

    private Map<String, Object> wholesaler(UUID t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("role", "WHOLESALER");
        m.put("kpis", jdbc.queryForMap(
                "SELECT (SELECT count(*) FROM supplier_offer WHERE wholesaler_tenant_id = ? AND active) AS offers, " +
                        "(SELECT count(*) FROM supplier_offer WHERE wholesaler_tenant_id = ? AND active AND available_qty < moq * 2) AS low_stock_offers, " +
                        "(SELECT count(*) FROM purchase_order WHERE wholesaler_tenant_id = ? AND status IN ('SUBMITTED','CONFIRMED','PARTIALLY_CONFIRMED','PARTIALLY_SHIPPED','SHIPPED')) AS open_orders, " +
                        "(SELECT COALESCE(sum(total_amount),0) FROM purchase_order WHERE wholesaler_tenant_id = ? AND status IN ('DELIVERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')) AS revenue", t, t, t, t));
        m.put("orders", jdbc.queryForList("SELECT status, count(*) AS n FROM purchase_order WHERE wholesaler_tenant_id = ? GROUP BY status ORDER BY n DESC", t));
        return m;
    }

    private Map<String, Object> admin() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("role", "ADMIN");
        m.put("tenants", jdbc.queryForList("SELECT type, count(*) AS n FROM tenant GROUP BY type"));
        m.put("kpis", jdbc.queryForMap("SELECT (SELECT count(*) FROM product) AS products, (SELECT count(*) FROM purchase_order) AS purchase_orders, " +
                "(SELECT count(*) FROM negotiation) AS negotiations, (SELECT COALESCE(sum(discount_savings),0) FROM purchase_order WHERE negotiation_status='ACCEPTED' AND status NOT IN ('CANCELLED','REJECTED_BY_USER','EXPIRED')) AS total_savings"));
        m.put("purchaseOrders", jdbc.queryForList("SELECT status, count(*) AS n FROM purchase_order GROUP BY status ORDER BY n DESC"));
        m.put("recentOrders", jdbc.queryForList(
                "SELECT po.id, po.po_number, po.status, po.quantity, po.unit_price_agreed, po.total_amount, po.discount_savings, p.name AS product, w.name AS supplier, r.name AS retailer, po.created_at " +
                        "FROM purchase_order po JOIN product p ON p.id = po.product_id JOIN tenant r ON r.id = po.retailer_tenant_id LEFT JOIN tenant w ON w.id = po.wholesaler_tenant_id " +
                        "ORDER BY po.created_at DESC LIMIT 10"));
        return m;
    }

    @SuppressWarnings("unused")
    private List<Object> unused() {
        return List.of();
    }
}
