package com.carpip.integration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Retailer POS (Point-of-Sale) / eCommerce adapter.
 * Connects to retailer-side systems (Square, Lightspeed, Toast, custom POS)
 * to fetch real-time inventory and transaction data.
 *
 * Credentials required:
 *   - posApiUrl:  Base URL of the POS API (e.g. https://api.square.com/v2)
 *   - posApiKey:  API key or access token
 *   - storeId:    Store/location identifier
 */
@Component
public class RetailerPosAdapter implements ErpAdapter {

    private static final Logger log = LoggerFactory.getLogger(RetailerPosAdapter.class);
    private final RestTemplate restTemplate = new RestTemplate();
    private Map<String, String> credentials;
    private boolean isDemoMode = false;

    @Override
    public boolean connect(Map<String, String> credentials) {
        this.credentials = credentials;
        String posApiUrl = credentials.get("posApiUrl");
        String posApiKey = credentials.get("posApiKey");
        String storeId = credentials.get("storeId");

        if (posApiUrl == null || posApiKey == null) {
            log.error("POS adapter connection failed: missing posApiUrl or posApiKey");
            return false;
        }

        // Detect demo mode
        if (posApiUrl.contains("demo") || posApiUrl.contains("localhost") || posApiKey.startsWith("demo-")) {
            log.info("Retailer POS adapter running in DEMO mode for store: {} (url: {})", storeId, posApiUrl);
            isDemoMode = true;
            return true;
        }

        // Real POS API health check
        try {
            String url = normalizeUrl(posApiUrl) + "/health";
            HttpHeaders headers = buildHeaders(posApiKey);

            ResponseEntity<Map> response = restTemplate.exchange(
                    url, HttpMethod.GET, new HttpEntity<>(headers), Map.class
            );

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Retailer POS adapter connected to: {} (store: {})", posApiUrl, storeId);
                isDemoMode = false;
                return true;
            } else {
                log.error("POS health check returned: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception e) {
            log.warn("POS API health check failed ({}). Falling back to demo mode.", e.getMessage());
            isDemoMode = true;
            return true;
        }
    }

    @Override
    public List<Map<String, Object>> syncInventory() {
        log.info("Syncing inventory from Retailer POS (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String baseUrl = normalizeUrl(credentials.get("posApiUrl"));
                String apiKey = credentials.get("posApiKey");
                String storeId = credentials.getOrDefault("storeId", "default");
                String inventoryEndpoint = credentials.getOrDefault("inventoryEndpoint", "/api/v1/inventory");

                HttpHeaders headers = buildHeaders(apiKey);
                String url = baseUrl + inventoryEndpoint + "?store_id=" + storeId;

                ResponseEntity<List> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), List.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> inventory = new ArrayList<>();

                    for (Object item : response.getBody()) {
                        if (item instanceof Map) {
                            Map<String, Object> raw = (Map<String, Object>) item;
                            Map<String, Object> mapped = new HashMap<>();
                            // Map common POS field names to CARPIP schema
                            mapped.put("sku", raw.getOrDefault("item_code",
                                    raw.getOrDefault("barcode",
                                            raw.getOrDefault("sku",
                                                    raw.getOrDefault("product_id", "UNKNOWN")))));
                            mapped.put("name", raw.getOrDefault("item_name",
                                    raw.getOrDefault("product_name",
                                            raw.getOrDefault("name",
                                                    raw.getOrDefault("title", "Unnamed")))));
                            mapped.put("category", raw.getOrDefault("category",
                                    raw.getOrDefault("department",
                                            raw.getOrDefault("product_type", "General"))));
                            mapped.put("basePrice", parseBigDecimal(raw.getOrDefault("sell_price",
                                    raw.getOrDefault("retail_price",
                                            raw.getOrDefault("price", "0")))));
                            mapped.put("currentStock", parseInteger(raw.getOrDefault("quantity_on_hand",
                                    raw.getOrDefault("stock_count",
                                            raw.getOrDefault("in_stock", 0)))));
                            mapped.put("reorderPoint", parseInteger(raw.getOrDefault("reorder_level",
                                    raw.getOrDefault("min_stock",
                                            raw.getOrDefault("reorder_point", 25)))));
                            inventory.add(mapped);
                        }
                    }

                    log.info("Fetched {} inventory items from Retailer POS", inventory.size());
                    return inventory;
                }
            } catch (Exception e) {
                log.warn("POS inventory sync failed: {}. Using demo data.", e.getMessage());
            }
        }

        return getDemoInventory();
    }

    @Override
    public List<Map<String, Object>> fetchSales() {
        log.info("Fetching sales from Retailer POS (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String baseUrl = normalizeUrl(credentials.get("posApiUrl"));
                String apiKey = credentials.get("posApiKey");
                String storeId = credentials.getOrDefault("storeId", "default");
                String salesEndpoint = credentials.getOrDefault("salesEndpoint", "/api/v1/transactions");

                HttpHeaders headers = buildHeaders(apiKey);
                String url = baseUrl + salesEndpoint + "?store_id=" + storeId + "&since=24h";

                ResponseEntity<List> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), List.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> sales = new ArrayList<>();

                    for (Object item : response.getBody()) {
                        if (item instanceof Map) {
                            Map<String, Object> raw = (Map<String, Object>) item;
                            Map<String, Object> mapped = new HashMap<>();
                            mapped.put("orderId", String.valueOf(raw.getOrDefault("transaction_id",
                                    raw.getOrDefault("receipt_number",
                                            raw.getOrDefault("order_id", "POS-" + System.currentTimeMillis())))));
                            mapped.put("sku", raw.getOrDefault("item_code",
                                    raw.getOrDefault("barcode",
                                            raw.getOrDefault("sku", "UNKNOWN"))));
                            mapped.put("quantity", parseInteger(raw.getOrDefault("qty_sold",
                                    raw.getOrDefault("quantity",
                                            raw.getOrDefault("units", 1)))));
                            mapped.put("total", parseBigDecimal(raw.getOrDefault("line_total",
                                    raw.getOrDefault("total",
                                            raw.getOrDefault("amount", "0")))));
                            mapped.put("timestamp", raw.getOrDefault("transaction_date",
                                    raw.getOrDefault("timestamp",
                                            raw.getOrDefault("created_at", LocalDateTime.now().toString()))));
                            sales.add(mapped);
                        }
                    }

                    log.info("Fetched {} sales records from Retailer POS", sales.size());
                    return sales;
                }
            } catch (Exception e) {
                log.warn("POS sales fetch failed: {}. Using demo data.", e.getMessage());
            }
        }

        return getDemoSales();
    }

    @Override
    public String getProviderName() {
        return "retailer-pos";
    }

    // ─── Helper Methods ───────────────────────────────────────

    private String normalizeUrl(String url) {
        if (url == null) return "";
        url = url.trim();
        if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    private HttpHeaders buildHeaders(String apiKey) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + apiKey);
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        return headers;
    }

    private int parseInteger(Object value) {
        if (value == null) return 0;
        try { return Integer.parseInt(String.valueOf(value)); }
        catch (NumberFormatException e) { return 0; }
    }

    private BigDecimal parseBigDecimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        try { return new BigDecimal(String.valueOf(value)); }
        catch (NumberFormatException e) { return BigDecimal.ZERO; }
    }

    // ─── Demo Data: Realistic POS Inventory ───────────────────

    private List<Map<String, Object>> getDemoInventory() {
        List<Map<String, Object>> inventory = new ArrayList<>();
        String[][] products = {
            {"POS-001", "Artisan Sourdough Loaf", "Bakery", "8.99", "45", "20"},
            {"POS-002", "Cold Brew Coffee 16oz", "Beverages", "5.49", "120", "50"},
            {"POS-003", "Organic Avocado (each)", "Produce", "2.99", "38", "40"},
            {"POS-004", "Free-Range Eggs (dozen)", "Dairy", "6.99", "22", "30"},
            {"POS-005", "Grass-Fed Ground Beef 1lb", "Meat", "12.99", "15", "25"},
            {"POS-006", "Kombucha Variety 4-Pack", "Beverages", "11.99", "67", "30"},
            {"POS-007", "Gluten-Free Pasta 16oz", "Pantry", "4.49", "83", "40"},
            {"POS-008", "Local Honey 12oz Jar", "Pantry", "9.99", "19", "15"},
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
        String[] skus = {"POS-001", "POS-002", "POS-003", "POS-004", "POS-005", "POS-006", "POS-007", "POS-008"};
        double[] prices = {8.99, 5.49, 2.99, 6.99, 12.99, 11.99, 4.49, 9.99};

        // Generate realistic POS transaction data (register receipts)
        for (int i = 0; i < 15; i++) {
            int skuIdx = random.nextInt(skus.length);
            int qty = random.nextInt(5) + 1;
            Map<String, Object> sale = new HashMap<>();
            sale.put("orderId", "TXN-" + String.format("%06d", 100000 + random.nextInt(900000)));
            sale.put("sku", skus[skuIdx]);
            sale.put("quantity", qty);
            sale.put("total", BigDecimal.valueOf(prices[skuIdx] * qty).setScale(2, RoundingMode.HALF_UP));
            sale.put("timestamp", LocalDateTime.now().minusMinutes(random.nextInt(1440)).toString());
            sales.add(sale);
        }
        return sales;
    }
}
