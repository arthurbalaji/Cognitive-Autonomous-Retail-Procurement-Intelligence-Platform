package com.carpip.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration
public class KafkaConfig {

    @Bean
    public NewTopic salesEventsTopic() {
        return TopicBuilder.name("sales.events")
                .partitions(3)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic inventoryUpdatesTopic() {
        return TopicBuilder.name("inventory.updates")
                .partitions(3)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic negotiationResultsTopic() {
        return TopicBuilder.name("negotiation.results")
                .partitions(1)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic orderEventsTopic() {
        return TopicBuilder.name("order.events")
                .partitions(2)
                .replicas(1)
                .build();
    }
}
