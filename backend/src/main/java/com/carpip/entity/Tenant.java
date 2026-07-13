package com.carpip.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.Map;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "tenants")
public class Tenant {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TenantType type;

    @Column(nullable = false)
    private String name;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "text")
    private Map<String, String> apiKeys;

    @Column(name = "erp_provider")
    private String erpProvider;

    @Column(name = "last_sync_at")
    private LocalDateTime lastSyncAt;

    @Column(name = "last_sync_error")
    private String lastSyncError;

    @Column(name = "last_sync_product_count")
    private Integer lastSyncProductCount;

    @Column(name = "last_sync_sales_count")
    private Integer lastSyncSalesCount;

    @Column(name = "sync_interval_minutes")
    private Integer syncIntervalMinutes;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public enum TenantType {
        RETAILER, WHOLESALER
    }

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public TenantType getType() { return type; }
    public void setType(TenantType type) { this.type = type; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public Map<String, String> getApiKeys() { return apiKeys; }
    public void setApiKeys(Map<String, String> apiKeys) { this.apiKeys = apiKeys; }

    public String getErpProvider() { return erpProvider; }
    public void setErpProvider(String erpProvider) { this.erpProvider = erpProvider; }

    public LocalDateTime getLastSyncAt() { return lastSyncAt; }
    public void setLastSyncAt(LocalDateTime lastSyncAt) { this.lastSyncAt = lastSyncAt; }

    public String getLastSyncError() { return lastSyncError; }
    public void setLastSyncError(String lastSyncError) { this.lastSyncError = lastSyncError; }

    public Integer getLastSyncProductCount() { return lastSyncProductCount; }
    public void setLastSyncProductCount(Integer lastSyncProductCount) { this.lastSyncProductCount = lastSyncProductCount; }

    public Integer getLastSyncSalesCount() { return lastSyncSalesCount; }
    public void setLastSyncSalesCount(Integer lastSyncSalesCount) { this.lastSyncSalesCount = lastSyncSalesCount; }

    public Integer getSyncIntervalMinutes() { return syncIntervalMinutes != null ? syncIntervalMinutes : 5; }
    public void setSyncIntervalMinutes(Integer syncIntervalMinutes) { this.syncIntervalMinutes = syncIntervalMinutes; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
