package com.carpip.erp;

import com.carpip.common.Hmac;
import com.carpip.common.Json;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Repos;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Path B – open, vendor-neutral contract for proprietary / legacy systems.
 *  inbound : external system pushes to /api/v1/*, /api/erp/sync (Bearer API key) or signs webhooks (X-Carpip-Signature)
 *  outbound: CARPIP calls the system's endpoints, signed with the shared secret + Idempotency-Key.
 * Scheme: X-Carpip-Signature: v1=hex(HMAC_SHA256(secret, timestamp + "." + eventId + "." + rawBody))
 */
@Component
public class CustomRestAdapter implements ErpAdapter {
    private final ConnectionService conns;
    private final Repos.TenantRepo tenants;
    private final Repos.ConnectionRepo connRepo;
    private final com.carpip.config.AppProps props;

    public CustomRestAdapter(ConnectionService conns, Repos.TenantRepo tenants, Repos.ConnectionRepo connRepo, com.carpip.config.AppProps props) {
        this.conns = conns;
        this.tenants = tenants;
        this.connRepo = connRepo;
        this.props = props;
    }

    @Override
    public String type() {
        return "CUSTOM_REST";
    }

    private String tenantPublicId(IntegrationConnection c) {
        return tenants.findById(c.tenantId).orElseThrow().publicId;
    }

    private Http.Resp signedPost(IntegrationConnection c, String path, Map<String, Object> body, String idemKey) {
        byte[] bytes = Json.write(body).getBytes(StandardCharsets.UTF_8);
        Map<String, String> h = conns.signedHeaders(c, idemKey, null, bytes, tenantPublicId(c));
        return Http.post(c.baseUrl + path, h, new String(bytes, StandardCharsets.UTF_8));
    }

    @Override
    public Map<String, Object> testConnection(IntegrationConnection c) {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            String path = "RETAIL_POS".equals(c.direction) ? "/legacy/health" : "/api/v1/carpip/ping";
            byte[] empty = new byte[0];
            Map<String, String> h = conns.signedHeaders(c, null, null, empty, tenantPublicId(c));
            Http.Resp r = Http.get(c.baseUrl + path, h);
            out.put("ok", r.ok());
            out.put("status", r.status());
            if (r.ok()) {
                out.put("remote", r.json());
            } else {
                out.put("detail", r.body());
            }
        } catch (Exception e) {
            out.put("ok", false);
            out.put("detail", e.getMessage());
        }
        return out;
    }

    @Override
    public SyncStats sync(IntegrationConnection c) {
        // push-only contract: evaluate freshness instead of pulling
        long staleAfter = Math.max(3 * props.erpSyncIntervalMs(), 120_000);
        Instant last = c.lastSyncAt;
        if (last != null && Duration.between(last, Instant.now()).toMillis() > staleAfter) {
            c.health = "STALE";
            c.lastError = "no push received in " + Duration.between(last, Instant.now()).toSeconds() + "s";
        } else if (last != null) {
            c.health = "OK";
            c.lastError = null;
        }
        connRepo.save(c);
        return SyncStats.none("push-only connector; freshness evaluated");
    }

    @Override
    public boolean verifyWebhook(IntegrationConnection c, Map<String, String> headers, byte[] body) {
        String sig = headers.get("x-carpip-signature");
        String ts = headers.get("x-carpip-timestamp");
        String evt = headers.get("x-carpip-event-id");
        if (sig == null || ts == null || evt == null) {
            return false;
        }
        for (String secret : conns.acceptedSecrets(c)) {
            if (Hmac.carpipMatches(sig, secret, ts, evt, body)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public String eventId(Map<String, String> headers, JsonNode body) {
        return headers.get("x-carpip-event-id");
    }

    @Override
    public Long eventTimestamp(Map<String, String> headers) {
        try {
            return Long.parseLong(headers.get("x-carpip-timestamp"));
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public List<CanonicalEvent> parseWebhook(IntegrationConnection c, Map<String, String> headers, JsonNode body) {
        return List.of(); // supplier events handled by SupplierEventService; retail legacy uses /api/v1/*
    }

    @Override
    public Map<String, Object> writeback(IntegrationConnection c, String kind, Map<String, Object> view) {
        Http.Resp r;
        switch (kind) {
            case "SUBMIT_PO" -> r = signedPost(c, "/api/v1/carpip/purchase-orders", view, (String) view.get("idempotencyKey"));
            case "CANCEL_PO" -> r = signedPost(c, "/api/v1/carpip/purchase-orders/" + view.get("poNumber") + "/cancel", view, view.get("poNumber") + ":CANCEL");
            case "PUSH_INCOMING" -> {
                Map<String, Object> b = new LinkedHashMap<>(view);
                b.put("event", "purchase_order.status");
                r = signedPost(c, "/legacy/carpip/callback", b, view.get("poNumber") + ":" + view.get("status") + ":" + view.get("quantityShipped"));
            }
            case "ADJUST_STOCK" -> {
                Map<String, Object> b = new LinkedHashMap<>(view);
                b.put("event", "stock.receipt");
                r = signedPost(c, "/legacy/carpip/callback", b, String.valueOf(view.get("idempotencyKey")));
            }
            default -> throw new UnsupportedOperationException(kind);
        }
        if (!r.ok()) {
            throw new IllegalStateException(kind + " -> HTTP " + r.status() + " " + (r.body() == null ? "" : r.body().substring(0, Math.min(200, r.body().length()))));
        }
        Map<String, Object> resp = r.body() == null || r.body().isBlank() ? Map.of() : Json.map(r.body());
        return resp;
    }
}
