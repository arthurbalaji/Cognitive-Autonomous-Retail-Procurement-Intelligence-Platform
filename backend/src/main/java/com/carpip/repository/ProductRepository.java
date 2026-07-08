package com.carpip.repository;

import com.carpip.entity.Product;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProductRepository extends JpaRepository<Product, String> {
    List<Product> findByTenantId(String tenantId);
    Optional<Product> findByTenantIdAndSku(String tenantId, String sku);
    List<Product> findByTenantIdAndCurrentStockLessThanEqual(String tenantId, Integer reorderPoint);
}
