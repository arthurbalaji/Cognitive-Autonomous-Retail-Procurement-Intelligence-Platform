package com.erp.application.controller;

import com.erp.application.entity.WarehouseProduct;
import com.erp.application.service.WarehouseProductService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
public class WarehouseProductController {

    private final WarehouseProductService productService;

    @GetMapping
    public ResponseEntity<List<WarehouseProduct>> getAllProducts() {
        return ResponseEntity.ok(productService.getAllProducts());
    }

    @GetMapping("/active")
    public ResponseEntity<List<WarehouseProduct>> getActiveProducts() {
        return ResponseEntity.ok(productService.getActiveProducts());
    }

    @GetMapping("/{id}")
    public ResponseEntity<WarehouseProduct> getProductById(@PathVariable Long id) {
        return ResponseEntity.ok(productService.getProductById(id));
    }

    @GetMapping("/search/name/{name}")
    public ResponseEntity<List<WarehouseProduct>> searchByName(@PathVariable String name) {
        return ResponseEntity.ok(productService.searchByName(name));
    }

    @GetMapping("/search/sku/{sku}")
    public ResponseEntity<List<WarehouseProduct>> searchBySku(@PathVariable String sku) {
        return ResponseEntity.ok(productService.searchBySku(sku));
    }

    @GetMapping("/low-stock")
    public ResponseEntity<List<WarehouseProduct>> getLowStockProducts() {
        return ResponseEntity.ok(productService.getLowStockProducts());
    }

    @PostMapping
    public ResponseEntity<WarehouseProduct> createProduct(@Valid @RequestBody WarehouseProduct product) {
        return ResponseEntity.status(HttpStatus.CREATED).body(productService.createProduct(product));
    }

    @PutMapping("/{id}")
    public ResponseEntity<WarehouseProduct> updateProduct(@PathVariable Long id,
                                                           @Valid @RequestBody WarehouseProduct product) {
        return ResponseEntity.ok(productService.updateProduct(id, product));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProduct(@PathVariable Long id) {
        productService.deleteProduct(id);
        return ResponseEntity.noContent().build();
    }
}
