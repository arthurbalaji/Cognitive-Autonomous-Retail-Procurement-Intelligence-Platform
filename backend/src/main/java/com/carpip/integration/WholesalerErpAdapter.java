package com.carpip.integration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Wholesaler ERP (Enterprise Resource Planning) adapter.
 * Connects to wholesaler-side warehouse/ERP systems (SAP Business One,
 * Oracle NetSuite, Odoo, Microsoft Dynamics, custom ERP) to fetch
 * warehouse stock levels and confirmed sales orders.
 *
 * Credentials required:
 *   - erpApiUrl:     Base URL of the ERP API (e.g. https://erp.company.com/api)
 *   - erpApiKey:     API key or service account token
 *   - warehouseId:   Warehouse/distribution center identifier
 *   - companyCode:   Company code for multi-company ERPs (optional)
 */
@Component
public class WholesalerErpAdapter implements ErpAdapter {

    private static final Logger log = LoggerFactory.getLogger(WholesalerErpAdapter.class);
    private final RestTemplate restTemplate = new RestTemplate();
    private Map<String, String> credentials;
    private boolean isDemoMode = false;

    @Override
    public boolean connect(Map<String, String> credentials) {
        this.credentials = credentials;
        String erpApiUrl = credentials.get("erpApiUrl");
        String erpApiKey = credentials.get("erpApiKey");
        String warehouseId = credentials.get("warehouseId");

        if (erpApiUrl == null || erpApiKey == null) {
            log.error("Wholesaler ERP connection failed: missing erpApiUrl or erpApiKey");
            return false;
        }

        // Detect demo mode
        if (erpApiUrl.contains("demo") || erpApiUrl.contains("localhost") || erpApiKey.startsWith("demo-")) {
            log.info("Wholesaler ERP adapter running in DEMO mode (warehouse: {}, url: {})", warehouseId, erpApiUrl);
            isDemoMode = true;
            return true;
        }

        // Real ERP API health check
        try {
            String url = normalizeUrl(erpApiUrl) + "/health";
            HttpHeaders headers = buildHeaders(erpApiKey);

            ResponseEntity<Map> response = restTemplate.exchange(
                    url, HttpMethod.GET, new HttpEntity<>(headers), Map.class
            );

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Wholesaler ERP adapter connected to: {} (warehouse: {})", erpApiUrl, warehouseId);
                isDemoMode = false;
                return true;
            } else {
                log.error("ERP health check returned: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception e) {
            log.warn("ERP API health check failed ({}). Falling back to demo mode.", e.getMessage());
            isDemoMode = true;
            return true;
        }
    }

    @Override
    public List<Map<String, Object>> syncInventory() {
        log.info("Syncing warehouse inventory from Wholesaler ERP (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String baseUrl = normalizeUrl(credentials.get("erpApiUrl"));
                String apiKey = credentials.get("erpApiKey");
                String warehouseId = credentials.getOrDefault("warehouseId", "WH-MAIN");
                String inventoryEndpoint = credentials.getOrDefault("inventoryEndpoint", "/api/v1/warehouse/stock");

                HttpHeaders headers = buildHeaders(apiKey);
                String url = baseUrl + inventoryEndpoint + "?warehouse_id=" + warehouseId;

                ResponseEntity<List> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), List.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> inventory = new ArrayList<>();

                    for (Object item : response.getBody()) {
                        if (item instanceof Map) {
                            Map<String, Object> raw = (Map<String, Object>) item;
                            Map<String, Object> mapped = new HashMap<>();
                            // Map ERP field names to CARPIP schema
                            mapped.put("sku", raw.getOrDefault("material_code",
                                    raw.getOrDefault("item_number",
                                            raw.getOrDefault("sku",
                                                    raw.getOrDefault("part_number", "UNKNOWN")))));
                            mapped.put("name", raw.getOrDefault("material_description",
                                    raw.getOrDefault("item_name",
                                            raw.getOrDefault("name",
                                                    raw.getOrDefault("description", "Unnamed")))));
                            mapped.put("category", raw.getOrDefault("material_group",
                                    raw.getOrDefault("item_group",
                                            raw.getOrDefault("category", "General"))));
                            mapped.put("basePrice", parseBigDecimal(raw.getOrDefault("unit_cost",
                                    raw.getOrDefault("standard_price",
                                            raw.getOrDefault("wholesale_price", "0")))));
                            mapped.put("currentStock", parseInteger(raw.getOrDefault("available_qty",
                                    raw.getOrDefault("on_hand_qty",
                                            raw.getOrDefault("warehouse_stock", 0)))));
                            mapped.put("reorderPoint", parseInteger(raw.getOrDefault("safety_stock",
                                    raw.getOrDefault("reorder_level",
                                            raw.getOrDefault("min_stock", 50)))));
                            inventory.add(mapped);
                        }
                    }

                    log.info("Fetched {} warehouse items from Wholesaler ERP", inventory.size());
                    return inventory;
                }
            } catch (Exception e) {
                log.warn("ERP inventory sync failed: {}. Using demo data.", e.getMessage());
            }
        }

        return getDemoInventory();
    }

    @Override
    public List<Map<String, Object>> fetchSales() {
        log.info("Fetching sales orders from Wholesaler ERP (demo={})...", isDemoMode);

        if (!isDemoMode && credentials != null) {
            try {
                String baseUrl = normalizeUrl(credentials.get("erpApiUrl"));
                String apiKey = credentials.get("erpApiKey");
                String salesEndpoint = credentials.getOrDefault("salesEndpoint", "/api/v1/sales-orders");

                HttpHeaders headers = buildHeaders(apiKey);
                String url = baseUrl + salesEndpoint + "?status=confirmed&limit=50";

                ResponseEntity<List> response = restTemplate.exchange(
                        url, HttpMethod.GET, new HttpEntity<>(headers), List.class
                );

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    List<Map<String, Object>> sales = new ArrayList<>();

                    for (Object item : response.getBody()) {
                        if (item instanceof Map) {
                            Map<String, Object> raw = (Map<String, Object>) item;
                            Map<String, Object> mapped = new HashMap<>();
                            mapped.put("orderId", String.valueOf(raw.getOrDefault("sales_order_number",
                                    raw.getOrDefault("document_number",
                                            raw.getOrDefault("order_id", "SO-" + System.currentTimeMillis())))));
                            mapped.put("sku", raw.getOrDefault("material_code",
                                    raw.getOrDefault("item_number",
                                            raw.getOrDefault("sku", "UNKNOWN"))));
                            mapped.put("quantity", parseInteger(raw.getOrDefault("order_qty",
                                    raw.getOrDefault("quantity",
                                            raw.getOrDefault("units", 1)))));
                            mapped.put("total", parseBigDecimal(raw.getOrDefault("net_amount",
                                    raw.getOrDefault("total_amount",
                                            raw.getOrDefault("total", "0")))));
                            mapped.put("timestamp", raw.getOrDefault("order_date",
                                    raw.getOrDefault("posting_date",
                                            raw.getOrDefault("created_at", LocalDateTime.now().toString()))));
                            sales.add(mapped);
                        }
                    }

                    log.info("Fetched {} sales orders from Wholesaler ERP", sales.size());
                    return sales;
                }
            } catch (Exception e) {
                log.warn("ERP sales fetch failed: {}. Using demo data.", e.getMessage());
            }
        }

        return getDemoSales();
    }

    @Override
    public String getProviderName() {
        return "wholesaler-erp";
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

    // ─── Demo Data: Realistic Wholesale ERP Warehouse ─────────

    private List<Map<String, Object>> getDemoInventory() {
        List<Map<String, Object>> inventory = new ArrayList<>();
        String[][] products = {
            {"MAT-10001", "Industrial Bearing Assembly 6205", "Mechanical Parts", "24.50", "2400", "500"},
            {"MAT-10002", "Stainless Steel Pipe 2\" x 6m", "Raw Materials", "89.00", "180", "100"},
            {"MAT-10003", "LED Panel Light 60x60 40W", "Electrical", "32.75", "850", "200"},
            {"MAT-10004", "Hydraulic Pump HP-200", "Heavy Equipment", "1250.00", "18", "10"},
            {"MAT-10005", "Safety Helmet Class E (Case/12)", "PPE", "156.00", "320", "100"},
            {"MAT-10006", "Copper Wire 2.5mm² (100m Roll)", "Electrical", "78.50", "95", "50"},
            {"MAT-10007", "Welding Rod E6013 (25kg Box)", "Consumables", "45.99", "410", "150"},
            {"MAT-10008", "Pneumatic Cylinder SC-50x100", "Pneumatics", "67.80", "42", "30"},
            {"MAT-10009", "Industrial Adhesive EP-400 (5L)", "Chemicals", "128.00", "65", "25"},
            {"MAT-10010", "Conveyor Belt Module CBM-800", "Automation", "890.00", "8", "5"},
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
        String[] skus = {"MAT-10001", "MAT-10002", "MAT-10003", "MAT-10005", "MAT-10006", "MAT-10007"};
        double[] prices = {24.50, 89.00, 32.75, 156.00, 78.50, 45.99};

        // Generate realistic wholesale sales order data
        for (int i = 0; i < 8; i++) {
            int skuIdx = random.nextInt(skus.length);
            int qty = (random.nextInt(20) + 1) * 10; // Wholesale quantities: 10, 20, 30...
            Map<String, Object> sale = new HashMap<>();
            sale.put("orderId", "SO-" + String.format("%04d", 2026000 + i));
            sale.put("sku", skus[skuIdx]);
            sale.put("quantity", qty);
            sale.put("total", BigDecimal.valueOf(prices[skuIdx] * qty).setScale(2, RoundingMode.HALF_UP));
            sale.put("timestamp", LocalDateTime.now().minusHours(random.nextInt(168)).toString());
            sales.add(sale);
        }
        return sales;
    }
}
