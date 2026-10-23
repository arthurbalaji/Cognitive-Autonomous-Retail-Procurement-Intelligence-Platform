package com.carpip.events;

import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.ListOffsetsResult;
import org.apache.kafka.clients.admin.OffsetSpec;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Header;
import org.springframework.kafka.core.KafkaAdmin;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

/** Broker health, consumer lag, dead-letter inspection / replay for the admin console. */
@Component
public class KafkaOps {
    public static final List<String> DLTS = List.of("sales.events.DLT", "inventory.updates.DLT", "procurement.requests.DLT", "po.lifecycle.DLT");
    public static final List<String> GROUPS = List.of("carpip-inventory", "carpip-sales", "carpip-procurement", "carpip-ui-stream");

    private final KafkaAdmin kafkaAdmin;
    private final KafkaTemplate<String, String> template;

    public KafkaOps(KafkaAdmin kafkaAdmin, KafkaTemplate<String, String> template) {
        this.kafkaAdmin = kafkaAdmin;
        this.template = template;
    }

    private Properties adminProps() {
        Properties p = new Properties();
        p.putAll(kafkaAdmin.getConfigurationProperties());
        p.put("request.timeout.ms", "4000");
        p.put("default.api.timeout.ms", "5000");
        return p;
    }

    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        try (AdminClient ac = AdminClient.create(adminProps())) {
            int nodes = ac.describeCluster().nodes().get(4, java.util.concurrent.TimeUnit.SECONDS).size();
            out.put("up", nodes > 0);
            Map<String, Object> lag = new LinkedHashMap<>();
            for (String g : GROUPS) {
                long total = 0;
                try {
                    Map<TopicPartition, OffsetAndMetadata> committed = ac.listConsumerGroupOffsets(g).partitionsToOffsetAndMetadata().get(4, java.util.concurrent.TimeUnit.SECONDS);
                    if (!committed.isEmpty()) {
                        Map<TopicPartition, OffsetSpec> req = new HashMap<>();
                        committed.keySet().forEach(tp -> req.put(tp, OffsetSpec.latest()));
                        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> ends = ac.listOffsets(req).all().get(4, java.util.concurrent.TimeUnit.SECONDS);
                        for (Map.Entry<TopicPartition, OffsetAndMetadata> e : committed.entrySet()) {
                            total += Math.max(0, ends.get(e.getKey()).offset() - e.getValue().offset());
                        }
                    }
                } catch (Exception ignored) {
                    total = -1;
                }
                lag.put(g, total);
            }
            out.put("consumerLag", lag);
            Map<String, Object> dlt = new LinkedHashMap<>();
            Map<TopicPartition, OffsetSpec> req = new HashMap<>();
            DLTS.forEach(t -> req.put(new TopicPartition(t, 0), OffsetSpec.latest()));
            Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> ends = ac.listOffsets(req).all().get(4, java.util.concurrent.TimeUnit.SECONDS);
            ends.forEach((tp, info) -> dlt.put(tp.topic(), info.offset()));
            out.put("deadLetters", dlt);
        } catch (Exception e) {
            out.put("up", false);
            out.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
        }
        return out;
    }

    private KafkaConsumer<String, String> consumer() {
        Properties p = new Properties();
        p.putAll(kafkaAdmin.getConfigurationProperties());
        p.put(ConsumerConfig.GROUP_ID_CONFIG, "dlq-peek-" + UUID.randomUUID());
        p.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
        p.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringDeserializer");
        p.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringDeserializer");
        p.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "100");
        return new KafkaConsumer<>(p);
    }

    public List<Map<String, Object>> peek(String dltTopic, long fromOffset, int max) {
        if (!DLTS.contains(dltTopic)) {
            throw new IllegalArgumentException("unknown dead-letter topic");
        }
        List<Map<String, Object>> out = new ArrayList<>();
        try (KafkaConsumer<String, String> c = consumer()) {
            TopicPartition tp = new TopicPartition(dltTopic, 0);
            c.assign(List.of(tp));
            c.seek(tp, Math.max(fromOffset, 0));
            long deadline = System.currentTimeMillis() + 3000;
            while (out.size() < max && System.currentTimeMillis() < deadline) {
                for (ConsumerRecord<String, String> r : c.poll(Duration.ofMillis(500))) {
                    out.add(view(r));
                    if (out.size() >= max) {
                        break;
                    }
                }
            }
        }
        return out;
    }

    private Map<String, Object> view(ConsumerRecord<String, String> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("offset", r.offset());
        m.put("timestamp", r.timestamp());
        m.put("key", r.key());
        String v = r.value();
        m.put("value", v == null ? null : v.length() > 1500 ? v.substring(0, 1500) + "..." : v);
        for (Header h : r.headers()) {
            if (h.key().equals("kafka_dlt-exception-message")) {
                m.put("error", new String(h.value(), StandardCharsets.UTF_8));
            }
            if (h.key().equals("kafka_dlt-original-topic")) {
                m.put("originalTopic", new String(h.value(), StandardCharsets.UTF_8));
            }
        }
        return m;
    }

    /** Re-publishes one dead-lettered message to its original topic. */
    public Map<String, Object> replay(String dltTopic, long offset) {
        if (!DLTS.contains(dltTopic)) {
            throw new IllegalArgumentException("unknown dead-letter topic");
        }
        try (KafkaConsumer<String, String> c = consumer()) {
            TopicPartition tp = new TopicPartition(dltTopic, 0);
            c.assign(List.of(tp));
            c.seek(tp, offset);
            long deadline = System.currentTimeMillis() + 4000;
            while (System.currentTimeMillis() < deadline) {
                for (ConsumerRecord<String, String> r : c.poll(Duration.ofMillis(500))) {
                    if (r.offset() == offset) {
                        String original = dltTopic.substring(0, dltTopic.length() - 4);
                        template.send(new ProducerRecord<>(original, r.key(), r.value()));
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("replayedTo", original);
                        m.put("offset", offset);
                        return m;
                    }
                }
            }
        }
        throw new IllegalArgumentException("offset not found in " + dltTopic);
    }
}
