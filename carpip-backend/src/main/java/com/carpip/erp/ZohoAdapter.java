package com.carpip.erp;

import com.carpip.common.Json;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.carpip.procurement.PurchaseOrderService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Path A – Zoho Inventory style ERP adapter (OAuth2 refresh-token flow, organization-scoped REST).
 * Pull-based: items (catalog, stock, price) and sales-order status are polled by ErpSyncService.
 * Custom item attributes (GTIN, MOQ, pack size, lead time, reliability, expiry, tiers) travel in custom_field_hash.
 */
@Component
public class ZohoAdapter implements ErpAdapter {
    private static final Logger log = LoggerFactory.getLogger(ZohoAdapter.class);
    private final ConnectionService conns;
    private final Repos.ConnectionRepo connRepo;
    private final Repos.TenantRepo tenants;
    private final SupplierCatalogService catalog;
    private final PurchaseOrderService poService;
    private final Repos.PurchaseOrderRepo pos;
    private final JdbcTemplate jdbc;

    public ZohoAdapter(ConnectionService conns, Repos.ConnectionRepo connRepo, Repos.TenantRepo tenants, SupplierCatalogService catalog,
                       PurchaseOrderService poService, Repos.PurchaseOrderRepo pos, JdbcTemplate jdbc) {
        this.conns = conns;
        this.connRepo = connRepo;
        this.tenants = tenants;
        this.catalog = catalog;
        this.poService = poService;
        this.pos = pos;
        this.jdbc = jdbc;
    }

    @Override
    public String type() {
        return "ZOHO";
    }

    // ---------------------------------------------------------------- OAuth
    private String accessToken(IntegrationConnection c, boolean force) {
        Object tok = c.config.get("accessToken");
        Object exp = c.config.get("accessTokenExpiresAt");
        if (!force && tok != null && exp instanceof Number n && n.longValue() > Instant.now().getEpochSecond() + 60) {
            return tok.toString();
        }
        Map<String, Object> cr = conns.credentials(c);
        String url = c.baseUrl + "/oauth/v2/token?refresh_token=" + enc(cr.get("refreshToken")) + "&client_id=" + enc(cr.get("clientId"))
                + "&client_secret=" + enc(cr.get("clientSecret")) + "&grant_type=refresh_token";
        Http.Resp r = Http.post(url, Map.of(), null);
        if (!r.ok() || !r.json().hasNonNull("access_token")) {
            throw new IllegalStateException("zoho token refresh failed: HTTP " + r.status() + " " + r.body());
        }
        Map<String, Object> cfg = new HashMap<>(c.config);
        cfg.put("accessToken", r.json().get("access_token").asText());
        cfg.put("accessTokenExpiresAt", Instant.now().getEpochSecond() + r.json().path("expires_in").asLong(3600));
        c.config = cfg;
        connRepo.save(c);
        return r.json().get("access_token").asText();
    }

    private static String enc(Object o) {
        return java.net.URLEncoder.encode(String.valueOf(o), java.nio.charset.StandardCharsets.UTF_8);
    }

    private String org(IntegrationConnection c) {
        return String.valueOf(conns.credentials(c).get("orgId"));
    }

    /** Calls the API; on 401 refreshes the token once and retries. */
    private Http.Resp api(IntegrationConnection c, HttpMethod m, String path, String body) {
        String sep = path.contains("?") ? "&" : "?";
        String url = c.baseUrl + path + sep + "organization_id=" + org(c);
        for (int attempt = 0; attempt < 2; attempt++) {
            Map<String, String> h = new LinkedHashMap<>();
            h.put("Authorization", "Zoho-oauthtoken " + accessToken(c, attempt > 0));
            Http.Resp r = Http.call(m, url, h, body);
            if (r.status() != 401) {
                return r;
            }
        }
        return Http.call(m, url, Map.of("Authorization", "Zoho-oauthtoken " + accessToken(c, true)), body);
    }

