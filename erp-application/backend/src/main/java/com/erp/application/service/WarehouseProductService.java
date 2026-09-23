package com.erp.application.service;

import com.erp.application.entity.WarehouseProduct;
import com.erp.application.repository.WarehouseProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class WarehouseProductService {

    private final WarehouseProductRepository productRepository;

    public List<WarehouseProduct> getAllProducts() {
        return productRepository.findAll();
    }

    public List<WarehouseProduct> getActiveProducts() {
        return productRepository.findByActiveTrue();
    }

    public WarehouseProduct getProductById(Long id) {
        return productRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Product not found with id: " + id));
    }

    public WarehouseProduct getProductBySku(String sku) {
        return productRepository.findBySku(sku)
                .orElseThrow(() -> new RuntimeException("Product not found with SKU: " + sku));
    }

    public List<WarehouseProduct> searchByName(String name) {
        return productRepository.findByNameContainingIgnoreCase(name);
    }

    public List<WarehouseProduct> searchBySku(String sku) {
        return productRepository.findBySkuContainingIgnoreCase(sku);
    }

    public List<WarehouseProduct> getLowStockProducts() {
        List<WarehouseProduct> all = productRepository.findByActiveTrue();
        return all.stream()
                .filter(p -> p.getStockQuantity() <= p.getReorderLevel())
                .toList();
    }

    public WarehouseProduct createProduct(WarehouseProduct product) {
        return productRepository.save(product);
    }

    public WarehouseProduct updateProduct(Long id, WarehouseProduct updated) {
        WarehouseProduct product = getProductById(id);
        product.setName(updated.getName());
        product.setSku(updated.getSku());
        product.setDescription(updated.getDescription());
        product.setCategory(updated.getCategory());
        product.setUnitCost(updated.getUnitCost());
        product.setSellingPrice(updated.getSellingPrice());
        product.setStockQuantity(updated.getStockQuantity());
        product.setReorderLevel(updated.getReorderLevel());
        product.setWarehouseLocation(updated.getWarehouseLocation());
        product.setUnit(updated.getUnit());
        product.setActive(updated.getActive());
        return productRepository.save(product);
    }

    public void deleteProduct(Long id) {
        productRepository.deleteById(id);
    }
}
