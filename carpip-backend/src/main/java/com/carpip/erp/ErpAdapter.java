package com.carpip.erp;

import com.carpip.domain.IntegrationConnection;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

/**
 * Pluggable connector contract (paper: ErpAdapter in com.carpip.erp). Path A adapters speak a vendor
 * dialect (Shopify, Zoho); Path B adapter speaks CARPIP's open REST + signed-webhook contract.
 */
public interface ErpAdapter {
    /** SHOPIFY | CUSTOM_REST | ZOHO */
    String type();

    Map<String, Object> testConnection(IntegrationConnection c);

    /** Pull-based synchronisation (catalog, stock, missed orders / PO status). Push-only adapters just assess freshness. */
    SyncStats sync(IntegrationConnection c);

    /** Verify authenticity of an inbound webhook (signature over RAW bytes, timestamp window handled by caller). */
    boolean verifyWebhook(IntegrationConnection c, Map<String, String> headers, byte[] body);

    /** Event id used for replay protection. */
    String eventId(Map<String, String> headers, JsonNode body);

    /** Event timestamp (epoch seconds) when the scheme signs one, else null. */
    Long eventTimestamp(Map<String, String> headers);

    /** Retail adapters: translate a webhook into canonical events. Supplier adapters: return empty (handled by SupplierEventService). */
    List<CanonicalEvent> parseWebhook(IntegrationConnection c, Map<String, String> headers, JsonNode body);

    /** Execute a durable writeback (SUBMIT_PO, CANCEL_PO, PUSH_INCOMING, ADJUST_STOCK). Throws on failure (retried). */
    Map<String, Object> writeback(IntegrationConnection c, String kind, Map<String, Object> view);

    record SyncStats(int products, int levels, int orders, int offers, int poUpdates, String note) {
        public static SyncStats none(String note) {
            return new SyncStats(0, 0, 0, 0, 0, note);
        }
    }

    /** kind = SALE (sales.events) | INVENTORY (inventory.updates) | RESYNC (flag) */
    record CanonicalEvent(String kind, String eventType, String key, Map<String, Object> payload, java.time.Instant occurredAt) {
    }
}
