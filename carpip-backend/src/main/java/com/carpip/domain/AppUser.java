package com.carpip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "app_user")
public class AppUser {
    @Id
    public UUID id;
    @Column(name = "tenant_id")
    public UUID tenantId;
    public String email;
    @Column(name = "password_hash")
    public String passwordHash;
    public String role;
    @Column(name = "display_name")
    public String displayName;
    public boolean active = true;
    @Column(name = "created_at")
    public Instant createdAt = Instant.now();
}
