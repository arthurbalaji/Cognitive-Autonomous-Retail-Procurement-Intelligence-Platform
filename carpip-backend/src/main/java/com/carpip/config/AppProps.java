package com.carpip.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "carpip")
public record AppProps(
        String jwtSecret,
        String encKey,
        String internalToken,
        @DefaultValue("http://carpip-intelligence:5000") String intelligenceUrl,
        String adminEmail,
        String adminPassword,
        @DefaultValue("true") boolean demoMode,
        @DefaultValue("300") int webhookToleranceS,
        @DefaultValue("60000") long erpSyncIntervalMs,
        @DefaultValue("true") boolean autoReceive,
        @DefaultValue("30") int rejectCooldownMin,
        @DefaultValue("24") int quoteTtlH,
        @DefaultValue("http://carpip-backend:8080") String publicWebhookBase) {
}
