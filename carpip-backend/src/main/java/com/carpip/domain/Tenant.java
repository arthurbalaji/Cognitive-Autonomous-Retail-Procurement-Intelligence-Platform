package com.carpip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "tenant")
public class Tenant {
    @Id
    public UUID id;
    @Column(name = "public_id")
    public String publicId;
    public String name;
    public String type; // ADMIN | RETAILER | WHOLESALER
    public String status = "ACTIVE";
    public String currency = "INR";
    public String timezone = "Asia/Kolkata";
    public String region;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    public Map<String, Object> settings = new HashMap<>();
    @Column(name = "created_at")
    public Instant createdAt = Instant.now();

    public String setting(String key, String dflt) {
        Object v = settings == null ? null : settings.get(key);
        return v == null ? dflt : v.toString();
    }
}
