package com.carpip.erp;

import com.carpip.common.Hmac;
import com.carpip.common.Json;
import com.carpip.common.Money;
import com.carpip.config.AppProps;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Product;
import com.carpip.domain.Repos;
import com.carpip.inventory.InventoryService;
import com.carpip.inventory.SalesService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Path A – Shopify POS adapter. Speaks the Shopify Admin REST API (2024-01):
 * shop.json, products.json (Link-header pagination), inventory_items/levels, orders.json, webhooks.json.
 * Webhooks are authenticated with X-Shopify-Hmac-Sha256 = base64(HMAC_SHA256(secret, rawBody)).
 */
@Component
public class ShopifyAdapter implements ErpAdapter {
    private static final Logger log = LoggerFactory.getLogger(ShopifyAdapter.class);
    private static final String API = "/admin/api/2024-01";
    private static final Pattern NEXT = Pattern.compile("<([^>]+)>;\\s*rel=\"next\"");
    static final List<String> TOPICS = List.of("orders/create", "inventory_levels/update", "refunds/create", "products/update");

    private final ConnectionService conns;
    private final ProductSyncService productSync;
    private final InventoryService inventory;
    private final SalesService sales;
    private final Repos.ProductRepo products;
    private final Repos.ConnectionRepo connRepo;
    private final Repos.TenantRepo tenants;
    private final AppProps props;

    public ShopifyAdapter(ConnectionService conns, ProductSyncService productSync, InventoryService inventory, SalesService sales,
                          Repos.ProductRepo products, Repos.ConnectionRepo connRepo, Repos.TenantRepo tenants, AppProps props) {
        this.conns = conns;
        this.productSync = productSync;
        this.inventory = inventory;
        this.sales = sales;
        this.products = products;
        this.connRepo = connRepo;
        this.tenants = tenants;
        this.props = props;
    }

    @Override
    public String type() {
        return "SHOPIFY";
    }

