package com.carpip.auth;

import com.carpip.common.ApiException;
import com.carpip.common.Hmac;
import com.carpip.domain.ApiKey;
import com.carpip.domain.Repos;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** API keys look like ck_live_<prefix8>_<secret32>. Only a SHA-256 hash + prefix is stored. */
@Service
public class ApiKeyService {
    private static final String ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
    private final Repos.ApiKeyRepo repo;
    private final SecureRandom rnd = new SecureRandom();

    public ApiKeyService(Repos.ApiKeyRepo repo) {
        this.repo = repo;
    }

    private String rand(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            sb.append(ALPHABET.charAt(rnd.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }

    /** Returns the plaintext key exactly once. */
    @Transactional
    public Map<String, Object> create(UUID tenantId, String name, String scopes) {
        String prefix = rand(8);
        String full = "ck_live_" + prefix + "_" + rand(32);
        ApiKey k = new ApiKey();
        k.id = UUID.randomUUID();
        k.tenantId = tenantId;
        k.name = name;
        k.prefix = prefix;
        k.keyHash = Hmac.sha256Hex(full);
        if (scopes != null && !scopes.isBlank()) {
            k.scopes = scopes;
        } else {
            k.scopes = "inventory:write,orders:write,catalog:write,graphql:read";
        }
        repo.save(k);
        Map<String, Object> out = view(k);
        out.put("key", full);
        return out;
    }

    @Transactional
    public Map<String, Object> rotate(UUID tenantId, UUID keyId) {
        ApiKey old = repo.findById(keyId).filter(k -> k.tenantId.equals(tenantId)).orElseThrow(() -> ApiException.notFound("api key"));
        old.status = "ROTATING";
        old.expiresAt = Instant.now().plus(Duration.ofHours(24));
        repo.save(old);
        return create(tenantId, old.name + " (rotated)", old.scopes);
    }

    @Transactional
    public void revoke(UUID tenantId, UUID keyId) {
        ApiKey k = repo.findById(keyId).filter(x -> x.tenantId.equals(tenantId)).orElseThrow(() -> ApiException.notFound("api key"));
        k.status = "REVOKED";
        repo.save(k);
    }

    public List<Map<String, Object>> list(UUID tenantId) {
        return repo.findByTenantId(tenantId).stream().map(this::view).toList();
    }

    private Map<String, Object> view(ApiKey k) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", k.id);
        m.put("name", k.name);
        m.put("prefix", "ck_live_" + k.prefix + "_...");
        m.put("scopes", k.scopes);
        m.put("status", k.status);
        m.put("expiresAt", k.expiresAt);
        m.put("lastUsedAt", k.lastUsedAt);
        m.put("createdAt", k.createdAt);
        return m;
    }

    /** Resolve a presented key to a Principal, or empty. */
    public Optional<Principal> authenticate(String presented, Repos.TenantRepo tenants) {
        if (!presented.startsWith("ck_live_")) {
            return Optional.empty();
        }
        String rest = presented.substring("ck_live_".length());
        int us = rest.indexOf('_');
        if (us != 8) {
            return Optional.empty();
        }
        String prefix = rest.substring(0, 8);
        Optional<ApiKey> ok = repo.findByPrefix(prefix);
        if (ok.isEmpty()) {
            return Optional.empty();
        }
        ApiKey k = ok.get();
        if ("REVOKED".equals(k.status) || (k.expiresAt != null && k.expiresAt.isBefore(Instant.now()))) {
            return Optional.empty();
        }
        if (!Hmac.constantEq(k.keyHash, Hmac.sha256Hex(presented))) {
            return Optional.empty();
        }
        if (k.lastUsedAt == null || k.lastUsedAt.isBefore(Instant.now().minusSeconds(60))) {
            k.lastUsedAt = Instant.now();
            repo.save(k);
        }
        return tenants.findById(k.tenantId).filter(t -> "ACTIVE".equals(t.status)).map(t ->
                new Principal(null, t.id, t.type, "API_KEY", new HashSet<>(Arrays.asList(k.scopes.split(","))), null));
    }
}
