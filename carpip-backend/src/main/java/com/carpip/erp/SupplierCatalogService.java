package com.carpip.erp;

import com.carpip.common.Json;
import com.carpip.common.Money;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Upserts a wholesaler's catalog (from POST /api/erp/sync or from polling a vendor ERP) into supplier_offer. */
@Service
public class SupplierCatalogService {
    private final JdbcTemplate jdbc;

    public SupplierCatalogService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Result(int upserted, List<Map<String, Object>> rejected) {
    }

    private static Map<String, Object> reject(int idx, String code, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("index", idx);
        m.put("code", code);
        m.put("detail", detail);
        return m;
    }

    @Transactional
    public Result upsert(UUID wholesalerTenantId, List<JsonNode> items, boolean full) {
        Instant start = Instant.now();
        List<Map<String, Object>> rejected = new ArrayList<>();
        int ok = 0;
        for (int i = 0; i < items.size(); i++) {
            JsonNode it = items.get(i);
            String sku = it.path("supplierSku").asText("").trim();
            String name = it.path("name").asText("").trim();
            if (sku.isEmpty() || name.isEmpty()) {
                rejected.add(reject(i, "MISSING_FIELDS", "supplierSku and name are required"));
                continue;
            }
            BigDecimal price;
            try {
                price = Money.round2(new BigDecimal(it.path("listPrice").asText("0")));
            } catch (NumberFormatException e) {
                rejected.add(reject(i, "BAD_PRICE", "listPrice is not a number"));
                continue;
            }
            if (price.signum() <= 0) {
                rejected.add(reject(i, "BAD_PRICE", "listPrice must be > 0"));
                continue;
            }
            int pack = Math.max(1, it.path("packSize").asInt(1));
            int moq = Math.max(1, it.path("moq").asInt(1));
            int avail = Math.max(0, it.path("availableQty").asInt(0));
            int lead = Math.min(90, Math.max(0, it.path("leadTimeDays").asInt(3)));
            BigDecimal rel = new BigDecimal(it.path("shippingReliability").asText("0.9"));
            rel = rel.max(BigDecimal.ZERO).min(BigDecimal.ONE);
            BigDecimal maxDisc = new BigDecimal(it.path("maxDiscountPct").asText("0.2")).max(BigDecimal.ZERO).min(new BigDecimal("0.5"));
            String gtin = it.hasNonNull("gtin") ? it.get("gtin").asText() : null;
            java.sql.Date expiry = null;
            if (it.hasNonNull("nearestExpiry")) {
                try {
                    expiry = java.sql.Date.valueOf(LocalDate.parse(it.get("nearestExpiry").asText().substring(0, 10)));
                } catch (Exception e) {
                    rejected.add(reject(i, "BAD_EXPIRY", "nearestExpiry must be YYYY-MM-DD"));
                    continue;
                }
            }
            JsonNode tiers = it.has("priceTiers") && it.get("priceTiers").isArray() ? it.get("priceTiers") : Json.M.createArrayNode();
            // price history for volatility (PV) – only when the list price changes
            List<BigDecimal> prev = jdbc.queryForList("SELECT list_price FROM supplier_offer WHERE wholesaler_tenant_id=? AND supplier_sku=?", BigDecimal.class, wholesalerTenantId, sku);
            if (gtin != null && (prev.isEmpty() || prev.get(0).compareTo(price) != 0)) {
                jdbc.update("INSERT INTO supplier_price_history(wholesaler_tenant_id, gtin, price) VALUES (?,?,?)", wholesalerTenantId, gtin, price);
            }
            jdbc.update("INSERT INTO supplier_offer(id, wholesaler_tenant_id, supplier_sku, gtin, name, category, uom, pack_size, moq, list_price, price_tiers, available_qty, " +
                            "lead_time_days, shipping_reliability, nearest_expiry, shelf_life_days, max_discount_pct, active, synced_at) " +
                            "VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?,?,true,?) " +
                            "ON CONFLICT (wholesaler_tenant_id, supplier_sku) DO UPDATE SET gtin=EXCLUDED.gtin, name=EXCLUDED.name, category=EXCLUDED.category, uom=EXCLUDED.uom, " +
                            "pack_size=EXCLUDED.pack_size, moq=EXCLUDED.moq, list_price=EXCLUDED.list_price, price_tiers=EXCLUDED.price_tiers, available_qty=EXCLUDED.available_qty, " +
                            "lead_time_days=EXCLUDED.lead_time_days, shipping_reliability=EXCLUDED.shipping_reliability, nearest_expiry=EXCLUDED.nearest_expiry, " +
                            "shelf_life_days=EXCLUDED.shelf_life_days, max_discount_pct=EXCLUDED.max_discount_pct, active=true, synced_at=EXCLUDED.synced_at",
                    UUID.randomUUID(), wholesalerTenantId, sku, gtin, name, it.path("category").asText(null), it.path("uom").asText("EA"), pack, moq, price,
                    Json.write(tiers), avail, lead, rel, expiry,
                    it.hasNonNull("shelfLifeDays") ? it.get("shelfLifeDays").asInt() : null, maxDisc, Timestamp.from(start));
            ok++;
        }
        if (full && ok > 0) {
            jdbc.update("UPDATE supplier_offer SET active=false WHERE wholesaler_tenant_id=? AND synced_at < ?", wholesalerTenantId, Timestamp.from(start));
        }
        return new Result(ok, rejected);
    }
}
