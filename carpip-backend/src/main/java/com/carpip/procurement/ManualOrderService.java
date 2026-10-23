package com.carpip.procurement;

import com.carpip.common.ApiException;
import com.carpip.common.Money;
import com.carpip.domain.Product;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Year;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** "Order at list price" path of the manual-PO flow (no AI negotiation; negotiation_status = SKIPPED). */
@Service
public class ManualOrderService {
    private final Repos.ProductRepo products;
    private final Repos.PurchaseOrderRepo pos;
    private final JdbcTemplate jdbc;
    private final ProcurementService procurement;
    private final PurchaseOrderService poService;

    public ManualOrderService(Repos.ProductRepo products, Repos.PurchaseOrderRepo pos, JdbcTemplate jdbc, ProcurementService procurement, PurchaseOrderService poService) {
        this.products = products;
        this.pos = pos;
        this.jdbc = jdbc;
        this.procurement = procurement;
        this.poService = poService;
    }

    @Transactional
    public PurchaseOrder createListPricePo(UUID retailerTenantId, UUID productId, UUID supplierTenantId, int qty, String actor) {
        Product p = products.findByIdAndTenantId(productId, retailerTenantId).orElseThrow(() -> ApiException.notFound("product"));
        if (p.gtin == null) {
            throw ApiException.bad("NO_GTIN", "product has no GTIN, cannot match supplier offers");
        }
        List<Map<String, Object>> rel = jdbc.queryForList("SELECT 1 FROM trade_relationship WHERE retailer_tenant_id=? AND wholesaler_tenant_id=? AND status='ACTIVE'", retailerTenantId, supplierTenantId);
        if (rel.isEmpty()) {
            throw ApiException.conflict("NO_TRADE_RELATIONSHIP", "you have no active trade relationship with this supplier");
        }
        List<Map<String, Object>> offers = jdbc.queryForList("SELECT list_price, price_tiers::text AS tiers, moq, pack_size, available_qty, lead_time_days FROM supplier_offer " +
                "WHERE wholesaler_tenant_id=? AND gtin=? AND active LIMIT 1", supplierTenantId, p.gtin);
        if (offers.isEmpty()) {
            throw ApiException.conflict("NO_OFFER", "supplier does not list this item");
        }
        Map<String, Object> o = offers.get(0);
        int moq = ((Number) o.get("moq")).intValue();
        int pack = ((Number) o.get("pack_size")).intValue();
        int avail = ((Number) o.get("available_qty")).intValue();
        if (qty < moq) {
            throw ApiException.bad("BELOW_MOQ", "quantity below supplier MOQ " + moq);
        }
        if (pack > 1 && qty % pack != 0) {
            throw ApiException.bad("PACK_SIZE", "quantity must be a multiple of pack size " + pack);
        }
        if (qty > avail) {
            throw ApiException.bad("EXCEEDS_AVAILABLE", "supplier only has " + avail + " available");
        }
        BigDecimal price = Money.bd(o.get("list_price"));
        JsonNode tiers = com.carpip.common.Json.read((String) o.get("tiers"));
        int bestMin = -1;
        if (tiers.isArray()) {
            for (JsonNode t : tiers) {
                int min = t.path("minQty").asInt(Integer.MAX_VALUE);
                if (qty >= min && min > bestMin) {
                    bestMin = min;
                    price = Money.bd(t.path("unitPrice").asText());
                }
            }
        }
        Long seq = jdbc.queryForObject("SELECT nextval('po_number_seq')", Long.class);
        PurchaseOrder po = new PurchaseOrder();
        po.id = UUID.randomUUID();
        po.poNumber = "CPO-" + Year.now().getValue() + "-" + String.format("%06d", seq);
        po.retailerTenantId = retailerTenantId;
        po.wholesalerTenantId = supplierTenantId;
        po.productId = productId;
        po.origin = "MANUAL";
        po.trigger = "MANUAL";
        po.status = "DRAFT";
        po.negotiationStatus = "SKIPPED";
        po.quantity = qty;
        po.unitPriceAgreed = Money.round2(price);
        po.basePrice = po.unitPriceAgreed;
        po.totalAmount = Money.round2(po.unitPriceAgreed.multiply(BigDecimal.valueOf(qty)));
        po.expectedDeliveryDate = LocalDate.now().plusDays(((Number) o.get("lead_time_days")).longValue());
        po.decision = new HashMap<>(Map.of("outcome", "LIST_PRICE", "note", "ordered at list price by " + actor));
        pos.saveAndFlush(po);
        procurement.history(po.id, null, "DRAFT", "manual list-price order", actor);
        return poService.transition(po, "APPROVED", "approved: manual order at list price by " + actor, actor);
    }
}
