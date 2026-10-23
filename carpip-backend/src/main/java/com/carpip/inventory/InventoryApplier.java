package com.carpip.inventory;

import com.carpip.domain.Product;
import com.carpip.domain.Repos;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Single transactional write path for stock levels. Idempotent in two ways:
 *  - optional (consumerGroup,eventId) dedupe row in the same transaction (exactly-once effect)
 *  - ABSOLUTE updates carry a source version (the POS' updated_at); anything not strictly newer is ignored,
 *    which makes out-of-order delivery, replays and echo loops harmless.
 */
@Service
public class InventoryApplier {
    public enum Outcome { APPLIED, STALE, DUPLICATE }

    public record Result(Outcome outcome, int before, int after, UUID productId) {
    }

    private final Repos.ProductRepo products;
    private final JdbcTemplate jdbc;

    public InventoryApplier(Repos.ProductRepo products, JdbcTemplate jdbc) {
        this.products = products;
        this.jdbc = jdbc;
    }

    @Transactional
    public Result apply(UUID tenantId, UUID productId, String mode, int qty, Instant sourceVersion, String reason,
                        String reference, String dedupeGroup, String eventId) {
        if (dedupeGroup != null && eventId != null) {
            int n = jdbc.update("INSERT INTO processed_event(consumer_group, event_id) VALUES (?,?) ON CONFLICT DO NOTHING", dedupeGroup, eventId);
            if (n == 0) {
                return new Result(Outcome.DUPLICATE, 0, 0, productId);
            }
        }
        Product p = products.findById(productId).orElseThrow(() -> new IllegalArgumentException("unknown product " + productId));
        if (!p.tenantId.equals(tenantId)) {
            throw new IllegalArgumentException("tenant mismatch for product " + productId);
        }
        int before = p.currentStock;
        int after;
        if ("ABSOLUTE".equals(mode)) {
            if (sourceVersion != null && p.stockSourceVersion != null && !sourceVersion.isAfter(p.stockSourceVersion)) {
                record(p, mode, 0, before, before, "STALE_IGNORED", reference, eventId, sourceVersion);
                return new Result(Outcome.STALE, before, before, productId);
            }
            after = qty;
        } else if ("DELTA".equals(mode)) {
            after = before + qty;
        } else {
            throw new IllegalArgumentException("unknown mode " + mode);
        }
        if (sourceVersion != null && (p.stockSourceVersion == null || sourceVersion.isAfter(p.stockSourceVersion))) {
            p.stockSourceVersion = sourceVersion;
        }
        p.currentStock = after;
        p.updatedAt = Instant.now();
        products.saveAndFlush(p);
        record(p, mode, after - before, before, after, reason, reference, eventId, sourceVersion);
        return new Result(Outcome.APPLIED, before, after, productId);
    }

    private void record(Product p, String mode, int delta, int before, int after, String reason, String ref, String eventId, Instant sv) {
        jdbc.update("INSERT INTO stock_movement(tenant_id, product_id, mode, delta, qty_before, qty_after, reason, reference, event_id, source_version) VALUES (?,?,?,?,?,?,?,?,?,?)",
                p.tenantId, p.id, mode, delta, before, after, reason, ref, eventId, sv == null ? null : java.sql.Timestamp.from(sv));
    }
}
