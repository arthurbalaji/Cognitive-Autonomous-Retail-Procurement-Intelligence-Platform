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

    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
