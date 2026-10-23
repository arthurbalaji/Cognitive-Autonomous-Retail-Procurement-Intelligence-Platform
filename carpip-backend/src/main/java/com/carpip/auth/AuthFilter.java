package com.carpip.auth;

import com.auth0.jwt.exceptions.JWTVerificationException;
import com.carpip.common.Json;
import com.carpip.domain.Repos;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Authenticates every request: Bearer JWT for interactive users, Bearer ck_live_* API keys for
 * external systems (limited to /api/v1/**, /api/erp/sync, /graphql). Public: login, webhooks, health.
 */
@Component
@Order(10)
public class AuthFilter extends OncePerRequestFilter {
    private final JwtService jwt;
    private final ApiKeyService apiKeys;
    private final Repos.TenantRepo tenants;
    private final RateLimiter limiter;

    public AuthFilter(JwtService jwt, ApiKeyService apiKeys, Repos.TenantRepo tenants, RateLimiter limiter) {
        this.jwt = jwt;
        this.apiKeys = apiKeys;
        this.tenants = tenants;
        this.limiter = limiter;
    }

    private static boolean isPublic(String p) {
        return p.startsWith("/actuator") || p.equals("/api/auth/login") || p.startsWith("/api/erp/webhook/")
                || p.startsWith("/graphiql") || p.equals("/error") || p.equals("/favicon.ico");
    }

    private static boolean apiKeyAllowed(String p) {
        return p.startsWith("/api/v1/") || p.equals("/api/erp/sync") || p.equals("/graphql");
    }

    private static String requiredScope(String p, String method) {
        if (p.startsWith("/api/v1/cdin/")) {
            return "cdin:node";
        }
        if (p.equals("/graphql")) {
            return "graphql:read";
        }
        if (p.equals("/api/erp/sync")) {
            return "catalog:write";
        }
        if (p.equals("/api/v1/inventory") && "POST".equals(method)) {
            return "inventory:write";
        }
        if (p.equals("/api/v1/orders") && "POST".equals(method)) {
            return "orders:write";
        }
        return null;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String path = req.getRequestURI();
        if ("OPTIONS".equals(req.getMethod()) || isPublic(path)) {
            if (path.equals("/api/auth/login") && !limiter.allow("login:" + req.getRemoteAddr(), 20)) {
                fail(res, 429, "RATE_LIMITED", "too many login attempts");
                return;
            }
            if (path.startsWith("/api/erp/webhook/") && !limiter.allow("webhook:" + path, 1200)) {
                fail(res, 429, "RATE_LIMITED", "webhook rate limit exceeded");
                return;
            }
            chain.doFilter(req, res);
            return;
        }
        String auth = req.getHeader("Authorization");
        String token = null;
        if (auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7)) {
            token = auth.substring(7).trim();
        } else if (path.equals("/api/stream/events") && req.getParameter("token") != null) {
            token = req.getParameter("token"); // EventSource cannot send headers
        }
        if (token == null || token.isBlank()) {
            fail(res, 401, "UNAUTHORIZED", "missing bearer token");
            return;
        }
        Principal p;
        try {
            if (token.startsWith("ck_live_")) {
                if (!apiKeyAllowed(path)) {
                    fail(res, 403, "FORBIDDEN", "API keys may only call /api/v1/**, /api/erp/sync and /graphql");
                    return;
                }
                Optional<Principal> op = apiKeys.authenticate(token, tenants);
                if (op.isEmpty()) {
                    fail(res, 401, "UNAUTHORIZED", "invalid API key");
                    return;
                }
                p = op.get();
                String need = requiredScope(path, req.getMethod());
                if (need != null && !p.hasScope(need)) {
                    fail(res, 403, "FORBIDDEN", "API key lacks scope " + need);
                    return;
                }
                if (!limiter.allow("key:" + p.tenantId(), 600)) {
                    res.setHeader("Retry-After", "30");
                    fail(res, 429, "RATE_LIMITED", "API rate limit exceeded");
                    return;
                }
            } else {
                p = jwt.verify(token);
                if (p.jti() != null && limiter.denied(p.jti())) {
                    fail(res, 401, "UNAUTHORIZED", "token revoked");
                    return;
                }
                if (path.equals("/graphql") && !limiter.allow("gql:" + p.tenantId(), 120)) {
                    fail(res, 429, "RATE_LIMITED", "graphql rate limit exceeded");
                    return;
                }
            }
        } catch (JWTVerificationException e) {
            res.setHeader("WWW-Authenticate", "Bearer error=\"invalid_token\"");
            fail(res, 401, "UNAUTHORIZED", "invalid or expired token");
            return;
        }
        TenantContext.set(p);
        try {
            chain.doFilter(req, res);
        } finally {
            TenantContext.clear();
        }
    }

    private void fail(HttpServletResponse res, int status, String code, String detail) throws IOException {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("type", "about:blank");
        b.put("status", status);
        b.put("code", code);
        b.put("detail", detail);
        res.setStatus(status);
        res.setContentType("application/problem+json");
        res.getWriter().write(Json.write(b));
    }
}
