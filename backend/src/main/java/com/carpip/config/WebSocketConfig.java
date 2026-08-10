package com.carpip.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * WebSocket configuration for real-time dashboard updates.
 * Uses STOMP protocol over WebSocket for structured pub/sub messaging.
 *
 * Clients connect to /ws and subscribe to topics like:
 *   /topic/inventory/{tenantId}
 *   /topic/orders/{tenantId}
 *   /topic/negotiations/{orderId}
 *   /topic/sync/{tenantId}
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Value("${cors.allowed-origins}")
    private String allowedOrigins;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Enable a simple in-memory message broker for /topic destinations
        config.enableSimpleBroker("/topic");
        // Application destination prefix for @MessageMapping methods
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Register the STOMP endpoint that clients will connect to
        registry.addEndpoint("/ws")
                .setAllowedOrigins(allowedOrigins.split(","));
    }
}
