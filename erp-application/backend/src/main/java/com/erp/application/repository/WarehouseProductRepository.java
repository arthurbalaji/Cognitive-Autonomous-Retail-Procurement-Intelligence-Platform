package com.erp.application.repository;

import com.erp.application.entity.WarehouseProduct;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WarehouseProductRepository extends JpaRepository<WarehouseProduct, Long> {

    List<WarehouseProduct> findByNameContainingIgnoreCase(String name);

    List<WarehouseProduct> findBySkuContainingIgnoreCase(String sku);

    Optional<WarehouseProduct> findBySku(String sku);

    List<WarehouseProduct> findByActiveTrue();

    List<WarehouseProduct> findByStockQuantityLessThanEqual(int threshold);

    List<WarehouseProduct> findByCategoryId(Long categoryId);
}
