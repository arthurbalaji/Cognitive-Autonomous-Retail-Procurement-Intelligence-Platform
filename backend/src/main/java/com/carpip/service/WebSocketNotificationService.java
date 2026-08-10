package com.carpip.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * Centralized service for pushing real-time WebSocket notifications
 * to connected dashboard clients via STOMP topics.
 */
@Service
public class WebSocketNotificationService {

    private static final Logger log = LoggerFactory.getLogger(WebSocketNotificationService.class);

    private final SimpMessagingTemplate messagingTemplate;

    public WebSocketNotificationService(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Notify dashboards of inventory changes after ERP sync.
     * Retailers see updated stock levels in real time.
     */
    public void notifyInventoryUpdate(String tenantId, Map<String, Object> productData) {
        try {
            Map<String, Object> payload = new HashMap<>(productData);
            payload.put("type", "INVENTORY_UPDATE");
            payload.put("timestamp", LocalDateTime.now().toString());
            payload.put("tenantId", tenantId);

            messagingTemplate.convertAndSend("/topic/inventory/" + tenantId, payload);
            log.debug("WebSocket: Inventory update sent for tenant {}", tenantId);
        } catch (Exception e) {
            log.warn("WebSocket: Failed to send inventory update: {}", e.getMessage());
        }
    }

    /**
     * Notify dashboards of order status changes (new POs, status updates).
     * Wholesalers see incoming automated POs in real time.
     */
    public void notifyOrderUpdate(String tenantId, Map<String, Object> orderData) {
        try {
            Map<String, Object> payload = new HashMap<>(orderData);
            payload.put("type", "ORDER_UPDATE");
            payload.put("timestamp", LocalDateTime.now().toString());
            payload.put("tenantId", tenantId);

            messagingTemplate.convertAndSend("/topic/orders/" + tenantId, payload);
            log.debug("WebSocket: Order update sent for tenant {}", tenantId);
        } catch (Exception e) {
            log.warn("WebSocket: Failed to send order update: {}", e.getMessage());
        }
    }

    /**
     * Notify dashboards of negotiation progress (live transcript updates).
     * Both retailers and wholesalers can watch negotiations unfold.
     */
    public void notifyNegotiationUpdate(String orderId, Map<String, Object> negotiationData) {
        try {
            Map<String, Object> payload = new HashMap<>(negotiationData);
            payload.put("type", "NEGOTIATION_UPDATE");
            payload.put("timestamp", LocalDateTime.now().toString());
            payload.put("orderId", orderId);

            messagingTemplate.convertAndSend("/topic/negotiations/" + orderId, payload);
            log.debug("WebSocket: Negotiation update sent for order {}", orderId);
        } catch (Exception e) {
            log.warn("WebSocket: Failed to send negotiation update: {}", e.getMessage());
        }
    }

    /**
     * Notify dashboards that an ERP sync has completed.
     * Shows sync results (products upserted, sales published) in real time.
     */
    public void notifySyncComplete(String tenantId, Map<String, Object> syncResult) {
        try {
            Map<String, Object> payload = new HashMap<>(syncResult);
            payload.put("type", "SYNC_COMPLETE");
            payload.put("timestamp", LocalDateTime.now().toString());
            payload.put("tenantId", tenantId);

            messagingTemplate.convertAndSend("/topic/sync/" + tenantId, payload);
            log.debug("WebSocket: Sync complete notification sent for tenant {}", tenantId);
        } catch (Exception e) {
            log.warn("WebSocket: Failed to send sync notification: {}", e.getMessage());
        }
    }

    /**
     * Broadcast a system-wide alert to all connected clients.
     * Used for critical events like service health changes.
     */
    public void broadcastSystemAlert(String alertType, String message) {
        try {
            Map<String, Object> payload = Map.of(
                    "type", "SYSTEM_ALERT",
                    "alertType", alertType,
                    "message", message,
                    "timestamp", LocalDateTime.now().toString()
            );

            messagingTemplate.convertAndSend("/topic/system", payload);
            log.info("WebSocket: System alert broadcast — {}: {}", alertType, message);
        } catch (Exception e) {
            log.warn("WebSocket: Failed to broadcast system alert: {}", e.getMessage());
        }
    }
}
