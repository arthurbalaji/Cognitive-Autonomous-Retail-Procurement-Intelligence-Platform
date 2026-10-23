package com.carpip.inventory;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;

/** Sales ledger + daily rollup. Daily buckets use the IST business day; storage stays UTC. */
@Service
public class SalesService {
    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final JdbcTemplate jdbc;

    public SalesService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** @return true if the sale was new (not a duplicate order/line). */
    @Transactional
    public boolean record(UUID tenantId, UUID productId, String source, String orderId, String lineId, int qty,
                          BigDecimal price, boolean refund, Instant occurredAt, String dedupeGroup, String eventId) {
        if (dedupeGroup != null && eventId != null) {
            int d = jdbc.update("INSERT INTO processed_event(consumer_group, event_id) VALUES (?,?) ON CONFLICT DO NOTHING", dedupeGroup, eventId);
            if (d == 0) {
                return false;
            }
        }
        Integer owner = jdbc.queryForObject("SELECT count(*) FROM product WHERE id=? AND tenant_id=?", Integer.class, productId, tenantId);
        if (owner == null || owner == 0) {
            throw new IllegalArgumentException("tenant mismatch for product " + productId);
        }
        int n = jdbc.update("INSERT INTO sales_event(id, tenant_id, product_id, event_id, source, external_order_id, external_line_id, quantity, unit_price, is_refund, occurred_at) " +
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (tenant_id, source, external_order_id, external_line_id) DO NOTHING",
                UUID.randomUUID(), tenantId, productId, eventId, source, orderId, lineId, qty, price, refund, Timestamp.from(occurredAt));
        if (n == 0) {
            return false;
        }
        int units = refund ? -qty : qty;
        BigDecimal revenue = price == null ? BigDecimal.ZERO : price.multiply(BigDecimal.valueOf(units));
        Date day = Date.valueOf(occurredAt.atZone(IST).toLocalDate());
        jdbc.update("INSERT INTO sales_daily(tenant_id, product_id, day, units, revenue) VALUES (?,?,?,?,?) " +
                "ON CONFLICT (product_id, day) DO UPDATE SET units = sales_daily.units + EXCLUDED.units, revenue = sales_daily.revenue + EXCLUDED.revenue",
                tenantId, productId, day, units, revenue);
        return true;
    }
}
