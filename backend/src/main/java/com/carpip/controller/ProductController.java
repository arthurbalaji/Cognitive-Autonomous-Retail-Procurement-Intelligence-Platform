package com.carpip.controller;

import com.carpip.entity.Product;
import com.carpip.entity.User;
import com.carpip.repository.ProductRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductRepository productRepository;

    public ProductController(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @GetMapping
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
    public ResponseEntity<Product> createProduct(@RequestBody Product product, @AuthenticationPrincipal User user) {
        product.setTenant(user.getTenant());
        Product saved = productRepository.save(product);
        return ResponseEntity.ok(saved);
    }

    @PutMapping("/{id}")
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
}
