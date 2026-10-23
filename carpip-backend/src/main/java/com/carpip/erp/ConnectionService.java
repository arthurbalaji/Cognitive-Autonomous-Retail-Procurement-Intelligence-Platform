package com.carpip.erp;

import com.carpip.common.Crypto;
import com.carpip.common.Hmac;
import com.carpip.common.Json;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Repos;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Credential / secret handling for connections (AES-GCM at rest) + outbound request signing. */
@Service
public class ConnectionService {
    private final Crypto crypto;
    private final Repos.ConnectionRepo repo;

    public ConnectionService(Crypto crypto, Repos.ConnectionRepo repo) {
        this.crypto = crypto;
        this.repo = repo;
    }

    public Map<String, Object> credentials(IntegrationConnection c) {
        if (c.credentialsEnc == null) {
            return new HashMap<>();
        }
        return Json.map(crypto.decrypt(c.credentialsEnc));
    }

    public String webhookSecret(IntegrationConnection c) {
        return crypto.decrypt(c.webhookSecretEnc);
    }

    /** Secrets accepted for inbound verification: current, plus previous while the rotation window is open. */
    public java.util.List<String> acceptedSecrets(IntegrationConnection c) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (c.webhookSecretEnc != null) {
            out.add(crypto.decrypt(c.webhookSecretEnc));
        }
        if (c.webhookSecretPrevEnc != null && c.prevValidUntil != null && c.prevValidUntil.isAfter(Instant.now())) {
            out.add(crypto.decrypt(c.webhookSecretPrevEnc));
        }
        return out;
    }

    @Transactional
    public void setSecrets(IntegrationConnection c, Map<String, Object> credentials, String webhookSecret) {
        if (credentials != null) {
            c.credentialsEnc = crypto.encrypt(Json.write(credentials));
        }
        if (webhookSecret != null) {
            c.webhookSecretEnc = crypto.encrypt(webhookSecret);
        }
    }

    @Transactional
    public Map<String, Object> rotateWebhookSecret(IntegrationConnection c, String newSecret) {
        c.webhookSecretPrevEnc = c.webhookSecretEnc;
        c.prevValidUntil = Instant.now().plusSeconds(24 * 3600);
        c.webhookSecretEnc = crypto.encrypt(newSecret);
        repo.save(c);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("webhookSecret", newSecret);
        m.put("previousValidUntil", c.prevValidUntil);
        return m;
    }

    /** Headers for CARPIP-scheme outbound calls (Path B). */
    public Map<String, String> signedHeaders(IntegrationConnection c, String idempotencyKey, String eventId, byte[] body, String tenantPublicId) {
        String ts = String.valueOf(Instant.now().getEpochSecond());
        String evt = eventId == null ? UUID.randomUUID().toString() : eventId;
        Map<String, String> h = new LinkedHashMap<>();
        h.put("X-Carpip-Timestamp", ts);
        h.put("X-Carpip-Event-Id", evt);
        h.put("X-Carpip-Signature", Hmac.carpipHeader(webhookSecret(c), ts, evt, body));
        if (idempotencyKey != null) {
            h.put("Idempotency-Key", idempotencyKey);
        }
        if (tenantPublicId != null) {
            h.put("X-Carpip-Tenant", tenantPublicId);
        }
        return h;
    }

    public void health(IntegrationConnection c, String health, String error) {
        c.health = health;
        c.lastError = error;
        repo.save(c);
    }
}
