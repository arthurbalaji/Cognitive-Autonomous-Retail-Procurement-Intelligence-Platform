package com.carpip.controller;

import com.carpip.entity.Tenant;
import com.carpip.entity.User;
import com.carpip.integration.ErpAdapter;
import com.carpip.repository.TenantRepository;
import com.carpip.service.ErpSyncService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/integrations")
public class IntegrationController {

    private final List<ErpAdapter> adapters;
    private final TenantRepository tenantRepository;
    private final ErpSyncService erpSyncService;

    public IntegrationController(List<ErpAdapter> adapters,
                                  TenantRepository tenantRepository,
                                  ErpSyncService erpSyncService) {
        this.adapters = adapters;
        this.tenantRepository = tenantRepository;
        this.erpSyncService = erpSyncService;
    }

    /**
     * Test an ERP connection without saving credentials.
     */
    @PostMapping("/test")
    public ResponseEntity<Map<String, Object>> testConnection(@RequestBody ConnectionRequest request,
                                                                @AuthenticationPrincipal User user) {
        ErpAdapter adapter = findAdapter(request.provider());

        boolean success = adapter.connect(request.credentials());

        return ResponseEntity.ok(Map.of(
                "success", success,
                "provider", request.provider(),
                "message", success ? "Connection successful" : "Connection failed — check credentials"
        ));
    }

    /**
     * Connect to an ERP provider and persist credentials to the tenant's profile.
     */
    @PostMapping("/connect")
    public ResponseEntity<Map<String, Object>> connect(@RequestBody ConnectionRequest request,
                                                         @AuthenticationPrincipal User user) {
        ErpAdapter adapter = findAdapter(request.provider());

        boolean connected = adapter.connect(request.credentials());
        if (!connected) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "Failed to connect to " + request.provider() + ". Please verify your credentials."
            ));
        }

        // Persist credentials and provider to the tenant
        Tenant tenant = user.getTenant();
        Map<String, String> existingKeys = tenant.getApiKeys();
        if (existingKeys == null) {
            existingKeys = new HashMap<>();
        }
        existingKeys.putAll(request.credentials());
        tenant.setApiKeys(existingKeys);
        tenant.setErpProvider(request.provider());
        tenantRepository.save(tenant);

        // Trigger initial inventory sync
        try {
            erpSyncService.syncTenant(tenant);
        } catch (Exception e) {
            // Non-fatal: connection succeeded even if initial sync has issues
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "provider", request.provider(),
                "message", "Connected and syncing with " + request.provider()
        ));
    }

    /**
     * Get the current integration connection status for the authenticated tenant.
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus(@AuthenticationPrincipal User user) {
        Tenant tenant = user.getTenant();

        Map<String, Object> status = new HashMap<>();
        status.put("connected", tenant.getErpProvider() != null && !tenant.getErpProvider().isEmpty());
        status.put("provider", tenant.getErpProvider());
        status.put("tenantName", tenant.getName());
        status.put("tenantType", tenant.getType().name());

        // Mask sensitive credential values
        if (tenant.getApiKeys() != null && !tenant.getApiKeys().isEmpty()) {
            Map<String, String> maskedKeys = new HashMap<>();
            tenant.getApiKeys().forEach((key, value) -> {
                if (value != null && value.length() > 8) {
                    maskedKeys.put(key, value.substring(0, 4) + "****" + value.substring(value.length() - 4));
                } else {
                    maskedKeys.put(key, "****");
                }
            });
            status.put("credentials", maskedKeys);
        } else {
            status.put("credentials", Map.of());
        }

        return ResponseEntity.ok(status);
    }

    /**
     * Trigger a manual ERP sync for the authenticated tenant.
     */
    @PostMapping("/sync")
    public ResponseEntity<Map<String, Object>> triggerSync(@AuthenticationPrincipal User user) {
        Tenant tenant = user.getTenant();

        if (tenant.getErpProvider() == null || tenant.getErpProvider().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "No ERP provider connected. Please connect a system first."
            ));
        }

        try {
            Map<String, Object> syncResult = erpSyncService.syncTenant(tenant);
            syncResult.put("success", true);
            syncResult.put("message", "Sync completed successfully");
            return ResponseEntity.ok(syncResult);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "message", "Sync failed: " + e.getMessage()
            ));
        }
    }

    /**
     * Disconnect the current ERP provider and remove stored credentials.
     */
    @DeleteMapping("/disconnect")
    public ResponseEntity<Map<String, Object>> disconnect(@AuthenticationPrincipal User user) {
        Tenant tenant = user.getTenant();
        String previousProvider = tenant.getErpProvider();

        tenant.setErpProvider(null);
        tenant.setApiKeys(new HashMap<>());
        tenantRepository.save(tenant);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Disconnected from " + (previousProvider != null ? previousProvider : "provider")
        ));
    }

    // ─── Helper ───────────────────────────────────────────────

    private ErpAdapter findAdapter(String provider) {
        return adapters.stream()
                .filter(a -> a.getProviderName().equals(provider))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("Unknown provider: " + provider +
                        ". Supported: " + adapters.stream().map(ErpAdapter::getProviderName).toList()));
    }

    public record ConnectionRequest(String provider, Map<String, String> credentials) {}
}
