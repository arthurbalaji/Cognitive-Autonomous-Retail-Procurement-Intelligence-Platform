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
public class CustomRestAdapter implements ErpAdapter {

    private static final Logger log = LoggerFactory.getLogger(CustomRestAdapter.class);
    private final RestTemplate restTemplate = new RestTemplate();
    private Map<String, String> credentials;
    private boolean isDemoMode = false;

    @Override
    public boolean connect(Map<String, String> credentials) {
        this.credentials = credentials;
        String baseUrl = credentials.get("baseUrl");
        String apiKey = credentials.get("apiKey");

        if (baseUrl == null || apiKey == null) {
            log.error("Custom REST adapter connection failed: missing base URL or API key");
            return false;
        }

        // Detect demo mode
        if (baseUrl.contains("demo") || baseUrl.contains("localhost") || apiKey.startsWith("demo-")) {
            log.info("Custom REST adapter running in DEMO mode for: {}", baseUrl);
            isDemoMode = true;
            return true;
        }

        // Real health check call
        try {
            String url = normalizeUrl(baseUrl) + "/health";
            HttpHeaders headers = buildAuthHeaders(apiKey);

            ResponseEntity<Map> response = restTemplate.exchange(
                    url, HttpMethod.GET, new HttpEntity<>(headers), Map.class
            );

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Custom REST adapter connected to: {}", baseUrl);
                isDemoMode = false;
                return true;
            } else {
                log.error("Custom REST health check returned: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception e) {
            log.warn("Custom REST API health check failed ({}). Falling back to demo mode.", e.getMessage());
            isDemoMode = true;
            return true;
        }
    }

    @Override
    public List<Map<String, Object>> syncInventory() {
        log.info("Syncing inventory from Custom REST API (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String baseUrl = normalizeUrl(credentials.get("baseUrl"));
                String apiKey = credentials.get("apiKey");
                String inventoryEndpoint = credentials.getOrDefault("inventoryEndpoint", "/inventory");

                HttpHeaders headers = buildAuthHeaders(apiKey);
                String url = baseUrl + inventoryEndpoint;

                ResponseEntity<List> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), List.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> inventory = new ArrayList<>();

                    for (Object item : response.getBody()) {
                        if (item instanceof Map) {
                            Map<String, Object> rawItem = (Map<String, Object>) item;
                            Map<String, Object> mapped = new HashMap<>();
                            mapped.put("sku", rawItem.getOrDefault("sku", rawItem.getOrDefault("SKU", rawItem.getOrDefault("product_id", "UNKNOWN"))));
                            mapped.put("name", rawItem.getOrDefault("name", rawItem.getOrDefault("product_name", rawItem.getOrDefault("title", "Unnamed"))));
                            mapped.put("category", rawItem.getOrDefault("category", rawItem.getOrDefault("product_type", "General")));
                            mapped.put("basePrice", parseBigDecimal(rawItem.getOrDefault("price", rawItem.getOrDefault("unit_price", "0"))));
                            mapped.put("currentStock", parseInteger(rawItem.getOrDefault("quantity", rawItem.getOrDefault("stock", rawItem.getOrDefault("in_stock", 0)))));
                            mapped.put("reorderPoint", parseInteger(rawItem.getOrDefault("reorder_point", rawItem.getOrDefault("min_stock", 25))));
                            inventory.add(mapped);
                        }
                    }

                    log.info("Fetched {} inventory items from Custom REST API", inventory.size());
                    return inventory;
                }
            } catch (Exception e) {
                log.warn("Custom REST inventory sync failed: {}. Using demo data.", e.getMessage());
            }
        }

        return getDemoInventory();
    }

    @Override
    public List<Map<String, Object>> fetchSales() {
        log.info("Fetching sales from Custom REST API (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String baseUrl = normalizeUrl(credentials.get("baseUrl"));
                String apiKey = credentials.get("apiKey");
                String salesEndpoint = credentials.getOrDefault("salesEndpoint", "/sales");

                HttpHeaders headers = buildAuthHeaders(apiKey);
                String url = baseUrl + salesEndpoint;

                ResponseEntity<List> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), List.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> sales = new ArrayList<>();

                    for (Object item : response.getBody()) {
                        if (item instanceof Map) {
                            Map<String, Object> rawItem = (Map<String, Object>) item;
                            Map<String, Object> mapped = new HashMap<>();
                            mapped.put("orderId", String.valueOf(rawItem.getOrDefault("orderId", rawItem.getOrDefault("order_id", rawItem.getOrDefault("id", "UNKNOWN")))));
                            mapped.put("sku", rawItem.getOrDefault("sku", rawItem.getOrDefault("product_id", "UNKNOWN")));
                            mapped.put("quantity", parseInteger(rawItem.getOrDefault("quantity", rawItem.getOrDefault("qty", 1))));
                            mapped.put("total", parseBigDecimal(rawItem.getOrDefault("total", rawItem.getOrDefault("amount", "0"))));
                            mapped.put("timestamp", rawItem.getOrDefault("timestamp", rawItem.getOrDefault("date", LocalDateTime.now().toString())));
                            sales.add(mapped);
                        }
                    }

                    log.info("Fetched {} sales records from Custom REST API", sales.size());
                    return sales;
                }
            } catch (Exception e) {
                log.warn("Custom REST sales fetch failed: {}. Using demo data.", e.getMessage());
            }
        }

        return getDemoSales();
    }

    @Override
    public String getProviderName() {
        return "custom";
    }

    // ─── Helper Methods ───────────────────────────────────────

    private String normalizeUrl(String url) {
        if (url == null) return "";
        url = url.trim();
        if (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    private HttpHeaders buildAuthHeaders(String apiKey) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + apiKey);
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        return headers;
    }

    private int parseInteger(Object value) {
        if (value == null) return 0;
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private BigDecimal parseBigDecimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        try {
            return new BigDecimal(String.valueOf(value));
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    private List<Map<String, Object>> getDemoInventory() {
        List<Map<String, Object>> inventory = new ArrayList<>();
        String[][] products = {
            {"SKU-CR-001", "Industrial Tool Set", "Tools", "149.99", "67", "40"},
            {"SKU-CR-002", "Safety Goggles Pack", "Safety", "12.99", "340", "100"},
            {"SKU-CR-003", "Heavy Duty Gloves", "Safety", "8.50", "28", "50"},
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

        for (int i = 0; i < 5; i++) {
            Map<String, Object> sale = new HashMap<>();
            sale.put("orderId", "CUST-" + (2000 + i));
            sale.put("sku", "SKU-CR-00" + (random.nextInt(3) + 1));
            sale.put("quantity", random.nextInt(15) + 1);
            sale.put("total", BigDecimal.valueOf(random.nextDouble() * 500 + 50).setScale(2, java.math.RoundingMode.HALF_UP));
            sale.put("timestamp", LocalDateTime.now().minusHours(random.nextInt(72)));
            sales.add(sale);
        }
        return sales;
    }
}
