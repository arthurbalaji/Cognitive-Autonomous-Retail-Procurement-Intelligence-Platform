package com.carpip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "api_key")
public class ApiKey {
    @Id
    public UUID id;
    @Column(name = "tenant_id")
    public UUID tenantId;
    public String name;
    public String prefix;
    @Column(name = "key_hash")
    public String keyHash;
    public String scopes;
    public String status = "ACTIVE"; // ACTIVE | ROTATING | REVOKED
    @Column(name = "expires_at")
    public Instant expiresAt;
    @Column(name = "last_used_at")
    public Instant lastUsedAt;
    @Column(name = "created_at")
    public Instant createdAt = Instant.now();
}
