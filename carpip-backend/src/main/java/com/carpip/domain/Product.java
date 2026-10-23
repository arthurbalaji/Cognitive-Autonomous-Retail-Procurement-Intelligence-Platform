package com.carpip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "product")
public class Product {
    @Id
    public UUID id;
    @Column(name = "tenant_id")
    public UUID tenantId;
    public String sku;
    public String gtin;
    public String name;
    public String category = "LIFESTYLE";
    public String uom = "EA";
    @Column(name = "current_stock")
    public int currentStock;
    @Column(name = "reorder_point")
    public int reorderPoint;
    @Column(name = "rop_source")
    public String ropSource = "AUTO"; // AUTO | MANUAL
    @Column(name = "base_price")
    public BigDecimal basePrice;
    @Column(name = "retail_price")
    public BigDecimal retailPrice;
    @Column(name = "shelf_life_days")
    public Integer shelfLifeDays;
    public boolean perishable;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "external_ids", columnDefinition = "jsonb")
    public Map<String, Object> externalIds = new HashMap<>();
    @Column(name = "stock_source_version")
    public Instant stockSourceVersion;
    @Column(name = "reorder_blocked_until")
    public Instant reorderBlockedUntil;
    public boolean active = true;
    @Version
    public Long version;
    @Column(name = "created_at")
    public Instant createdAt = Instant.now();
    @Column(name = "updated_at")
    public Instant updatedAt = Instant.now();
}
