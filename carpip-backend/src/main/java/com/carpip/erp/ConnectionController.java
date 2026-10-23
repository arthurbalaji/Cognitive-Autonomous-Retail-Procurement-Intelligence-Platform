package com.carpip.erp;

import com.carpip.audit.AuditService;
import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import com.carpip.common.ApiException;
import com.carpip.config.AppProps;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/integrations")
public class ConnectionController {
    private final Repos.ConnectionRepo connections;
    private final Repos.TenantRepo tenants;
    private final ConnectionService conns;
    private final AdapterRegistry adapters;
    private final ErpSyncService syncService;
    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final AppProps props;

    public ConnectionController(Repos.ConnectionRepo connections, Repos.TenantRepo tenants, ConnectionService conns, AdapterRegistry adapters,
                                ErpSyncService syncService, JdbcTemplate jdbc, AuditService audit, AppProps props) {
        this.connections = connections;
        this.tenants = tenants;
        this.conns = conns;
        this.adapters = adapters;
        this.syncService = syncService;
        this.jdbc = jdbc;
        this.audit = audit;
        this.props = props;
    }

    public record CreateConnection(UUID tenantId, String type, String direction, String baseUrl, Map<String, Object> config,
                                   Map<String, Object> credentials, String webhookSecret) {
    }

    private IntegrationConnection own(UUID id) {
        Principal p = TenantContext.requireUser();
        IntegrationConnection c = connections.findById(id).orElseThrow(() -> ApiException.notFound("connection"));
        if (!p.isAdmin() && !c.tenantId.equals(p.tenantId())) {
            throw ApiException.notFound("connection");
        }
        return c;
    }