    // --------------------------------------------------------------------- helpers
    private Map<String, String> hdr(IntegrationConnection c) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("X-Shopify-Access-Token", String.valueOf(conns.credentials(c).get("accessToken")));
        h.put("Accept", "application/json");
        return h;
    }

    /** GET with 429 handling (honours Retry-After, max 3 attempts). */
    private Http.Resp get(IntegrationConnection c, String urlOrPath) {
        String url = urlOrPath.startsWith("http") ? urlOrPath : c.baseUrl + urlOrPath;
        for (int attempt = 0; attempt < 3; attempt++) {
            Http.Resp r = Http.get(url, hdr(c));
            if (r.status() != 429) {
                return r;
            }
            long wait = 1000;
            try {
                wait = (long) (Double.parseDouble(r.header("Retry-After")) * 1000);
            } catch (Exception ignored) {
                // default wait
            }
            try {
                Thread.sleep(Math.min(wait, 5000));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        return Http.get(url, hdr(c));
    }

    static Instant ts(String s) {
        if (s == null || s.isBlank()) {
            return Instant.now();
        }
        try {
            return OffsetDateTime.parse(s).toInstant();
        } catch (Exception e) {
            return Instant.parse(s);
        }
    }

    // --------------------------------------------------------------------- connection
    @Override
    public Map<String, Object> testConnection(IntegrationConnection c) {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            Http.Resp r = get(c, API + "/shop.json");
            out.put("ok", r.ok());
            out.put("status", r.status());
            if (r.ok()) {
                out.put("shop", r.json().path("shop").path("name").asText());
                out.put("domain", r.json().path("shop").path("domain").asText());
            } else {
                out.put("detail", r.body());
            }
        } catch (Exception e) {
            out.put("ok", false);
            out.put("detail", e.getMessage());
        }
        return out;
    }

    /** Registers the webhook subscriptions that point at CARPIP (idempotent). */
    public Map<String, Object> registerWebhooks(IntegrationConnection c) {
        String tenantPublicId = tenants.findById(c.tenantId).orElseThrow().publicId;
        String address = props.publicWebhookBase() + "/api/erp/webhook/" + tenantPublicId;
        Http.Resp existing = get(c, API + "/webhooks.json");
        List<String> have = new ArrayList<>();
        if (existing.ok()) {
            for (JsonNode w : existing.json().path("webhooks")) {
                if (address.equals(w.path("address").asText())) {
                    have.add(w.path("topic").asText());
                }
            }
        }
        List<String> created = new ArrayList<>();
        for (String topic : TOPICS) {
            if (have.contains(topic)) {
                continue;
            }
            ObjectNode body = Json.M.createObjectNode();
            ObjectNode w = body.putObject("webhook");
            w.put("topic", topic);
            w.put("address", address);
            w.put("format", "json");
            Http.Resp r = Http.post(c.baseUrl + API + "/webhooks.json", hdr(c), body.toString());
            if (r.ok()) {
                created.add(topic);
            } else {
                log.warn("webhook registration {} failed: {} {}", topic, r.status(), r.body());
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("address", address);
        out.put("existing", have);
        out.put("created", created);
        return out;
    }

    // --------------------------------------------------------------------- sync (polling path / reconciliation)
    @Override
    public SyncStats sync(IntegrationConnection c) {
        int productsSeen = 0;
        int levelsApplied = 0;
        int ordersSeen = 0;
        List<Product> synced = new ArrayList<>();
        String url = API + "/products.json?limit=100";
        int pages = 0;
        while (url != null && pages++ < 100) {
            Http.Resp r = get(c, url);
            if (!r.ok()) {
                throw new IllegalStateException("products.json -> HTTP " + r.status());
            }
            for (JsonNode p : r.json().path("products")) {
                for (JsonNode v : p.path("variants")) {
                    Optional<Product> up = productSync.upsertShopifyVariant(c.tenantId, p, v);
                    up.ifPresent(synced::add);
                    productsSeen++;
                }
            }
            url = nextLink(r.header("Link"));
        }
        if (!synced.isEmpty()) {
            fillCosts(c, synced);
            levelsApplied = applyLevels(c, synced);
        }
        ordersSeen = pollOrders(c);
        if (c.syncCursor != null) {
            c.syncCursor.remove("needSync");
        }
        c.lastSyncAt = Instant.now();
        c.health = "OK";
        c.lastError = null;
        connRepo.save(c);
        return new SyncStats(productsSeen, levelsApplied, ordersSeen, 0, 0, null);
    }

    private static String nextLink(String link) {
        if (link == null) {
            return null;
        }
        Matcher m = NEXT.matcher(link);
        return m.find() ? m.group(1) : null;
    }

    private void fillCosts(IntegrationConnection c, List<Product> synced) {
        for (int i = 0; i < synced.size(); i += 100) {
            List<Product> chunk = synced.subList(i, Math.min(i + 100, synced.size()));
            String ids = String.join(",", chunk.stream().map(p -> String.valueOf(p.externalIds.get("inventory_item_id"))).toList());
            Http.Resp r = get(c, API + "/inventory_items.json?ids=" + ids + "&limit=250");
            if (!r.ok()) {
                continue;
            }
            Map<String, Product> byItem = new HashMap<>();
            chunk.forEach(p -> byItem.put(String.valueOf(p.externalIds.get("inventory_item_id")), p));
            for (JsonNode it : r.json().path("inventory_items")) {
                Product p = byItem.get(it.path("id").asText());
                if (p != null && it.hasNonNull("cost")) {
                    productSync.setCost(p.id, Money.bd(it.get("cost").asText()));
                }
            }
        }
    }

    private int applyLevels(IntegrationConnection c, List<Product> synced) {
        int applied = 0;
        for (int i = 0; i < synced.size(); i += 100) {
            List<Product> chunk = synced.subList(i, Math.min(i + 100, synced.size()));
            Map<String, Product> byItem = new HashMap<>();
            chunk.forEach(p -> byItem.put(String.valueOf(p.externalIds.get("inventory_item_id")), p));
            Http.Resp r = get(c, API + "/inventory_levels.json?inventory_item_ids=" + String.join(",", byItem.keySet()) + "&limit=250");
            if (!r.ok()) {
                continue;
            }
            for (JsonNode lv : r.json().path("inventory_levels")) {
                Product p = byItem.get(lv.path("inventory_item_id").asText());
                if (p == null || lv.path("available").isNull()) {
                    continue;
                }
                var res = inventory.apply(c.tenantId, p.id, "ABSOLUTE", lv.get("available").asInt(), ts(lv.path("updated_at").asText(null)),
                        "SYNC", "shopify-poll", null, null);
                if (res.outcome() == com.carpip.inventory.InventoryApplier.Outcome.APPLIED) {
                    applied++;
                }
            }
        }
        return applied;
    }

    private int pollOrders(IntegrationConnection c) {
        String cursor = c.syncCursor == null ? null : (String) c.syncCursor.get("ordersUpdatedAtMin");
        String url = API + "/orders.json?status=any&limit=250" + (cursor == null ? "" : "&updated_at_min=" + java.net.URLEncoder.encode(cursor, java.nio.charset.StandardCharsets.UTF_8));
        Http.Resp r = get(c, url);
        if (!r.ok()) {
            return 0;
        }
        int n = 0;
        String maxUpdated = cursor;
        for (JsonNode o : r.json().path("orders")) {
            String upd = o.path("updated_at").asText(null);
            if (upd != null && (maxUpdated == null || ts(upd).isAfter(ts(maxUpdated)))) {
                maxUpdated = upd;
            }
            for (JsonNode l : o.path("line_items")) {
                Optional<Product> p = products.findByTenantIdAndSku(c.tenantId, l.path("sku").asText(""));
                if (p.isEmpty()) {
                    continue;
                }
                boolean fresh = sales.record(c.tenantId, p.get().id, "pos-shopify", o.path("id").asText(), l.path("id").asText(), l.path("quantity").asInt(),
                        l.hasNonNull("price") ? Money.bd(l.get("price").asText()) : null, false, ts(o.path("created_at").asText(null)), null, null);
                if (fresh) {
                    n++;
                }
            }
        }
        if (c.syncCursor == null) {
            c.syncCursor = new HashMap<>();
        }
        if (maxUpdated != null) {
            c.syncCursor.put("ordersUpdatedAtMin", maxUpdated);
        }
        return n;
    }

    // --------------------------------------------------------------------- webhooks
    @Override
    public boolean verifyWebhook(IntegrationConnection c, Map<String, String> headers, byte[] body) {
        String sig = headers.get("x-shopify-hmac-sha256");
        if (sig == null) {
            return false;
        }
        for (String secret : conns.acceptedSecrets(c)) {
            if (Hmac.constantEq(sig, Hmac.shopify(secret, body))) {
                return true;
            }
        }
        return false;
    }

    @Override
    public String eventId(Map<String, String> headers, JsonNode body) {
        String id = headers.get("x-shopify-webhook-id");
        return id != null ? id : Hmac.sha256Hex(body.toString());
    }

    @Override
    public Long eventTimestamp(Map<String, String> headers) {
        String t = headers.get("x-shopify-triggered-at");
        if (t == null) {
            return null;
        }
        try {
            return ts(t).getEpochSecond();
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public List<CanonicalEvent> parseWebhook(IntegrationConnection c, Map<String, String> headers, JsonNode body) {
        String topic = headers.getOrDefault("x-shopify-topic", "");
        List<CanonicalEvent> out = new ArrayList<>();
        switch (topic) {
            case "orders/create" -> {
                Instant at = ts(body.path("created_at").asText(null));
                for (JsonNode l : body.path("line_items")) {
                    Optional<Product> p = products.findByTenantIdAndSku(c.tenantId, l.path("sku").asText(""));
                    if (p.isEmpty()) {
                        out.add(new CanonicalEvent("RESYNC", "unmapped.sku", null, Map.of("sku", l.path("sku").asText("")), at));
                        continue;
                    }
                    out.add(sale(c, p.get(), body.path("id").asText(), l.path("id").asText(), l.path("quantity").asInt(),
                            l.hasNonNull("price") ? l.get("price").asText() : null, false, at));
                }
            }
            case "refunds/create" -> {
                Instant at = ts(body.path("created_at").asText(null));
                for (JsonNode rl : body.path("refund_line_items")) {
                    JsonNode li = rl.path("line_item");
                    Optional<Product> p = products.findByTenantIdAndSku(c.tenantId, li.path("sku").asText(""));
                    if (p.isEmpty()) {
                        continue;
                    }
                    out.add(sale(c, p.get(), "refund:" + body.path("id").asText(), rl.path("id").asText(), rl.path("quantity").asInt(),
                            li.hasNonNull("price") ? li.get("price").asText() : null, true, at));
                }
            }
            case "inventory_levels/update" -> {
                Optional<Product> p = products.findByInventoryItemId(c.tenantId, body.path("inventory_item_id").asText());
                if (p.isEmpty()) {
                    out.add(new CanonicalEvent("RESYNC", "unmapped.inventory_item", null, Map.of("inventory_item_id", body.path("inventory_item_id").asText()), Instant.now()));
                } else if (!body.path("available").isNull()) {
                    Map<String, Object> pl = new LinkedHashMap<>();
                    pl.put("productId", p.get().id);
                    pl.put("sku", p.get().sku);
                    pl.put("mode", "ABSOLUTE");
                    pl.put("quantity", body.path("available").asInt());
                    Instant sv = ts(body.path("updated_at").asText(null));
                    pl.put("sourceVersion", sv);
                    pl.put("reason", "WEBHOOK");
                    pl.put("reference", body.path("location_id").asText(null));
                    out.add(new CanonicalEvent("INVENTORY", "inventory.set", c.tenantId + ":" + p.get().id, pl, sv));
                }
            }
            case "products/update" -> out.add(new CanonicalEvent("RESYNC", "products.update", null, Map.of(), Instant.now()));
            default -> log.debug("ignoring shopify topic {}", topic);
        }
        return out;
    }

    private CanonicalEvent sale(IntegrationConnection c, Product p, String orderId, String lineId, int qty, String price, boolean refund, Instant at) {
        Map<String, Object> pl = new LinkedHashMap<>();
        pl.put("productId", p.id);
        pl.put("sku", p.sku);
        pl.put("gtin", p.gtin);
        pl.put("externalOrderId", orderId);
        pl.put("externalLineId", lineId);
        pl.put("quantity", qty);
        pl.put("unitPrice", price);
        pl.put("currency", "INR");
        pl.put("isRefund", refund);
        pl.put("occurredAt", at);
        return new CanonicalEvent("SALE", "sale.recorded", c.tenantId + ":" + p.id, pl, at);
    }

    // --------------------------------------------------------------------- writebacks
    @Override
    public Map<String, Object> writeback(IntegrationConnection c, String kind, Map<String, Object> view) {
        switch (kind) {
            case "PUSH_INCOMING" -> {
                ObjectNode body = Json.M.createObjectNode();
                ObjectNode po = body.putObject("purchase_order");
                po.put("po_number", (String) view.get("poNumber"));
                po.put("supplier", (String) view.get("supplierName"));
                po.put("status", (String) view.get("status"));
                po.put("eta", view.get("eta") == null ? null : view.get("eta").toString());
                po.put("currency", "INR");
                ArrayNode li = po.putArray("line_items");
                ObjectNode line = li.addObject();
                line.put("sku", (String) view.get("sku"));
                line.put("title", (String) view.get("name"));
                line.put("quantity_ordered", ((Number) view.get("quantityOrdered")).intValue());
                line.put("quantity_expected", ((Number) view.get("quantityExpected")).intValue());
                line.put("quantity_shipped", ((Number) view.get("quantityShipped")).intValue());
                line.put("unit_cost", view.get("unitCost") == null ? null : view.get("unitCost").toString());
                Http.Resp r = Http.post(c.baseUrl + API + "/purchase_orders.json", hdr(c), body.toString());
                if (!r.ok()) {
                    throw new IllegalStateException("purchase_orders.json -> HTTP " + r.status() + " " + abbreviate(r.body()));
                }
                return Map.of("status", r.status());
            }
            case "ADJUST_STOCK" -> {
                String locationId = locationId(c);
                ObjectNode body = Json.M.createObjectNode();
                body.put("location_id", locationId);
                body.put("inventory_item_id", String.valueOf(view.get("inventoryItemId")));
                body.put("available_adjustment", ((Number) view.get("qty")).intValue());
                Map<String, String> h = hdr(c);
                h.put("X-Carpip-Idempotency-Key", String.valueOf(view.get("idempotencyKey")));
                Http.Resp r = Http.post(c.baseUrl + API + "/inventory_levels/adjust.json", h, body.toString());
                if (!r.ok()) {
                    throw new IllegalStateException("inventory_levels/adjust.json -> HTTP " + r.status() + " " + abbreviate(r.body()));
                }
                JsonNode lv = r.json().path("inventory_level");
                java.util.UUID productId = (java.util.UUID) view.get("productId");
                // adopt the POS' authoritative absolute level (echo webhook becomes a no-op)
                inventory.apply(c.tenantId, productId, "ABSOLUTE", lv.path("available").asInt(), ts(lv.path("updated_at").asText(null)),
                        "PO_RECEIPT", String.valueOf(view.get("poNumber")), null, null);
                return Map.of("available", lv.path("available").asInt());
            }
            default -> throw new UnsupportedOperationException("shopify adapter does not support " + kind);
        }
    }

    private String locationId(IntegrationConnection c) {
        String cached = c.cfg("locationId");
        if (cached != null) {
            return cached;
        }
        Http.Resp r = get(c, API + "/locations.json");
        if (!r.ok() || !r.json().path("locations").isArray() || r.json().path("locations").isEmpty()) {
            throw new IllegalStateException("cannot resolve POS location (HTTP " + r.status() + ")");
        }
        String id = r.json().path("locations").get(0).path("id").asText();
        Map<String, Object> cfg = new HashMap<>(c.config == null ? Map.of() : c.config);
        cfg.put("locationId", id);
        c.config = cfg;
        connRepo.save(c);
        return id;
    }

    private static String abbreviate(String s) {
        return s == null ? "" : s.length() > 200 ? s.substring(0, 200) : s;
    }

    @SuppressWarnings("unused")
    private static HttpMethod unused() {
        return HttpMethod.GET;
    }
}
