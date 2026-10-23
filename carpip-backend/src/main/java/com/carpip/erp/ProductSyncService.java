package com.carpip.erp;

import com.carpip.common.Money;
import com.carpip.domain.Product;
import com.carpip.domain.Repos;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Creates/updates retailer products from POS catalogs (Shopify products.json variants, or Path B inventory pushes). */
@Service
public class ProductSyncService {
    private static final Logger log = LoggerFactory.getLogger(ProductSyncService.class);
    private static final Set<String> CATEGORIES = Set.of("ELECTRONICS", "FOOD_BEVERAGE", "OFFICE", "LIFESTYLE");
    private final Repos.ProductRepo products;

    public ProductSyncService(Repos.ProductRepo products) {
        this.products = products;
    }

    public static String normalizeCategory(String raw) {
        if (raw == null) {
            return "LIFESTYLE";
        }
        String c = raw.trim().toUpperCase().replace(' ', '_').replace('&', '_').replace("__", "_");
        if (c.equals("FOOD_&_BEVERAGE") || c.equals("FOOD_BEVERAGE") || c.startsWith("FOOD")) {
            return "FOOD_BEVERAGE";
        }
        return CATEGORIES.contains(c) ? c : "LIFESTYLE";
    }

    @Transactional
    public Optional<Product> upsertShopifyVariant(UUID tenantId, JsonNode product, JsonNode variant) {
        String sku = variant.path("sku").asText("").trim();
        if (sku.isEmpty()) {
            return Optional.empty();
        }
        Product p = products.findByTenantIdAndSku(tenantId, sku).orElse(null);
        boolean isNew = p == null;
        if (isNew) {
            p = new Product();
            p.id = UUID.randomUUID();
            p.tenantId = tenantId;
            p.sku = sku;
            p.currentStock = 0;
            p.reorderPoint = 0;
        }
        String title = product.path("title").asText(sku);
        String vt = variant.path("title").asText("");
        p.name = vt.isBlank() || vt.equalsIgnoreCase("Default Title") ? title : title + " - " + vt;
        String barcode = variant.path("barcode").asText(null);
        if (barcode != null && !barcode.isBlank()) {
            p.gtin = barcode;
        }
        p.category = normalizeCategory(product.path("product_type").asText(null));
        if (variant.hasNonNull("price")) {
            p.retailPrice = Money.round2(new BigDecimal(variant.get("price").asText()));
        }
        p.perishable = "FOOD_BEVERAGE".equals(p.category);
        Integer shelf = null;
        for (String tag : product.path("tags").asText("").split(",")) {
            String t = tag.trim();
            if (t.startsWith("shelf_life:")) {
                try {
                    shelf = Integer.parseInt(t.substring("shelf_life:".length()));
                } catch (NumberFormatException ignored) {
                    // ignore malformed tag
                }
            }
        }
        p.shelfLifeDays = shelf != null ? shelf : (p.perishable ? 180 : null);
        Map<String, Object> ext = new HashMap<>(p.externalIds == null ? Map.of() : p.externalIds);
        ext.put("product_id", product.path("id").asText());
        ext.put("variant_id", variant.path("id").asText());
        ext.put("inventory_item_id", variant.path("inventory_item_id").asText());
        p.externalIds = ext;
        p.updatedAt = Instant.now();
        try {
            return Optional.of(products.saveAndFlush(p));
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            log.warn("product {} skipped (duplicate GTIN {}?): {}", sku, p.gtin, e.getMostSpecificCause().getMessage());
            return Optional.empty();
        }
    }

    @Transactional
    public void setCost(UUID productId, BigDecimal cost) {
        products.findById(productId).ifPresent(p -> {
            p.basePrice = Money.round2(cost);
            products.save(p);
        });
    }

    /** Path B (legacy POS) auto-creation from an inventory push that carries descriptive fields. */
    @Transactional
    public Optional<Product> upsertFromPush(UUID tenantId, JsonNode item) {
        String sku = item.path("sku").asText("").trim();
        String gtin = item.path("gtin").asText(null);
        Optional<Product> existing = sku.isEmpty() ? Optional.empty() : products.findByTenantIdAndSku(tenantId, sku);
        if (existing.isEmpty() && gtin != null && !gtin.isBlank()) {
            existing = products.findByTenantIdAndGtin(tenantId, gtin);
        }
        if (existing.isPresent()) {
            return existing;
        }
        if (sku.isEmpty() || !item.hasNonNull("name")) {
            return Optional.empty();
        }
        Product p = new Product();
        p.id = UUID.randomUUID();
        p.tenantId = tenantId;
        p.sku = sku;
        p.gtin = gtin;
        p.name = item.get("name").asText();
        p.category = normalizeCategory(item.path("category").asText(null));
        if (item.hasNonNull("price")) {
            p.retailPrice = Money.round2(new BigDecimal(item.get("price").asText()));
        }
        if (item.hasNonNull("cost")) {
            p.basePrice = Money.round2(new BigDecimal(item.get("cost").asText()));
        }
        p.perishable = "FOOD_BEVERAGE".equals(p.category);
        if (item.hasNonNull("shelfLifeDays")) {
            p.shelfLifeDays = item.get("shelfLifeDays").asInt();   // explicit branches: a mixed int/null ternary would NPE on unboxing
        } else if (p.perishable) {
            p.shelfLifeDays = 180;
        }
        return Optional.of(products.saveAndFlush(p));
    }
}
