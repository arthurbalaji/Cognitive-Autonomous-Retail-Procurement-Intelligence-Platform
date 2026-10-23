package com.carpip.auth;

import com.carpip.audit.AuditService;
import com.carpip.common.ApiException;
import com.carpip.domain.AppUser;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final Repos.UserRepo users;
    private final Repos.TenantRepo tenants;
    private final JwtService jwt;
    private final RateLimiter limiter;
    private final AuditService audit;
    private final BCryptPasswordEncoder enc = new BCryptPasswordEncoder();

    public AuthController(Repos.UserRepo users, Repos.TenantRepo tenants, JwtService jwt, RateLimiter limiter, AuditService audit) {
        this.users = users;
        this.tenants = tenants;
        this.jwt = jwt;
        this.limiter = limiter;
        this.audit = audit;
    }

    public record LoginRequest(String email, String password) {
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody LoginRequest req) {
        if (req == null || req.email() == null || req.password() == null) {
            throw ApiException.bad("BAD_REQUEST", "email and password required");
        }
        AppUser u = users.findByEmailIgnoreCase(req.email().trim()).orElse(null);
        if (u == null || !u.active || !enc.matches(req.password(), u.passwordHash)) {
            audit.log(u == null ? null : u.tenantId, "USER", req.email(), "LOGIN_FAILED", "user", null, null);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "invalid email or password");
        }
        Tenant t = tenants.findById(u.tenantId).orElseThrow();
        if (!"ACTIVE".equals(t.status)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "TENANT_INACTIVE", "tenant is not active");
        }
        audit.log(t.id, "USER", u.id.toString(), "LOGIN", "user", u.id.toString(), null);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("token", jwt.issue(u, t));
        out.put("user", userView(u, t));
        return out;
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(@RequestHeader("Authorization") String auth) {
        Principal p = TenantContext.requireUser();
        String token = auth.substring(7).trim();
        limiter.deny(p.jti(), jwt.expiry(token));
        return Map.of("status", "ok");
    }

    @GetMapping("/me")
    public Map<String, Object> me() {
        Principal p = TenantContext.requireUser();
        AppUser u = users.findById(p.userId()).orElseThrow(() -> ApiException.unauthorized("user no longer exists"));
        Tenant t = tenants.findById(u.tenantId).orElseThrow();
        return userView(u, t);
    }

    private Map<String, Object> userView(AppUser u, Tenant t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.id);
        m.put("email", u.email);
        m.put("displayName", u.displayName);
        m.put("role", u.role);
        Map<String, Object> tm = new LinkedHashMap<>();
        tm.put("id", t.id);
        tm.put("publicId", t.publicId);
        tm.put("name", t.name);
        tm.put("type", t.type);
        tm.put("currency", t.currency);
        tm.put("settings", t.settings);
        m.put("tenant", tm);
        return m;
    }
}
