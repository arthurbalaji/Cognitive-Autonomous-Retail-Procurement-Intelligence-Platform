package com.carpip.catalog;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * Dynamic reorder point: ROP = ceil( mean_daily * (L + S) + 1.65 * sd * sqrt(L) ) over the last 28 days,
 * L = average supplier lead time for the GTIN (default 3), S = safety days (3). Products with a MANUAL ROP are untouched.
 * A product with no recent demand gets ROP 0, which the threshold rule treats as "never auto-reorder".
 */
@Service
public class RopService {
    private static final Logger log = LoggerFactory.getLogger(RopService.class);
    private final JdbcTemplate jdbc;

    public RopService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public int recompute(UUID tenantId) {
        return jdbc.update(
                "WITH stats AS (" +
                        " SELECT p.id, p.gtin, COALESCE(SUM(s.units),0)/28.0 AS mean, COALESCE(SUM(s.units::float8*s.units),0)/28.0 AS msq" +
                        " FROM product p LEFT JOIN sales_daily s ON s.product_id = p.id AND s.day >= current_date - 28" +
                        " WHERE p.tenant_id = ? AND p.rop_source = 'AUTO' GROUP BY p.id, p.gtin)," +
                        " lead AS (SELECT gtin, AVG(lead_time_days) AS l FROM supplier_offer WHERE active GROUP BY gtin)" +
                        " UPDATE product p SET updated_at = now(), version = p.version + 1, reorder_point = " +
                        " CASE WHEN st.mean <= 0 THEN 0 ELSE CEIL(st.mean * (COALESCE(ld.l,3) + 3) + 1.65 * SQRT(GREATEST(st.msq - st.mean*st.mean, 0)) * SQRT(COALESCE(ld.l,3)))::int END" +
                        " FROM stats st LEFT JOIN lead ld ON ld.gtin = st.gtin WHERE p.id = st.id", tenantId);
    }

    public int recomputeAll() {
        int n = 0;
        List<UUID> ids = jdbc.queryForList("SELECT id FROM tenant WHERE type='RETAILER' AND status='ACTIVE'", UUID.class);
        for (UUID id : ids) {
            n += recompute(id);
        }
        return n;
    }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 120_000)
    public void hourly() {
        try {
            int n = recomputeAll();
            log.info("dynamic ROP recomputed for {} products", n);
        } catch (Exception e) {
            log.warn("ROP recompute failed: {}", e.getMessage());
        }
    }
}
