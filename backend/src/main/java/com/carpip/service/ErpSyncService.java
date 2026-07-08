package com.carpip.service;

import com.carpip.entity.Product;
import com.carpip.entity.Tenant;
import com.carpip.integration.ErpAdapter;
import com.carpip.repository.ProductRepository;
import com.carpip.repository.TenantRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class ErpSyncService {

    private static final Logger log = LoggerFactory.getLogger(ErpSyncService.class);

    private final TenantRepository tenantRepository;
    private final ProductRepository productRepository;
    private final List<ErpAdapter> adapters;
    private final KafkaTemplate<String, Object> kafkaTemplate;

    private boolean kafkaAvailable = true;

    public ErpSyncService(TenantRepository tenantRepository,
                          ProductRepository productRepository,
                          List<ErpAdapter> adapters,
                          KafkaTemplate<String, Object> kafkaTemplate) {
        this.tenantRepository = tenantRepository;
        this.productRepository = productRepository;
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
            throw new RuntimeException("Failed to connect to " + tenant.getErpProvider() + " for tenant " + tenant.getName());
        }

        // ──── Sync Inventory ────
        List<Map<String, Object>> inventoryData = adapter.syncInventory();
        int productsUpserted = 0;

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
        int salesPublished = 0;

        for (Map<String, Object> sale : salesData) {
            sale.put("tenantId", tenant.getId());
            sale.put("tenantName", tenant.getName());
            publishToKafka("sales.events", tenant.getId(), sale, tenant);
            salesPublished++;
        }

        log.info("Published {} sales events for tenant: {}", salesPublished, tenant.getName());

        return Map.of(
                "productsUpserted", productsUpserted,
                "salesPublished", salesPublished,
                "provider", tenant.getErpProvider(),
                "tenantName", tenant.getName()
        );
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
