package com.carpip.service;

import com.carpip.entity.Order;
import com.carpip.entity.Product;
import com.carpip.entity.Tenant;
import com.carpip.integration.ErpAdapter;
import com.carpip.repository.OrderRepository;
import com.carpip.repository.ProductRepository;
import com.carpip.repository.TenantRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class ErpSyncService {

    private static final Logger log = LoggerFactory.getLogger(ErpSyncService.class);

    private final TenantRepository tenantRepository;
    private final ProductRepository productRepository;
    private final OrderRepository orderRepository;
    private final List<ErpAdapter> adapters;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${ai.service.url:http://localhost:5000}")
    private String aiServiceUrl;

    private boolean kafkaAvailable = true;

    public ErpSyncService(TenantRepository tenantRepository,
                          ProductRepository productRepository,
                          OrderRepository orderRepository,
                          List<ErpAdapter> adapters,
                          KafkaTemplate<String, Object> kafkaTemplate) {
        this.tenantRepository = tenantRepository;
        this.productRepository = productRepository;
        this.orderRepository = orderRepository;
        this.adapters = adapters;
        this.kafkaTemplate = kafkaTemplate;
    }

    /**
     * Scheduled task to poll ERP adapters and sync data.
     * Runs every 5 minutes by default, configurable via erp.sync.cron.
     */
    @Scheduled(cron = "${erp.sync.cron}")
    public void syncAllTenants() {
        log.info("Starting scheduled ERP sync for all tenants...");

        List<Tenant> tenants = tenantRepository.findAll();
        int synced = 0;

        for (Tenant tenant : tenants) {
            if (tenant.getErpProvider() == null || tenant.getErpProvider().isEmpty()) continue;

            try {
                syncTenant(tenant);
                synced++;
            } catch (Exception e) {
                log.error("ERP sync failed for tenant {}: {}", tenant.getName(), e.getMessage());
            }
        }

        log.info("Scheduled ERP sync completed. Synced {} tenants.", synced);
    }

    /**
     * Sync a specific tenant's data from their ERP adapter.
     * Called both by scheduled task and manual sync trigger.
     * Now also tracks sync metadata and triggers auto-procurement.
     */
    @Transactional
    public Map<String, Object> syncTenant(Tenant tenant) {
        log.info("Syncing tenant: {} (provider: {})", tenant.getName(), tenant.getErpProvider());

        ErpAdapter adapter = adapters.stream()
                .filter(a -> a.getProviderName().equals(tenant.getErpProvider()))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("No adapter found for provider: " + tenant.getErpProvider()));

        // Connect using stored credentials
        boolean connected = adapter.connect(
                tenant.getApiKeys() != null ? tenant.getApiKeys() : new HashMap<>()
        );

        if (!connected) {
            tenant.setLastSyncError("Failed to connect to " + tenant.getErpProvider());
            tenantRepository.save(tenant);
            throw new RuntimeException("Failed to connect to " + tenant.getErpProvider() + " for tenant " + tenant.getName());
        }

        int productsUpserted = 0;
        int salesPublished = 0;
        String syncError = null;

        try {
            // ──── Sync Inventory ────
            List<Map<String, Object>> inventoryData = adapter.syncInventory();

            for (Map<String, Object> item : inventoryData) {
                String sku = String.valueOf(item.getOrDefault("sku", "UNKNOWN"));

                // Upsert: find existing product by tenant+SKU or create new
                Optional<Product> existing = productRepository.findByTenantIdAndSku(tenant.getId(), sku);
                Product product;

                if (existing.isPresent()) {
                    product = existing.get();
                } else {
                    product = new Product();
                    product.setTenant(tenant);
                    product.setSku(sku);
                }

                product.setName(String.valueOf(item.getOrDefault("name", "Unnamed Product")));
                product.setCategory(String.valueOf(item.getOrDefault("category", "General")));

                Object priceObj = item.get("basePrice");
                if (priceObj instanceof BigDecimal) {
                    product.setBasePrice((BigDecimal) priceObj);
                } else if (priceObj != null) {
                    product.setBasePrice(new BigDecimal(String.valueOf(priceObj)));
                }

                Object stockObj = item.get("currentStock");
                if (stockObj instanceof Integer) {
                    product.setCurrentStock((Integer) stockObj);
                } else if (stockObj != null) {
                    product.setCurrentStock(Integer.parseInt(String.valueOf(stockObj)));
                }

                Object reorderObj = item.get("reorderPoint");
                if (reorderObj instanceof Integer) {
                    product.setReorderPoint((Integer) reorderObj);
                } else if (reorderObj != null) {
                    product.setReorderPoint(Integer.parseInt(String.valueOf(reorderObj)));
                }

                productRepository.save(product);
                productsUpserted++;

                // Publish to Kafka if available
                publishToKafka("inventory.updates", tenant.getId(), item, tenant);
            }

            log.info("Upserted {} products for tenant: {}", productsUpserted, tenant.getName());

            // ──── Fetch & Publish Sales ────
            List<Map<String, Object>> salesData = adapter.fetchSales();

            for (Map<String, Object> sale : salesData) {
                sale.put("tenantId", tenant.getId());
                sale.put("tenantName", tenant.getName());
                publishToKafka("sales.events", tenant.getId(), sale, tenant);
                salesPublished++;
            }

            log.info("Published {} sales events for tenant: {}", salesPublished, tenant.getName());

            // ──── Auto-Procurement: create orders for low-stock products ────
            int autoProcCount = checkAndCreateAutoProcurementOrders(tenant);
            if (autoProcCount > 0) {
                log.info("Created {} auto-procurement orders for tenant: {}", autoProcCount, tenant.getName());
            }

            // ──── Push real product data to AI service for MPI calculation ────
            pushProductsToAiForMpi(tenant);

        } catch (Exception e) {
            syncError = e.getMessage();
            log.error("Sync error for tenant {}: {}", tenant.getName(), syncError);
        }

        // ──── Update tenant sync metadata ────
        tenant.setLastSyncAt(LocalDateTime.now());
        tenant.setLastSyncProductCount(productsUpserted);
        tenant.setLastSyncSalesCount(salesPublished);
        tenant.setLastSyncError(syncError);
        tenantRepository.save(tenant);

        Map<String, Object> result = new HashMap<>();
        result.put("productsUpserted", productsUpserted);
        result.put("salesPublished", salesPublished);
        result.put("provider", tenant.getErpProvider());
        result.put("tenantName", tenant.getName());
        result.put("syncedAt", LocalDateTime.now().toString());
        if (syncError != null) {
            result.put("error", syncError);
        }
        return result;
    }

    /**
     * Check all tenant products for low stock and auto-create PENDING orders.
     * Orders are marked as autoGenerated = true so users can review/approve them.
     */
    private int checkAndCreateAutoProcurementOrders(Tenant tenant) {
        List<Product> lowStockProducts = productRepository.findByTenantIdAndCurrentStockLessThanEqual(
                tenant.getId(), 0 // We'll check reorderPoint per product
        );

        // Get all products and filter for low stock vs their individual reorder points
        List<Product> allProducts = productRepository.findByTenantId(tenant.getId());
        int ordersCreated = 0;

        for (Product product : allProducts) {
            if (product.getCurrentStock() != null && product.getReorderPoint() != null
                    && product.getCurrentStock() <= product.getReorderPoint()) {

                // Check if an active auto-order already exists for this SKU
                List<Order> existingOrders = orderRepository.findByRetailerIdAndAutoGenerated(tenant.getId(), true);
                boolean alreadyOrdered = existingOrders.stream()
                        .anyMatch(o -> product.getSku().equals(o.getSourceSku())
                                && (o.getStatus() == Order.OrderStatus.PENDING || o.getStatus() == Order.OrderStatus.NEGOTIATING));

                if (!alreadyOrdered) {
                    Order autoOrder = new Order();
                    autoOrder.setRetailer(tenant);
                    autoOrder.setStatus(Order.OrderStatus.PENDING);
                    autoOrder.setAutoGenerated(true);
                    autoOrder.setSourceSku(product.getSku());

                    // Calculate order quantity: 2x reorder point to create buffer
                    int orderQty = product.getReorderPoint() * 2;
                    BigDecimal unitPrice = product.getBasePrice() != null ? product.getBasePrice() : BigDecimal.valueOf(25.00);
                    autoOrder.setTotalAmount(unitPrice.multiply(BigDecimal.valueOf(orderQty)));

                    // Store item details as JSON
                    String itemsJson = String.format(
                            "[{\"sku\":\"%s\",\"name\":\"%s\",\"quantity\":%d,\"unitPrice\":%.2f}]",
                            product.getSku(), product.getName(), orderQty, unitPrice.doubleValue()
                    );
                    autoOrder.setItemsJson(itemsJson);

                    orderRepository.save(autoOrder);
                    ordersCreated++;

                    log.info("Auto-procurement order created for {} (stock: {}, reorder: {})",
                            product.getSku(), product.getCurrentStock(), product.getReorderPoint());
                }
            }
        }

        return ordersCreated;
    }

    /**
     * Push real tenant product data to the AI service for live MPI calculation.
     * This ensures MPI reflects actual inventory state rather than mock data.
     */
    private void pushProductsToAiForMpi(Tenant tenant) {
        try {
            List<Product> products = productRepository.findByTenantId(tenant.getId());
            if (products.isEmpty()) return;

            List<Map<String, Object>> productData = new ArrayList<>();
            for (Product p : products) {
                Map<String, Object> item = new HashMap<>();
                item.put("sku", p.getSku());
                item.put("current_stock", p.getCurrentStock() != null ? p.getCurrentStock() : 0);
                item.put("reorder_point", p.getReorderPoint() != null ? p.getReorderPoint() : 25);
                item.put("base_price", p.getBasePrice() != null ? p.getBasePrice().doubleValue() : 0);
                item.put("predicted_demand", p.getDemandForecast() != null ? p.getDemandForecast() : 30);
                productData.add(item);
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, Object> requestBody = Map.of("products", productData);
            ResponseEntity<Map> response = restTemplate.exchange(
                    aiServiceUrl + "/api/ai/mpi/calculate",
                    HttpMethod.POST,
                    new HttpEntity<>(requestBody, headers),
                    Map.class
            );

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Pushed {} products to AI service for MPI calculation (tenant: {})",
                        products.size(), tenant.getName());
            }
        } catch (Exception e) {
            log.warn("Failed to push products to AI for MPI (non-fatal): {}", e.getMessage());
        }
    }

    /**
     * Publish to Kafka with graceful fallback if Kafka is unavailable.
     */
    private void publishToKafka(String topic, String key, Map<String, Object> data, Tenant tenant) {
        if (!kafkaAvailable) return;

        try {
            kafkaTemplate.send(topic, key, data);
        } catch (Exception e) {
            if (kafkaAvailable) {
                log.warn("Kafka unavailable ({}). Skipping event publishing. System continues without Kafka.", e.getMessage());
                kafkaAvailable = false;
            }
        }
    }
}
