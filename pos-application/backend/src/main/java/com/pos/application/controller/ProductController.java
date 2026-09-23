package com.pos.application.controller;

import com.pos.application.entity.Product;
import com.pos.application.service.ProductService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;

import java.util.List;

@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
public class ProductController {

        private final ProductService productService;

        @GetMapping
        public ResponseEntity<List<Product>> getAllProducts() {
                return ResponseEntity.ok(productService.getAllProducts());
        }

        @GetMapping("/search/name/{name}")
        public ResponseEntity<List<Product>> searchByName(
                        @PathVariable String name) {

                return ResponseEntity.ok(
                                productService.searchByName(name));
        }

        @GetMapping("/search/sku/{sku}")
        public ResponseEntity<List<Product>> searchBySku(
                        @PathVariable String sku) {

                return ResponseEntity.ok(
                                productService.searchBySku(sku));
        }

        @GetMapping("/search/barcode/{barcode}")
        public ResponseEntity<Product> getByBarcode(
                        @PathVariable String barcode) {

                return ResponseEntity.ok(
                                productService.getByBarcode(barcode));
        }

        @GetMapping("/{id}")
        public ResponseEntity<Product> getProductById(
                        @PathVariable Long id) {

                return ResponseEntity.ok(
                                productService.getProductById(id));
        }

        @PostMapping
        public ResponseEntity<Product> createProduct(
                        @Valid @RequestBody Product product) {

                return ResponseEntity
                                .status(HttpStatus.CREATED)
                                .body(productService.createProduct(product));
        }

        @PutMapping("/{id}")
        public ResponseEntity<Product> updateProduct(
                        @PathVariable Long id,
                        @Valid @RequestBody Product product) {

                return ResponseEntity.ok(
                                productService.updateProduct(id, product));
        }

        @DeleteMapping("/{id}")
        public ResponseEntity<Void> deleteProduct(
                        @PathVariable Long id) {

                productService.deleteProduct(id);
                return ResponseEntity.noContent().build();
        }
}