    private Map<String, Object> view(IntegrationConnection c) {
        Tenant t = tenants.findById(c.tenantId).orElseThrow();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.id);
        m.put("tenantId", c.tenantId);
        m.put("tenantName", t.name);
        m.put("tenantType", t.type);
        m.put("type", c.type);
        m.put("direction", c.direction);
        m.put("baseUrl", c.baseUrl);
        Map<String, Object> cfg = new HashMap<>(c.config == null ? Map.of() : c.config);
        cfg.keySet().removeIf(k -> k.startsWith("accessToken"));
        m.put("config", cfg);
        m.put("status", c.status);
        m.put("health", c.health);
        m.put("lastSyncAt", c.lastSyncAt);
        m.put("lastError", c.lastError);
        m.put("lastWebhookAt", c.syncCursor == null ? null : c.syncCursor.get("lastWebhookAt"));
        m.put("webhookAddress", props.publicWebhookBase() + "/api/erp/webhook/" + t.publicId);
        m.put("hasWebhookSecret", c.webhookSecretEnc != null);
        m.put("secretRotationOpenUntil", c.prevValidUntil);
        Map<String, Object> counts = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc.queryForList("SELECT status, count(*) AS n FROM inbound_event WHERE tenant_id=? AND received_at > now() - interval '24 hours' GROUP BY status", c.tenantId)) {
            counts.put((String) r.get("status"), r.get("n"));
        }
        m.put("inbound24h", counts);
        Integer pending = jdbc.queryForObject("SELECT count(*) FROM writeback_task WHERE tenant_id=? AND status IN ('PENDING','FAILED')", Integer.class, c.tenantId);
        Integer dead = jdbc.queryForObject("SELECT count(*) FROM writeback_task WHERE tenant_id=? AND status='DEAD'", Integer.class, c.tenantId);
        m.put("writebacksPending", pending);
        m.put("writebacksDead", dead);
        return m;
    }

    @GetMapping("/connections")
    public List<Map<String, Object>> list() {
        Principal p = TenantContext.requireUser();
        List<IntegrationConnection> all = p.isAdmin() ? connections.findAll() : connections.findByTenantId(p.tenantId()).map(List::of).orElse(List.of());
        List<Map<String, Object>> out = new ArrayList<>();
        all.forEach(c -> out.add(view(c)));
        return out;
    }

    @PostMapping("/connections")
    @Transactional
    public Map<String, Object> create(@RequestBody CreateConnection req) {
        Principal p = TenantContext.requireUser();
        UUID tenantId = p.isAdmin() ? req.tenantId() : p.tenantId();
        if (tenantId == null) {
            throw ApiException.bad("BAD_REQUEST", "tenantId required");
        }
        Tenant t = tenants.findById(tenantId).orElseThrow(() -> ApiException.notFound("tenant"));
        String type = req.type() == null ? "" : req.type().toUpperCase();
        String direction = "RETAILER".equals(t.type) ? "RETAIL_POS" : "SUPPLIER_ERP";
        if (!List.of("SHOPIFY", "CUSTOM_REST", "ZOHO").contains(type)) {
            throw ApiException.bad("BAD_REQUEST", "type must be SHOPIFY | CUSTOM_REST | ZOHO");
        }
        if (("SHOPIFY".equals(type) && !"RETAIL_POS".equals(direction)) || ("ZOHO".equals(type) && !"SUPPLIER_ERP".equals(direction))) {
            throw ApiException.bad("BAD_CONNECTOR", type + " cannot be used by a " + t.type + " tenant");
        }
        IntegrationConnection c = connections.findByTenantId(tenantId).orElseGet(() -> {
            IntegrationConnection n = new IntegrationConnection();
            n.id = UUID.randomUUID();
            n.tenantId = tenantId;
            return n;
        });
        c.type = type;
        c.direction = direction;
        c.baseUrl = req.baseUrl() == null ? null : req.baseUrl().replaceAll("/+$", "");
        c.config = req.config() == null ? new HashMap<>() : new HashMap<>(req.config());
        c.status = "ACTIVE";
        c.health = "UNKNOWN";
        conns.setSecrets(c, req.credentials(), req.webhookSecret());
        connections.save(c);
        audit.log(tenantId, "USER", String.valueOf(p.userId()), "CONNECTION_SAVED", "integration_connection", c.id.toString(), Map.of("type", type));
        return view(c);
    }

    @PostMapping("/connections/{id}/test")
    public Map<String, Object> test(@PathVariable UUID id) {
        IntegrationConnection c = own(id);
        Map<String, Object> r = adapters.get(c.type).testConnection(c);
        boolean ok = Boolean.TRUE.equals(r.get("ok"));
        if (ok) {
            if ("UNKNOWN".equals(c.health) || "ERROR".equals(c.health)) {
                conns.health(c, "OK", null);
            }
        } else {
            conns.health(c, "ERROR", String.valueOf(r.get("detail")));
        }
        return r;
    }

    @PostMapping("/connections/{id}/sync")
    public Map<String, Object> sync(@PathVariable UUID id) {
        IntegrationConnection c = own(id);
        ErpAdapter.SyncStats st = syncService.syncOne(c.id);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("products", st.products());
        m.put("stockLevelsApplied", st.levels());
        m.put("ordersImported", st.orders());
        m.put("offers", st.offers());
        m.put("poUpdates", st.poUpdates());
        m.put("note", st.note());
        return m;
    }

    @PostMapping("/connections/{id}/register-webhooks")
    public Map<String, Object> registerWebhooks(@PathVariable UUID id) {
        IntegrationConnection c = own(id);
        if (!"SHOPIFY".equals(c.type)) {
            throw ApiException.bad("NOT_SUPPORTED", "only Shopify connections have registrable webhooks");
        }
        return ((ShopifyAdapter) adapters.get("SHOPIFY")).registerWebhooks(c);
    }

    @PostMapping("/connections/{id}/rotate-webhook-secret")
    @Transactional
    public Map<String, Object> rotate(@PathVariable UUID id) {
        IntegrationConnection c = own(id);
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        Map<String, Object> r = conns.rotateWebhookSecret(c, HexFormat.of().formatHex(b));
        audit.log(c.tenantId, "USER", String.valueOf(TenantContext.require().userId()), "WEBHOOK_SECRET_ROTATED", "integration_connection", c.id.toString(), null);
        return r;
    }

    @GetMapping("/connections/{id}/events")
    public List<Map<String, Object>> events(@PathVariable UUID id, @RequestParam(required = false) String status, @RequestParam(defaultValue = "50") int limit) {
        IntegrationConnection c = own(id);
        int l = Math.min(Math.max(limit, 1), 200);
        String sql = "SELECT id, source, external_event_id, topic, status, error, received_at FROM inbound_event WHERE tenant_id=?" +
                (status == null ? "" : " AND status=?") + " ORDER BY received_at DESC LIMIT " + l;
        return status == null ? jdbc.queryForList(sql, c.tenantId) : jdbc.queryForList(sql, c.tenantId, status);
    }

    @GetMapping("/writebacks")
    public List<Map<String, Object>> writebacks(@RequestParam(required = false) String status, @RequestParam(defaultValue = "50") int limit) {
        Principal p = TenantContext.requireUser();
        int l = Math.min(Math.max(limit, 1), 200);
        String base = "SELECT w.id, w.kind, w.status, w.attempts, w.last_error, w.next_attempt_at, w.created_at, po.po_number, t.name AS tenant " +
                "FROM writeback_task w LEFT JOIN purchase_order po ON po.id = w.po_id JOIN tenant t ON t.id = w.tenant_id WHERE 1=1" +
                (p.isAdmin() ? "" : " AND w.tenant_id = ?") + (status == null ? "" : " AND w.status = ?") + " ORDER BY w.created_at DESC LIMIT " + l;
        List<Object> args = new ArrayList<>();
        if (!p.isAdmin()) {
            args.add(p.tenantId());
        }
        if (status != null) {
            args.add(status);
        }
        return jdbc.queryForList(base, args.toArray());
    }

    @PostMapping("/writebacks/{id}/retry")
    public Map<String, Object> retry(@PathVariable UUID id) {
        TenantContext.requireRole("ADMIN");
        int n = jdbc.update("UPDATE writeback_task SET status='PENDING', attempts=0, next_attempt_at=now() WHERE id=? AND status IN ('DEAD','FAILED')", id);
        return Map.of("requeued", n);
    }
}
