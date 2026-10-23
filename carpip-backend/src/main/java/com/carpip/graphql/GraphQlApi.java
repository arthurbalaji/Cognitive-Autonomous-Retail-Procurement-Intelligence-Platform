package com.carpip.graphql;

import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import com.carpip.common.ApiException;
import graphql.analysis.MaxQueryComplexityInstrumentation;
import graphql.analysis.MaxQueryDepthInstrumentation;
import graphql.execution.instrumentation.Instrumentation;
import org.springframework.context.annotation.Bean;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Controller;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * GraphQL query engine. Every resolver derives the tenant from the authenticated principal – arguments can never
 * widen the scope. Depth (6) and complexity (500) are bounded; `first` is capped at 100.
 */
@Controller
public class GraphQlApi {
    private final JdbcTemplate jdbc;

    public GraphQlApi(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Bean
    Instrumentation maxDepth() {
        return new MaxQueryDepthInstrumentation(6);
    }

    @Bean
    Instrumentation maxComplexity() {
        return new MaxQueryComplexityInstrumentation(500);
    }

    private static int cap(Integer first) {
        return Math.min(Math.max(first == null ? 20 : first, 1), 100);
    }

    private Principal retailer() {
        return TenantContext.requireRole("RETAILER", "ADMIN");
    }

    private static final String STOCK_SQL =
            "SELECT p.sku AS \"sku\", p.gtin AS \"gtin\", p.name AS \"name\", p.category AS \"category\", p.current_stock AS \"currentStock\", v.on_order::int AS \"onOrder\", " +
                    "(p.current_stock + v.on_order)::int AS \"inventoryPosition\", p.reorder_point AS \"reorderPoint\", m.mpi::float8 AS \"mpi\", " +
                    "p.base_price::text AS \"basePrice\", p.retail_price::text AS \"retailPrice\" " +
                    "FROM product p JOIN v_inventory_position v ON v.product_id = p.id LEFT JOIN v_mpi_latest m ON m.product_id = p.id WHERE p.active ";

    @QueryMapping
    public List<Map<String, Object>> stockStatus(@Argument List<String> skus, @Argument Boolean belowReorderOnly, @Argument Integer first) {
        Principal p = retailer();
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder(STOCK_SQL);
        if (!p.isAdmin()) {
            sql.append("AND p.tenant_id = ? ");
            args.add(p.tenantId());
        }
        if (skus != null && !skus.isEmpty()) {
            sql.append("AND p.sku IN (").append(String.join(",", java.util.Collections.nCopies(skus.size(), "?"))).append(") ");
            args.addAll(skus);
        }
        if (Boolean.TRUE.equals(belowReorderOnly)) {
            sql.append("AND p.reorder_point > 0 AND p.current_stock + v.on_order <= p.reorder_point ");
        }
        sql.append("ORDER BY p.name LIMIT ").append(cap(first));
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    @QueryMapping
    public Map<String, Object> product(@Argument String sku) {
        Principal p = retailer();
        List<Map<String, Object>> r = p.isAdmin() ? jdbc.queryForList(STOCK_SQL + "AND p.sku = ? LIMIT 1", sku)
                : jdbc.queryForList(STOCK_SQL + "AND p.tenant_id = ? AND p.sku = ? LIMIT 1", p.tenantId(), sku);
        return r.isEmpty() ? null : r.get(0);
    }

    @QueryMapping
    public List<Map<String, Object>> reorderLimits(@Argument List<String> skus) {
        Principal p = retailer();
        if (skus.size() > 100) {
            throw ApiException.bad("TOO_MANY", "at most 100 skus per query");
        }
        String in = String.join(",", java.util.Collections.nCopies(skus.size(), "?"));
        List<Object> args = new ArrayList<>();
        String tenantClause = "";
        if (!p.isAdmin()) {
            tenantClause = "AND p.tenant_id = ? ";
            args.add(p.tenantId());
        }
        args.addAll(skus);
        return jdbc.queryForList("SELECT p.sku AS \"sku\", p.reorder_point AS \"reorderPoint\", p.rop_source AS \"ropSource\", (p.current_stock + v.on_order)::int AS \"inventoryPosition\", " +
                "(p.reorder_point > 0 AND p.current_stock + v.on_order <= p.reorder_point) AS \"belowReorderPoint\" FROM product p JOIN v_inventory_position v ON v.product_id = p.id " +
                "WHERE p.active " + tenantClause + "AND p.sku IN (" + in + ")", args.toArray());
    }

    @QueryMapping
    public List<Map<String, Object>> negotiations(@Argument Integer first) {
        Principal p = TenantContext.requireUser();
        String where = p.isAdmin() ? "" : p.isRetailer() ? "WHERE n.retailer_tenant_id = ? " : "WHERE n.wholesaler_tenant_id = ? ";
        String sql = "SELECT n.id::text AS \"id\", po.po_number AS \"poNumber\", pr.sku AS \"sku\", w.name AS \"supplier\", r.name AS \"retailer\", n.status AS \"status\", n.mode AS \"mode\", " +
                "n.base_price::text AS \"basePrice\", n.final_price::text AS \"finalPrice\", " +
                (p.isRetailer() ? "NULL::text" : "n.floor_price::text") + " AS \"floorPrice\", " +
                (p.isWholesaler() ? "NULL::text" : "n.retailer_max::text") + " AS \"retailerMax\", n.mpi_used::float8 AS \"mpiUsed\" " +
                "FROM negotiation n JOIN purchase_order po ON po.id = n.po_id JOIN product pr ON pr.id = po.product_id JOIN tenant w ON w.id = n.wholesaler_tenant_id " +
                "JOIN tenant r ON r.id = n.retailer_tenant_id " + where + "ORDER BY n.created_at DESC LIMIT " + cap(first);
        return p.isAdmin() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, p.tenantId());
    }

    @SchemaMapping(typeName = "Negotiation", field = "turns")
    public List<Map<String, Object>> turns(Map<String, Object> negotiation) {
        return jdbc.queryForList("SELECT turn_no AS \"turnNo\", actor AS \"actor\", action AS \"action\", price::text AS \"price\", source AS \"source\", clamped AS \"clamped\", message AS \"message\" " +
                "FROM negotiation_log WHERE negotiation_id = ?::uuid ORDER BY turn_no, id", negotiation.get("id"));
    }

    @QueryMapping
    public List<Map<String, Object>> purchaseOrders(@Argument List<String> status, @Argument Integer first) {
        Principal p = TenantContext.requireUser();
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder("WHERE 1=1 ");
        if (p.isRetailer()) {
            where.append("AND po.retailer_tenant_id = ? ");
            args.add(p.tenantId());
        } else if (p.isWholesaler()) {
            where.append("AND po.wholesaler_tenant_id = ? AND po.status NOT IN ('DRAFT','NEGOTIATING','NEGOTIATION_ERROR','PENDING_APPROVAL','APPROVED','NEGOTIATION_REJECTED','REJECTED_BY_USER','EXPIRED') ");
            args.add(p.tenantId());
        }
        if (status != null && !status.isEmpty()) {
            where.append("AND po.status IN (").append(String.join(",", java.util.Collections.nCopies(status.size(), "?"))).append(") ");
            args.addAll(status);
        }
        return jdbc.queryForList("SELECT po.po_number AS \"poNumber\", po.status AS \"status\", pr.sku AS \"sku\", pr.name AS \"product\", po.quantity AS \"quantity\", po.unit_price_agreed::text AS \"unitPrice\", " +
                "po.total_amount::text AS \"totalAmount\", w.name AS \"supplier\", r.name AS \"retailer\", po.expected_delivery_date::text AS \"expectedDelivery\" FROM purchase_order po " +
                "JOIN product pr ON pr.id = po.product_id JOIN tenant r ON r.id = po.retailer_tenant_id LEFT JOIN tenant w ON w.id = po.wholesaler_tenant_id " + where +
                "ORDER BY po.created_at DESC LIMIT " + cap(first), args.toArray());
    }

    @QueryMapping
    public List<Map<String, Object>> mpiHistory(@Argument String sku, @Argument Integer last) {
        Principal p = retailer();
        List<Object> args = new ArrayList<>();
        String tenant = "";
        if (!p.isAdmin()) {
            tenant = "AND pr.tenant_id = ? ";
            args.add(p.tenantId());
        }
        args.add(sku);
        args.add(Math.min(Math.max(last == null ? 96 : last, 1), 500));
        return jdbc.queryForList("SELECT to_char(s.computed_at,'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS \"computedAt\", s.mpi::float8 AS \"mpi\", s.trend AS \"trend\", s.quality AS \"quality\" " +
                "FROM intel_mpi_snapshot s JOIN product pr ON pr.id = s.product_id WHERE s.supplier_tenant_id IS NULL " + tenant + "AND pr.sku = ? ORDER BY s.computed_at DESC LIMIT ?", args.toArray());
    }

    @QueryMapping
    public List<Map<String, Object>> reorderSignals(@Argument Integer horizonDays) {
        Principal p = TenantContext.requireRole("WHOLESALER", "ADMIN");
        int h = Math.min(Math.max(horizonDays == null ? 14 : horizonDays, 1), 28);
        String filter = p.isAdmin() ? "" : "AND o.wholesaler_tenant_id = ? ";
        String sql = "SELECT o.gtin AS \"gtin\", min(o.name) AS \"name\", count(DISTINCT pr.tenant_id)::int AS \"retailersTracking\", " +
                "count(DISTINCT pr.tenant_id) FILTER (WHERE pr.reorder_point > 0 AND pr.current_stock + v.on_order <= pr.reorder_point)::int AS \"retailersBelowRop\", " +
                "COALESCE(sum((SELECT sum(s.units) FROM sales_daily s WHERE s.product_id = pr.id AND s.day >= current_date - 7)),0)::int AS \"unitsSold7d\", " +
                "COALESCE(sum((SELECT sum(f.yhat) FROM intel_forecast f WHERE f.product_id = pr.id AND f.target_date < current_date + " + h + ")),0)::float8 AS \"forecastUnits14d\", " +
                "avg(m.mpi)::float8 AS \"avgMpi\", " +
                "COALESCE(sum(GREATEST(pr.reorder_point - (pr.current_stock + v.on_order), 0)),0)::int AS \"shortfallUnits\" " +
                "FROM supplier_offer o JOIN trade_relationship tr ON tr.wholesaler_tenant_id = o.wholesaler_tenant_id AND tr.status = 'ACTIVE' " +
                "JOIN product pr ON pr.tenant_id = tr.retailer_tenant_id AND pr.gtin = o.gtin JOIN v_inventory_position v ON v.product_id = pr.id " +
                "LEFT JOIN v_mpi_latest m ON m.product_id = pr.id WHERE o.active " + filter +
                "GROUP BY o.gtin ORDER BY \"retailersBelowRop\" DESC, \"shortfallUnits\" DESC LIMIT 100";
        return p.isAdmin() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, p.tenantId());
    }

    @SuppressWarnings("unused")
    private Map<String, Object> unused() {
        return new LinkedHashMap<>();
    }

    @SuppressWarnings("unused")
    private UUID unusedId() {
        return null;
    }
}
