package com.carpip.auth;

import com.carpip.common.ApiException;

import java.util.UUID;

public final class TenantContext {
    private static final ThreadLocal<Principal> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void set(Principal p) {
        CURRENT.set(p);
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static Principal get() {
        return CURRENT.get();
    }

    public static Principal require() {
        Principal p = CURRENT.get();
        if (p == null) {
            throw ApiException.unauthorized("authentication required");
        }
        return p;
    }

    public static UUID tenantId() {
        return require().tenantId();
    }

    public static Principal requireRole(String... roles) {
        Principal p = require();
        for (String r : roles) {
            if (r.equals(p.role())) {
                return p;
            }
        }
        throw ApiException.forbidden("role " + p.role() + " may not access this resource");
    }

    public static Principal requireUser() {
        Principal p = require();
        if (!"USER".equals(p.kind())) {
            throw ApiException.forbidden("interactive user session required");
        }
        return p;
    }
}
