package com.carpip.erp;

import com.carpip.common.Money;
import com.carpip.domain.IntegrationConnection;
import com.carpip.procurement.PurchaseOrderService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;

/** Handles signed ERP -> CARPIP webhooks for wholesaler tenants (PO lifecycle, stock and price changes). */
@Service
public class SupplierEventService {
    private final PurchaseOrderService poService;
    private final JdbcTemplate jdbc;

    public SupplierEventService(PurchaseOrderService poService, JdbcTemplate jdbc) {
        this.poService = poService;
        this.jdbc = jdbc;
    }

    /** Runs inside the caller's transaction. Never throws for business conflicts. */
    public String handle(IntegrationConnection c, JsonNode body) {
        String type = body.path("type").asText("");
        switch (type) {
            case "sales_order.confirmed", "sales_order.rejected", "shipment.created", "sales_order.delivered", "sales_order.cancelled" -> {
                return poService.onSupplierEvent(c.tenantId, type, body);
            }
            case "stock.changed" -> {
                int n = 0;
                for (JsonNode it : body.path("items")) {
                    n += jdbc.update("UPDATE supplier_offer SET available_qty=?, synced_at=now() WHERE wholesaler_tenant_id=? AND supplier_sku=?",
                            Math.max(0, it.path("availableQty").asInt(0)), c.tenantId, it.path("supplierSku").asText());
                }
                return "APPLIED_STOCK_" + n;
            }
            case "price_list.updated" -> {
                int n = 0;
                for (JsonNode it : body.path("items")) {
                    BigDecimal price = Money.round2(new BigDecimal(it.path("listPrice").asText("0")));
                    if (price.signum() <= 0) {
                        continue;
                    }
                    n += jdbc.update("UPDATE supplier_offer SET list_price=?, price_tiers=COALESCE(?::jsonb, price_tiers), synced_at=now() WHERE wholesaler_tenant_id=? AND supplier_sku=?",
                            price, it.has("priceTiers") ? it.get("priceTiers").toString() : null, c.tenantId, it.path("supplierSku").asText());
                    jdbc.update("INSERT INTO supplier_price_history(wholesaler_tenant_id, gtin, price) " +
                            "SELECT wholesaler_tenant_id, gtin, ? FROM supplier_offer WHERE wholesaler_tenant_id=? AND supplier_sku=? AND gtin IS NOT NULL",
                            price, c.tenantId, it.path("supplierSku").asText());
                }
                return "APPLIED_PRICES_" + n;
            }
            default -> {
                return "IGNORED_UNKNOWN_EVENT";
            }
        }
    }
}
