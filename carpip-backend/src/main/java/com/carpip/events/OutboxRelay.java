package com.carpip.events;

import org.apache.kafka.clients.producer.ProducerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Publishes unpublished outbox rows in id order; exponential backoff (max 30s) while Kafka is unavailable. */
@Component
public class OutboxRelay {
    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);
    private final JdbcTemplate jdbc;
    private final KafkaTemplate<String, String> kafka;
    private final DemoState demo;
    private volatile long backoffMs = 0;
    private volatile long notBefore = 0;
    private volatile String lastError;

    public OutboxRelay(JdbcTemplate jdbc, KafkaTemplate<String, String> kafka, DemoState demo) {
        this.jdbc = jdbc;
        this.kafka = kafka;
        this.demo = demo;
    }

    @Scheduled(fixedDelay = 200)
    public void relay() {
        if (demo.relayPaused.get() || System.currentTimeMillis() < notBefore) {
            return;
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, topic, msg_key, payload FROM outbox_event WHERE published_at IS NULL ORDER BY id LIMIT 100");
        if (rows.isEmpty()) {
            return;
        }
        List<CompletableFuture<SendResult<String, String>>> futures = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            futures.add(kafka.send(new ProducerRecord<>((String) r.get("topic"), (String) r.get("msg_key"), (String) r.get("payload"))));
        }
        boolean failed = false;
        for (int i = 0; i < rows.size(); i++) {
            long id = ((Number) rows.get(i).get("id")).longValue();
            try {
                futures.get(i).get(9, TimeUnit.SECONDS);
                jdbc.update("UPDATE outbox_event SET published_at = now(), attempts = attempts + 1 WHERE id = ?", id);
            } catch (Exception e) {
                failed = true;
                lastError = String.valueOf(e.getMessage());
                jdbc.update("UPDATE outbox_event SET attempts = attempts + 1, last_error = ? WHERE id = ?", abbreviate(lastError), id);
                break; // preserve ordering: stop at the first failure
            }
        }
        if (failed) {
            backoffMs = Math.min(30_000, Math.max(500, backoffMs * 2));
            notBefore = System.currentTimeMillis() + backoffMs;
            log.warn("outbox relay: kafka unavailable, backing off {} ms ({})", backoffMs, lastError);
        } else {
            backoffMs = 0;
            lastError = null;
        }
    }

    public long backlog() {
        Long n = jdbc.queryForObject("SELECT count(*) FROM outbox_event WHERE published_at IS NULL", Long.class);
        return n == null ? 0 : n;
    }

    public String lastError() {
        return lastError;
    }

    private static String abbreviate(String s) {
        return s == null ? null : s.length() > 300 ? s.substring(0, 300) : s;
    }
}
