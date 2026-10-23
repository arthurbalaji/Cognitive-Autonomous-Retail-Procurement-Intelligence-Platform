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
@Table(name = "integration_connection")
public class IntegrationConnection {
    @Id
    public UUID id;
    @Column(name = "tenant_id")
    public UUID tenantId;
    public String type; // SHOPIFY | CUSTOM_REST | ZOHO
    public String direction; // RETAIL_POS | SUPPLIER_ERP
    @Column(name = "base_url")
    public String baseUrl;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    public Map<String, Object> config = new HashMap<>();
    @Column(name = "credentials_enc")
    public String credentialsEnc;
    @Column(name = "webhook_secret_enc")
    public String webhookSecretEnc;
    @Column(name = "webhook_secret_prev_enc")
    public String webhookSecretPrevEnc;
    @Column(name = "prev_valid_until")
    public Instant prevValidUntil;
    public String status = "ACTIVE";
    public String health = "UNKNOWN";
    @Column(name = "last_sync_at")
    public Instant lastSyncAt;
    @Column(name = "last_error")
    public String lastError;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "sync_cursor", columnDefinition = "jsonb")
    public Map<String, Object> syncCursor = new HashMap<>();
    @Column(name = "created_at")
    public Instant createdAt = Instant.now();

    public String cfg(String key) {
        Object v = config == null ? null : config.get(key);
        return v == null ? null : v.toString();
    }
}
