package com.carpip.auth;

import java.util.Set;
import java.util.UUID;

/**
 * Authenticated caller. tenantId ALWAYS comes from here (JWT / API key), never from request bodies.
 * role is the tenant type (ADMIN | RETAILER | WHOLESALER); kind is USER or API_KEY.
 */
public record Principal(UUID userId, UUID tenantId, String role, String kind, Set<String> scopes, String jti) {
    public boolean isAdmin() {
        return "ADMIN".equals(role);
    }

    public boolean isRetailer() {
        return "RETAILER".equals(role);
    }

    public boolean isWholesaler() {
        return "WHOLESALER".equals(role);
    }

    public boolean hasScope(String s) {
        return scopes != null && scopes.contains(s);
    }
}
