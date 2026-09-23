package com.pos.application.service;

import com.pos.application.entity.Product;
import com.pos.application.exception.BusinessException;
import com.pos.application.exception.ResourceNotFoundException;
import com.pos.application.repository.ProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    public List<Product> getAllProducts() {
        return productRepository.findAll();
    }

    public Product getProductById(Long id) {
        return productRepository.findById(id)
                .orElseThrow(() ->
                        new ResourceNotFoundException("Product not found"));
    }

    public List<Product> searchByName(String name) {
        return productRepository
                .findByNameContainingIgnoreCaseAndActiveTrueOrderByNameAsc(name);
    }

    public List<Product> searchBySku(String sku) {
        return productRepository
                .findBySkuContainingIgnoreCaseAndActiveTrueOrderByNameAsc(sku);
    }

    public Product getByBarcode(String barcode) {
        return productRepository.findByBarcodeAndActiveTrue(barcode)
                .orElseThrow(() ->
                        new ResourceNotFoundException("Product not found"));
    }

    public Product createProduct(Product product) {

        if (productRepository.existsBySku(product.getSku())) {
            throw new BusinessException("Product SKU already exists");
        }

        if (product.getBarcode() != null &&
                productRepository.existsByBarcode(product.getBarcode())) {
            throw new BusinessException("Product barcode already exists");
        }

        return productRepository.save(product);
    }

    public Product updateProduct(Long id, Product updatedProduct) {

        Product product = getProductById(id);

        product.setName(updatedProduct.getName());
        product.setSku(updatedProduct.getSku());
        product.setBarcode(updatedProduct.getBarcode());
        product.setCategory(updatedProduct.getCategory());
        product.setPurchasePrice(updatedProduct.getPurchasePrice());
        product.setSellingPrice(updatedProduct.getSellingPrice());
        product.setTaxRate(updatedProduct.getTaxRate());
        product.setStockQuantity(updatedProduct.getStockQuantity());
        product.setReorderLevel(updatedProduct.getReorderLevel());
        product.setActive(updatedProduct.getActive());

        return productRepository.save(product);
    }

    public void deleteProduct(Long id) {
        Product product = getProductById(id);
        productRepository.delete(product);
    }
}