package com.carpip.controller;

import com.carpip.entity.Product;
import com.carpip.entity.User;
import com.carpip.repository.ProductRepository;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductRepository productRepository;

    public ProductController(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @GetMapping
    @Cacheable(value = "products", key = "#user.tenant.id")
    public ResponseEntity<List<Product>> getProducts(@AuthenticationPrincipal User user) {
        List<Product> products = productRepository.findByTenantId(user.getTenant().getId());
        return ResponseEntity.ok(products);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Product> getProduct(@PathVariable String id, @AuthenticationPrincipal User user) {
        Product product = productRepository.findById(id)
                .filter(p -> p.getTenant().getId().equals(user.getTenant().getId()))
                .orElseThrow(() -> new RuntimeException("Product not found"));
        return ResponseEntity.ok(product);
    }

    @PostMapping
    @CacheEvict(value = "products", key = "#user.tenant.id")
    public ResponseEntity<Product> createProduct(@RequestBody Product product, @AuthenticationPrincipal User user) {
        product.setTenant(user.getTenant());
        Product saved = productRepository.save(product);
        return ResponseEntity.ok(saved);
    }

    @PutMapping("/{id}")
    @CacheEvict(value = "products", key = "#user.tenant.id")
    public ResponseEntity<Product> updateProduct(@PathVariable String id, @RequestBody Product updates,
                                                  @AuthenticationPrincipal User user) {
        Product product = productRepository.findById(id)
                .filter(p -> p.getTenant().getId().equals(user.getTenant().getId()))
                .orElseThrow(() -> new RuntimeException("Product not found"));

        if (updates.getName() != null) product.setName(updates.getName());
        if (updates.getSku() != null) product.setSku(updates.getSku());
        if (updates.getCategory() != null) product.setCategory(updates.getCategory());
        if (updates.getBasePrice() != null) product.setBasePrice(updates.getBasePrice());
        if (updates.getCurrentStock() != null) product.setCurrentStock(updates.getCurrentStock());
        if (updates.getReorderPoint() != null) product.setReorderPoint(updates.getReorderPoint());

        Product saved = productRepository.save(product);
        return ResponseEntity.ok(saved);
    }

    @DeleteMapping("/{id}")
    @CacheEvict(value = "products", key = "#user.tenant.id")
    public ResponseEntity<Void> deleteProduct(@PathVariable String id, @AuthenticationPrincipal User user) {
        Product product = productRepository.findById(id)
                .filter(p -> p.getTenant().getId().equals(user.getTenant().getId()))
                .orElseThrow(() -> new RuntimeException("Product not found"));
        productRepository.delete(product);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/low-stock")
    public ResponseEntity<List<Product>> getLowStockProducts(@AuthenticationPrincipal User user,
                                                              @RequestParam(defaultValue = "50") Integer threshold) {
        List<Product> products = productRepository.findByTenantIdAndCurrentStockLessThanEqual(
                user.getTenant().getId(), threshold);
        return ResponseEntity.ok(products);
    }

    /**
     * Simulate low stock on a synced product to trigger auto-procurement + AI negotiation.
     * Drops the first available product's stock below its reorder level.
     */
    @PostMapping("/simulate-low-stock")
    @CacheEvict(value = "products", key = "#user.tenant.id")
    public ResponseEntity<Map<String, Object>> simulateLowStock(@AuthenticationPrincipal User user) {
        List<Product> products = productRepository.findByTenantId(user.getTenant().getId());

        if (products.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", true,
                    "message", "No synced products found. Connect your POS and sync first."
            ));
        }

        // Pick a product that is NOT already below reorder, preferring one with reorderPoint set
        Product target = products.stream()
                .filter(p -> p.getReorderPoint() != null && p.getCurrentStock() != null
                        && p.getCurrentStock() > p.getReorderPoint())
                .findFirst()
                .orElse(products.get(0)); // fallback to first product

        // Save original stock so we can report the change
        int originalStock = target.getCurrentStock() != null ? target.getCurrentStock() : 50;
        int reorderPoint = target.getReorderPoint() != null ? target.getReorderPoint() : 25;

        // Drop stock to 3 units below reorder level (critically low)
        int newStock = Math.max(1, reorderPoint - 3);
        target.setCurrentStock(newStock);
        productRepository.save(target);

        Map<String, Object> result = new java.util.HashMap<>();
        result.put("product", Map.of(
                "id", target.getId(),
                "sku", target.getSku(),
                "name", target.getName(),
                "category", target.getCategory() != null ? target.getCategory() : "General",
                "originalStock", originalStock,
                "newStock", newStock,
                "reorderPoint", reorderPoint,
                "basePrice", target.getBasePrice() != null ? target.getBasePrice() : java.math.BigDecimal.ZERO
        ));
        result.put("message", String.format(
                "Stock for '%s' (%s) dropped from %d → %d units (below reorder level of %d). Auto-procurement triggered.",
                target.getName(), target.getSku(), originalStock, newStock, reorderPoint
        ));

        return ResponseEntity.ok(result);
    }
}
