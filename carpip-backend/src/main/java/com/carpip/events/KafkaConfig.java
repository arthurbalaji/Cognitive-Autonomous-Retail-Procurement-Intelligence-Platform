package com.carpip.events;

import org.apache.kafka.common.TopicPartition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/** Poison / failing messages go to "<topic>.DLT" (1 partition) after 3 retries, 1s apart. */
@Configuration
public class KafkaConfig {

    @Bean
    public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, String> template) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template,
                (record, ex) -> new TopicPartition(record.topic() + ".DLT", 0));
        DefaultErrorHandler h = new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 3L));
        h.addNotRetryableExceptions(IllegalArgumentException.class);
        return h;
    }
}
