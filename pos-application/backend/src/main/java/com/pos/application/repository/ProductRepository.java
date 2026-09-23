package com.pos.application.repository;

import com.pos.application.entity.Product;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface ProductRepository extends JpaRepository<Product, Long> {

    Optional<Product> findBySku(String sku);

    Optional<Product> findByBarcode(String barcode);

    boolean existsBySku(String sku);

    boolean existsByBarcode(String barcode);

    @Query("""
                SELECT p
                FROM Product p
                WHERE p.active = true
                AND p.stockQuantity <= p.reorderLevel
                ORDER BY p.stockQuantity ASC
            """)

    List<Product> findLowStockProducts();

    @Query("""
                SELECT COALESCE(SUM(p.stockQuantity), 0)
                FROM Product p
                WHERE p.active = true
            """)
    long getTotalStockUnits();

    @Query("""
                SELECT COUNT(p)
                FROM Product p
                WHERE p.active = true
                AND p.stockQuantity = 0
            """)
    long countOutOfStockProducts();

    List<Product> findByNameContainingIgnoreCaseAndActiveTrueOrderByNameAsc(
            String name);

    List<Product> findBySkuContainingIgnoreCaseAndActiveTrueOrderByNameAsc(
            String sku);

    Optional<Product> findByBarcodeAndActiveTrue(String barcode);
}