    @Override
    public Map<String, Object> testConnection(IntegrationConnection c) {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            Http.Resp r = api(c, HttpMethod.GET, "/inventory/v1/organizations", null);
            out.put("ok", r.ok());
            out.put("status", r.status());
            if (r.ok()) {
                out.put("organizations", r.json().path("organizations"));
            } else {
                out.put("detail", r.body());
            }
        } catch (Exception e) {
            out.put("ok", false);
            out.put("detail", e.getMessage());
        }
        return out;
    }

    // ---------------------------------------------------------------- polling sync
    @Override
    public SyncStats sync(IntegrationConnection c) {
        List<JsonNode> items = new ArrayList<>();
        int page = 1;
        boolean more = true;
        while (more && page < 50) {
            Http.Resp r = api(c, HttpMethod.GET, "/inventory/v1/items?page=" + page + "&per_page=200", null);
            if (!r.ok()) {
                throw new IllegalStateException("zoho items -> HTTP " + r.status());
            }
            for (JsonNode it : r.json().path("items")) {
                items.add(toCanonical(it));
            }
            more = r.json().path("page_context").path("has_more_page").asBoolean(false);
            page++;
        }
        SupplierCatalogService.Result res = catalog.upsert(c.tenantId, items, true);
        int updates = pollPurchaseOrders(c);
        c.lastSyncAt = Instant.now();
        c.health = "OK";
        c.lastError = res.rejected().isEmpty() ? null : res.rejected().size() + " catalog rows rejected";
        connRepo.save(c);
        return new SyncStats(0, 0, 0, res.upserted(), updates, null);
    }

    private JsonNode toCanonical(JsonNode z) {
        JsonNode cf = z.path("custom_field_hash");
        ObjectNode n = Json.M.createObjectNode();
        n.put("supplierSku", z.path("sku").asText());
        n.put("name", z.path("name").asText());
        n.put("gtin", cf.path("cf_gtin").asText(null));
        n.put("category", z.path("category_name").asText(null));
        n.put("uom", z.path("unit").asText("EA"));
        n.put("listPrice", z.path("rate").asText("0"));
        n.put("availableQty", z.path("available_stock").asInt(0));
        n.put("moq", cf.path("cf_moq").asInt(1));
        n.put("packSize", cf.path("cf_pack_size").asInt(1));
        n.put("leadTimeDays", cf.path("cf_lead_time_days").asInt(3));
        n.put("shippingReliability", cf.path("cf_reliability").asText("0.9"));
        n.put("maxDiscountPct", cf.path("cf_max_discount").asText("0.2"));
        if (cf.hasNonNull("cf_nearest_expiry")) {
            n.put("nearestExpiry", cf.get("cf_nearest_expiry").asText());
        }
        if (cf.hasNonNull("cf_shelf_life_days")) {
            n.put("shelfLifeDays", cf.get("cf_shelf_life_days").asInt());
        }
        try {
            n.set("priceTiers", Json.read(cf.path("cf_price_tiers").asText("[]")));
        } catch (Exception e) {
            n.set("priceTiers", Json.M.createArrayNode());
        }
        return n;
    }

    /** Maps Zoho sales-order status onto the same lifecycle events Path B pushes, applying every implied stage in order. */
    private int pollPurchaseOrders(IntegrationConnection c) {
        List<UUID> ids = jdbc.queryForList("SELECT id FROM purchase_order WHERE wholesaler_tenant_id=? AND external_ref IS NOT NULL " +
                "AND status IN ('SUBMITTED','CONFIRMED','PARTIALLY_CONFIRMED','PARTIALLY_SHIPPED','SHIPPED')", UUID.class, c.tenantId);
        int updates = 0;
        for (UUID id : ids) {
            PurchaseOrder po = pos.findById(id).orElse(null);
            if (po == null) {
                continue;
            }
            Http.Resp r = api(c, HttpMethod.GET, "/inventory/v1/salesorders/" + po.externalRef, null);
            if (!r.ok()) {
                log.warn("zoho salesorder {} -> HTTP {}", po.externalRef, r.status());
                continue;
            }
            JsonNode so = r.json().path("salesorder");
            String status = so.path("status").asText("");
            JsonNode cf = so.path("custom_field_hash");
            String eta = so.path("delivery_date").asText(null);
            int confirmed = cf.path("cf_confirmed_qty").asInt(0);
            int shipped = cf.path("cf_shipped_qty").asInt(0);
            int delivered = cf.path("cf_delivered_qty").asInt(0);
            List<String[]> events = new ArrayList<>();
            if (status.equals("void")) {
                String reason = cf.path("cf_reason").asText("voided in ERP");
                events.add(new String[]{po.status.equals("SUBMITTED") ? "sales_order.rejected" : "sales_order.cancelled", reason});
            } else {
                if (List.of("confirmed", "partially_shipped", "shipped", "fulfilled").contains(status)) {
                    events.add(new String[]{"sales_order.confirmed", null});
                }
                if (shipped > po.qtyShipped && List.of("partially_shipped", "shipped", "fulfilled").contains(status)) {
                    events.add(new String[]{"shipment.created", null});
                }
                if (status.equals("fulfilled")) {
                    events.add(new String[]{"sales_order.delivered", null});
                }
            }
            for (String[] ev : events) {
                ObjectNode body = Json.M.createObjectNode();
                body.put("po_number", po.poNumber);
                body.put("eta", eta);
                body.put("reason", ev[1]);
                ArrayNode lines = body.putArray("lines");
                ObjectNode line = lines.addObject();
                line.put("confirmed_qty", confirmed);
                line.put("shipped_qty", Math.max(0, shipped - po.qtyShipped));
                line.put("delivered_qty", delivered);
                String res = poService.onSupplierEvent(c.tenantId, ev[0], body);
                if (res.startsWith("APPLIED")) {
                    updates++;
                }
                po = pos.findById(id).orElse(po);
            }
        }
        return updates;
    }

    // ---------------------------------------------------------------- webhooks (pull-only vendor)
    @Override
    public boolean verifyWebhook(IntegrationConnection c, Map<String, String> headers, byte[] body) {
        return false;
    }

    @Override
    public String eventId(Map<String, String> headers, JsonNode body) {
        return null;
    }

    @Override
    public Long eventTimestamp(Map<String, String> headers) {
        return null;
    }

    @Override
    public List<CanonicalEvent> parseWebhook(IntegrationConnection c, Map<String, String> headers, JsonNode body) {
        return List.of();
    }

    // ---------------------------------------------------------------- writebacks
    @Override
    public Map<String, Object> writeback(IntegrationConnection c, String kind, Map<String, Object> view) {
        switch (kind) {
            case "SUBMIT_PO" -> {
                ObjectNode body = Json.M.createObjectNode();
                body.put("customer_name", (String) view.get("retailerName"));
                body.put("reference_number", (String) view.get("poNumber"));
                body.put("date", LocalDate.now().toString());
                if (view.get("expectedDelivery") != null) {
                    body.put("delivery_date", view.get("expectedDelivery").toString());
                }
                body.put("notes", "Autonomous purchase order generated by CARPIP");
                ObjectNode cf = body.putObject("custom_field_hash");
                cf.put("cf_carpip_tenant", (String) view.get("retailerPublicId"));
                ArrayNode li = body.putArray("line_items");
                ObjectNode l = li.addObject();
                l.put("sku", (String) view.get("supplierSku"));
                l.put("name", (String) view.get("name"));
                l.put("quantity", ((Number) view.get("quantity")).intValue());
                l.put("rate", view.get("unitPrice").toString());
                Http.Resp r = api(c, HttpMethod.POST, "/inventory/v1/salesorders", body.toString());
                if (!r.ok()) {
                    throw new IllegalStateException("zoho salesorders -> HTTP " + r.status() + " " + (r.body() == null ? "" : r.body()));
                }
                JsonNode so = r.json().path("salesorder");
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("salesOrderId", so.path("salesorder_id").asText());
                out.put("status", so.path("status").asText());
                return out;
            }
            case "CANCEL_PO" -> {
                String id = String.valueOf(view.get("externalRef"));
                Http.Resp r = api(c, HttpMethod.POST, "/inventory/v1/salesorders/" + id + "/status/void", "{}");
                if (!r.ok()) {
                    throw new IllegalStateException("zoho void -> HTTP " + r.status());
                }
                return Map.of("status", "void");
            }
            default -> throw new UnsupportedOperationException("zoho adapter does not support " + kind);
        }
    }
}
