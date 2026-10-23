package com.carpip.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public final class Repos {
    private Repos() {
    }

    @Repository
    public interface TenantRepo extends JpaRepository<Tenant, UUID> {
        Optional<Tenant> findByPublicId(String publicId);

        List<Tenant> findByType(String type);
    }

    @Repository
    public interface UserRepo extends JpaRepository<AppUser, UUID> {
        Optional<AppUser> findByEmailIgnoreCase(String email);

        List<AppUser> findByTenantId(UUID tenantId);
    }

    @Repository
    public interface ApiKeyRepo extends JpaRepository<ApiKey, UUID> {
        Optional<ApiKey> findByPrefix(String prefix);

        List<ApiKey> findByTenantId(UUID tenantId);
    }

    @Repository
    public interface ProductRepo extends JpaRepository<Product, UUID> {
        Optional<Product> findByTenantIdAndSku(UUID tenantId, String sku);

        Optional<Product> findByTenantIdAndGtin(UUID tenantId, String gtin);

        Optional<Product> findByIdAndTenantId(UUID id, UUID tenantId);

        List<Product> findByTenantId(UUID tenantId);

        @Query(value = "SELECT * FROM product WHERE tenant_id = :tid AND external_ids->>'inventory_item_id' = :iid LIMIT 1", nativeQuery = true)
        Optional<Product> findByInventoryItemId(UUID tid, String iid);
    }

    @Repository
    public interface PurchaseOrderRepo extends JpaRepository<PurchaseOrder, UUID> {
        Optional<PurchaseOrder> findByPoNumber(String poNumber);

        List<PurchaseOrder> findByRetailerTenantIdOrderByCreatedAtDesc(UUID tenantId);

        List<PurchaseOrder> findByWholesalerTenantIdOrderByCreatedAtDesc(UUID tenantId);
    }

    @Repository
    public interface ConnectionRepo extends JpaRepository<IntegrationConnection, UUID> {
        Optional<IntegrationConnection> findByTenantId(UUID tenantId);
    }
}
