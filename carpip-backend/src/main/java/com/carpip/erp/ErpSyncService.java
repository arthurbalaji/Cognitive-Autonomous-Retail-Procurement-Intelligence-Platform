package com.carpip.erp;

import com.carpip.config.AppProps;
import com.carpip.domain.IntegrationConnection;
import com.carpip.domain.Repos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Scheduled ERP synchronisation (paper: ErpSyncService / @Scheduled). Polls Shopify and Zoho connections,
 * evaluates freshness of push-only connections, and reconciles when webhooks are missing.
 * The interval scales with the demo time-scale setting.
 */
@Service
public class ErpSyncService {
    private static final Logger log = LoggerFactory.getLogger(ErpSyncService.class);
    private final Repos.ConnectionRepo connections;
    private final AdapterRegistry adapters;
    private final AppProps props;
    private final JdbcTemplate jdbc;
    private final Map<UUID, ReentrantLock> locks = new ConcurrentHashMap<>();

    public ErpSyncService(Repos.ConnectionRepo connections, AdapterRegistry adapters, AppProps props, JdbcTemplate jdbc) {
        this.connections = connections;
        this.adapters = adapters;
        this.props = props;
        this.jdbc = jdbc;
    }

    public double timeScale() {
        try {
            Double v = jdbc.queryForObject("SELECT (value #>> '{}')::float8 FROM system_setting WHERE key='demo.time_scale'", Double.class);
            return v == null || v < 1 ? 1 : v;
        } catch (Exception e) {
            return 1;
        }
    }

    @Scheduled(fixedDelay = 5000, initialDelay = 20_000)
    public void tick() {
        double scale = timeScale();
        long interval = Math.max(5000, (long) (props.erpSyncIntervalMs() / scale));
        for (IntegrationConnection c : connections.findAll()) {
            if (!"ACTIVE".equals(c.status)) {
                continue;
            }
            boolean needSync = c.syncCursor != null && Boolean.TRUE.equals(c.syncCursor.get("needSync"));
            boolean due = c.lastSyncAt == null || Duration.between(c.lastSyncAt, Instant.now()).toMillis() >= interval;
            try {
                if ("CUSTOM_REST".equals(c.type)) {
                    adapters.get(c.type).sync(c); // staleness evaluation only
                } else if (due || needSync) {
                    syncOne(c.id);
                }
            } catch (Exception e) {
                log.warn("sync tick for {} failed: {}", c.id, e.getMessage());
            }
        }
    }

    /** Synchronous sync of one connection. Returns stats; failures set health=ERROR and are rethrown. */
    public ErpAdapter.SyncStats syncOne(UUID connectionId) {
        ReentrantLock lock = locks.computeIfAbsent(connectionId, k -> new ReentrantLock());
        if (!lock.tryLock()) {
            return ErpAdapter.SyncStats.none("sync already running");
        }
        try {
            IntegrationConnection c = connections.findById(connectionId).orElseThrow();
            boolean first = c.lastSyncAt == null;
            try {
                ErpAdapter a = adapters.get(c.type);
                ErpAdapter.SyncStats st = a.sync(c);
                c = connections.findById(connectionId).orElseThrow();
                if ("SHOPIFY".equals(c.type) && !first && (st.levels() > 0 || st.orders() > 0)) {
                    Object lw = c.syncCursor == null ? null : c.syncCursor.get("lastWebhookAt");
                    long interval = Math.max(5000, (long) (props.erpSyncIntervalMs() / timeScale()));
                    boolean webhooksSilent = lw == null || Duration.between(Instant.parse(lw.toString()), Instant.now()).toMillis() > 2 * interval;
                    if (webhooksSilent) {
                        c.health = "WEBHOOK_DEGRADED";
                        c.lastError = "polling found " + st.levels() + " stock changes and " + st.orders() + " sales that no webhook delivered";
                        connections.save(c);
                        try {
                            ((ShopifyAdapter) a).registerWebhooks(c);
                        } catch (Exception e) {
                            log.warn("webhook re-registration failed: {}", e.getMessage());
                        }
                    }
                }
                return st;
            } catch (RuntimeException e) {
                IntegrationConnection fresh = connections.findById(connectionId).orElse(c);
                fresh.health = "ERROR";
                fresh.lastError = e.getMessage() == null ? e.toString() : e.getMessage();
                fresh.lastSyncAt = Instant.now(); // last attempt: back off until the next interval
                connections.save(fresh);
                throw e;
            }
        } finally {
            lock.unlock();
        }
    }

    @SuppressWarnings("unused")
    private Map<String, Object> noop() {
        return new HashMap<>();
    }
}
