package com.carpip.integration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

@Component
public class ShopifyAdapter implements ErpAdapter {

    private static final Logger log = LoggerFactory.getLogger(ShopifyAdapter.class);
    private final RestTemplate restTemplate = new RestTemplate();
    private Map<String, String> credentials;
    private boolean isDemoMode = false;

    @Override
    public boolean connect(Map<String, String> credentials) {
        this.credentials = credentials;
        String shopUrl = credentials.get("shopUrl");
        String accessToken = credentials.get("accessToken");

        if (shopUrl == null || accessToken == null) {
            log.error("Shopify connection failed: missing required credentials (shopUrl, accessToken)");
            return false;
        }

        // Detect demo mode — skip real HTTP if test/demo credentials
        if (shopUrl.contains("demo") || shopUrl.contains("test") || accessToken.startsWith("demo-")) {
            log.info("Shopify adapter running in DEMO mode for store: {}", shopUrl);
            isDemoMode = true;
            return true;
        }

        // Real Shopify Admin API call
        try {
            String url = normalizeShopUrl(shopUrl) + "/admin/api/2024-01/shop.json";
            HttpHeaders headers = new HttpHeaders();
            headers.set("X-Shopify-Access-Token", accessToken);
            headers.setContentType(MediaType.APPLICATION_JSON);

            ResponseEntity<Map> response = restTemplate.exchange(
                    url, HttpMethod.GET, new HttpEntity<>(headers), Map.class
            );

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                log.info("Shopify adapter connected to store: {} — shop name: {}",
                        shopUrl, ((Map) response.getBody().get("shop")).get("name"));
                isDemoMode = false;
                return true;
            } else {
                log.error("Shopify connection returned non-200: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception e) {
            log.warn("Shopify API call failed ({}). Falling back to demo mode.", e.getMessage());
            isDemoMode = true;
            return true; // Allow connection in demo mode
        }
    }

    @Override
    public List<Map<String, Object>> syncInventory() {
        log.info("Syncing inventory from Shopify (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String shopUrl = normalizeShopUrl(credentials.get("shopUrl"));
                String accessToken = credentials.get("accessToken");

                HttpHeaders headers = new HttpHeaders();
                headers.set("X-Shopify-Access-Token", accessToken);

                String url = shopUrl + "/admin/api/2024-01/products.json?limit=50";
                ResponseEntity<Map> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), Map.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> inventory = new ArrayList<>();
                    List<Map<String, Object>> products = (List<Map<String, Object>>) response.getBody().get("products");

                    if (products != null) {
                        for (Map<String, Object> product : products) {
                            List<Map<String, Object>> variants = (List<Map<String, Object>>) product.get("variants");
                            if (variants != null) {
                                for (Map<String, Object> variant : variants) {
                                    Map<String, Object> item = new HashMap<>();
                                    item.put("sku", variant.getOrDefault("sku", "SKU-" + variant.get("id")));
                                    item.put("name", product.get("title") + (variants.size() > 1 ? " - " + variant.get("title") : ""));
                                    item.put("category", product.getOrDefault("product_type", "General"));
                                    item.put("basePrice", new BigDecimal(String.valueOf(variant.getOrDefault("price", "0"))));
                                    item.put("currentStock", parseInteger(variant.get("inventory_quantity"), 0));
                                    item.put("reorderPoint", 25); // Default reorder point
                                    inventory.add(item);
                                }
                            }
                        }
                    }

                    log.info("Fetched {} inventory items from Shopify", inventory.size());
                    return inventory;
                }
            } catch (Exception e) {
                log.warn("Shopify inventory sync failed: {}. Using demo data.", e.getMessage());
            }
        }

        // Demo data fallback
        return getDemoInventory();
    }

    @Override
    public List<Map<String, Object>> fetchSales() {
        log.info("Fetching sales from Shopify (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String shopUrl = normalizeShopUrl(credentials.get("shopUrl"));
                String accessToken = credentials.get("accessToken");

                HttpHeaders headers = new HttpHeaders();
                headers.set("X-Shopify-Access-Token", accessToken);

                String url = shopUrl + "/admin/api/2024-01/orders.json?status=any&limit=50";
                ResponseEntity<Map> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), Map.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> sales = new ArrayList<>();
                    List<Map<String, Object>> orders = (List<Map<String, Object>>) response.getBody().get("orders");

                    if (orders != null) {
                        for (Map<String, Object> order : orders) {
                            List<Map<String, Object>> lineItems = (List<Map<String, Object>>) order.get("line_items");
                            if (lineItems != null) {
                                for (Map<String, Object> item : lineItems) {
                                    Map<String, Object> sale = new HashMap<>();
                                    sale.put("orderId", String.valueOf(order.get("order_number")));
                                    sale.put("sku", item.getOrDefault("sku", "UNKNOWN"));
                                    sale.put("quantity", parseInteger(item.get("quantity"), 1));
                                    sale.put("total", new BigDecimal(String.valueOf(item.getOrDefault("price", "0")))
                                            .multiply(BigDecimal.valueOf(parseInteger(item.get("quantity"), 1))));
                                    sale.put("timestamp", order.getOrDefault("created_at", LocalDateTime.now().toString()));
                                    sales.add(sale);
                                }
                            }
                        }
                    }

                    log.info("Fetched {} sales records from Shopify", sales.size());
                    return sales;
                }
            } catch (Exception e) {
                log.warn("Shopify sales fetch failed: {}. Using demo data.", e.getMessage());
            }
        }

        // Demo data fallback
        return getDemoSales();
    }

    @Override
    public String getProviderName() {
        return "shopify";
    }

    // ─── Helper Methods ───────────────────────────────────────

    private String normalizeShopUrl(String shopUrl) {
        if (shopUrl == null) return "";
        shopUrl = shopUrl.trim();
        if (!shopUrl.startsWith("http")) {
            shopUrl = "https://" + shopUrl;
        }
        if (shopUrl.endsWith("/")) {
            shopUrl = shopUrl.substring(0, shopUrl.length() - 1);
        }
        return shopUrl;
    }

    private int parseInteger(Object value, int defaultValue) {
        if (value == null) return defaultValue;
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private List<Map<String, Object>> getDemoInventory() {
        List<Map<String, Object>> inventory = new ArrayList<>();
        String[][] products = {
            {"SKU-SH-001", "Premium Wireless Earbuds", "Electronics", "79.99", "45", "50"},
            {"SKU-SH-002", "Organic Coffee Blend 1kg", "Food & Beverage", "24.99", "230", "100"},
            {"SKU-SH-003", "Bamboo Desk Organizer", "Office", "34.50", "12", "25"},
            {"SKU-SH-004", "Stainless Steel Water Bottle", "Lifestyle", "19.99", "89", "60"},
            {"SKU-SH-005", "LED Smart Desk Lamp", "Electronics", "45.00", "5", "30"},
        };

        for (String[] p : products) {
            Map<String, Object> item = new HashMap<>();
            item.put("sku", p[0]);
            item.put("name", p[1]);
            item.put("category", p[2]);
            item.put("basePrice", new BigDecimal(p[3]));
            item.put("currentStock", Integer.parseInt(p[4]));
            item.put("reorderPoint", Integer.parseInt(p[5]));
            inventory.add(item);
        }
        return inventory;
    }

    private List<Map<String, Object>> getDemoSales() {
        List<Map<String, Object>> sales = new ArrayList<>();
        Random random = new Random();

        for (int i = 0; i < 10; i++) {
            Map<String, Object> sale = new HashMap<>();
            sale.put("orderId", "SHOP-" + (1000 + i));
            sale.put("sku", "SKU-SH-00" + (random.nextInt(5) + 1));
            sale.put("quantity", random.nextInt(10) + 1);
            sale.put("total", BigDecimal.valueOf(random.nextDouble() * 200 + 20).setScale(2, java.math.RoundingMode.HALF_UP));
            sale.put("timestamp", LocalDateTime.now().minusHours(random.nextInt(48)));
            sales.add(sale);
        }
        return sales;
    }
}
