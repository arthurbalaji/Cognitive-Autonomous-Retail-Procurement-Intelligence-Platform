package com.carpip.tenant;

import com.carpip.audit.AuditService;
import com.carpip.auth.ApiKeyService;
import com.carpip.auth.Principal;
import com.carpip.auth.TenantContext;
import com.carpip.common.ApiException;
import com.carpip.domain.AppUser;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class TenantController {
    private final Repos.TenantRepo tenants;
    private final Repos.UserRepo users;
    private final ApiKeyService keys;
    private final AuditService audit;
    private final JdbcTemplate jdbc;
    private final BCryptPasswordEncoder enc = new BCryptPasswordEncoder();
    private final SecureRandom rnd = new SecureRandom();

    public TenantController(Repos.TenantRepo tenants, Repos.UserRepo users, ApiKeyService keys, AuditService audit, JdbcTemplate jdbc) {
        this.tenants = tenants;
        this.users = users;
        this.keys = keys;
        this.audit = audit;
        this.jdbc = jdbc;
    }

    public record CreateTenant(String name, String type, String currency, String region, Map<String, Object> settings,
                               String adminEmail, String adminPassword, String publicId) {
    }

    public record CreateUser(String email, String password, String displayName) {
    }

    public record CreateKey(String name, String scopes) {
    }

    public record Relationship(UUID retailerTenantId, UUID wholesalerTenantId) {
    }

    private String publicId() {
        String a = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder("ten_");
        for (int i = 0; i < 12; i++) {
            sb.append(a.charAt(rnd.nextInt(a.length())));
        }
        return sb.toString();
    }

    public Map<String, Object> view(Tenant t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.id);
        m.put("publicId", t.publicId);
        m.put("name", t.name);
        m.put("type", t.type);
        m.put("status", t.status);
        m.put("currency", t.currency);
        m.put("region", t.region);
        m.put("settings", t.settings);
        m.put("createdAt", t.createdAt);
        return m;
    }

    // ------------------------------------------------------------- admin
    @PostMapping("/admin/tenants")
    @Transactional
    public Map<String, Object> createTenant(@RequestBody CreateTenant req) {
        Principal p = TenantContext.requireRole("ADMIN");
        if (req.name() == null || req.type() == null || !List.of("RETAILER", "WHOLESALER").contains(req.type())) {
            throw ApiException.bad("BAD_REQUEST", "name and type (RETAILER|WHOLESALER) required");
        }
        Tenant t = new Tenant();
        t.id = UUID.randomUUID();
        t.publicId = req.publicId() != null && !req.publicId().isBlank() ? req.publicId() : publicId();
        t.name = req.name();
        t.type = req.type();
        if (req.currency() != null) {
            t.currency = req.currency();
        }
        t.region = req.region();
        Map<String, Object> s = new HashMap<>();
        if ("RETAILER".equals(t.type)) {
            s.put("autonomy_mode", "AUTO");
            s.put("auto_approve_limit_inr", "250000");
            s.put("target_margin_pct", "0.25");
            s.put("safety_days", "3");
        }
        if (req.settings() != null) {
            s.putAll(req.settings());
        }
        t.settings = s;
        tenants.save(t);
        if (req.adminEmail() != null && req.adminPassword() != null) {
            addUser(t, req.adminEmail(), req.adminPassword(), req.name() + " admin");
        }
        audit.log(p.tenantId(), "USER", String.valueOf(p.userId()), "TENANT_CREATED", "tenant", t.id.toString(), Map.of("name", t.name, "type", t.type));
        return view(t);
    }

    @GetMapping("/admin/tenants")
    public List<Map<String, Object>> listTenants(@RequestParam(required = false) String type) {
        TenantContext.requireRole("ADMIN");
        List<Tenant> all = type == null ? tenants.findAll() : tenants.findByType(type);
        return all.stream().map(this::view).toList();
    }

    @PostMapping("/admin/tenants/{id}/users")
    @Transactional
    public Map<String, Object> createUser(@PathVariable UUID id, @RequestBody CreateUser req) {
        TenantContext.requireRole("ADMIN");
        Tenant t = tenants.findById(id).orElseThrow(() -> ApiException.notFound("tenant"));
        AppUser u = addUser(t, req.email(), req.password(), req.displayName());
        return Map.of("id", u.id, "email", u.email, "role", u.role);
    }

    private AppUser addUser(Tenant t, String email, String password, String displayName) {
        if (email == null || password == null || password.length() < 8) {
            throw ApiException.bad("BAD_REQUEST", "email and password (min 8 chars) required");
        }
        if (users.findByEmailIgnoreCase(email).isPresent()) {
            throw ApiException.conflict("EMAIL_EXISTS", "email already registered");
        }
        AppUser u = new AppUser();
        u.id = UUID.randomUUID();
        u.tenantId = t.id;
        u.email = email.toLowerCase();
        u.passwordHash = enc.encode(password);
        u.role = t.type;
        u.displayName = displayName;
        return users.save(u);
    }

    @PostMapping("/admin/tenants/{id}/api-keys")
    public Map<String, Object> adminCreateKey(@PathVariable UUID id, @RequestBody CreateKey req) {
        TenantContext.requireRole("ADMIN");
        tenants.findById(id).orElseThrow(() -> ApiException.notFound("tenant"));
        return keys.create(id, req.name() == null ? "key" : req.name(), req.scopes());
    }

    @PostMapping("/admin/trade-relationships")
    public Map<String, Object> relate(@RequestBody Relationship r) {
        TenantContext.requireRole("ADMIN");
        jdbc.update("INSERT INTO trade_relationship(retailer_tenant_id, wholesaler_tenant_id, status) VALUES (?,?, 'ACTIVE') ON CONFLICT DO NOTHING",
                r.retailerTenantId(), r.wholesalerTenantId());
        return Map.of("status", "ok");
    }

    @GetMapping("/admin/trade-relationships")
    public List<Map<String, Object>> relations() {
        TenantContext.requireRole("ADMIN");
        return jdbc.queryForList("SELECT r.retailer_tenant_id, rt.name AS retailer, r.wholesaler_tenant_id, wt.name AS wholesaler, r.status " +
                "FROM trade_relationship r JOIN tenant rt ON rt.id=r.retailer_tenant_id JOIN tenant wt ON wt.id=r.wholesaler_tenant_id ORDER BY 2,4");
    }

    // ------------------------------------------------------------- me
    @GetMapping("/tenants/me")
    public Map<String, Object> me() {
        Tenant t = tenants.findById(TenantContext.tenantId()).orElseThrow();
        return view(t);
    }

    @PatchMapping("/tenants/me/settings")
    @Transactional
    public Map<String, Object> patchSettings(@RequestBody Map<String, Object> patch) {
        Principal p = TenantContext.requireUser();
        Tenant t = tenants.findById(p.tenantId()).orElseThrow();
        Object mode = patch.get("autonomy_mode");
        if (mode != null && !List.of("AUTO", "APPROVAL_ABOVE_LIMIT", "ALWAYS_APPROVE").contains(mode.toString())) {
            throw ApiException.bad("BAD_REQUEST", "autonomy_mode must be AUTO | APPROVAL_ABOVE_LIMIT | ALWAYS_APPROVE");
        }
        Map<String, Object> s = new HashMap<>(t.settings == null ? Map.of() : t.settings);
        s.putAll(patch);
        t.settings = s;
        tenants.save(t);
        audit.log(t.id, "USER", String.valueOf(p.userId()), "SETTINGS_CHANGED", "tenant", t.id.toString(), patch);
        return view(t);
    }

    @GetMapping("/tenants/me/api-keys")
    public List<Map<String, Object>> myKeys() {
        return keys.list(TenantContext.requireUser().tenantId());
    }

    @PostMapping("/tenants/me/api-keys")
    public Map<String, Object> createMyKey(@RequestBody CreateKey req) {
        Principal p = TenantContext.requireUser();
        return keys.create(p.tenantId(), req.name() == null ? "key" : req.name(), req.scopes());
    }

    @PostMapping("/tenants/me/api-keys/{id}/rotate")
    public Map<String, Object> rotate(@PathVariable UUID id) {
        return keys.rotate(TenantContext.requireUser().tenantId(), id);
    }

    @DeleteMapping("/tenants/me/api-keys/{id}")
    public Map<String, Object> revoke(@PathVariable UUID id) {
        keys.revoke(TenantContext.requireUser().tenantId(), id);
        return Map.of("status", "revoked");
    }
}
