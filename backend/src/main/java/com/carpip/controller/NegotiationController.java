package com.carpip.controller;

import com.carpip.entity.NegotiationLog;
import com.carpip.entity.Order;
import com.carpip.entity.User;
import com.carpip.repository.NegotiationLogRepository;
import com.carpip.repository.OrderRepository;
import com.carpip.service.WebSocketNotificationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/negotiations")
public class NegotiationController {

    private static final Logger log = LoggerFactory.getLogger(NegotiationController.class);
    private final NegotiationLogRepository negotiationLogRepository;
    private final OrderRepository orderRepository;
    private final WebSocketNotificationService webSocketNotifier;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${ai.service.url:http://localhost:5000}")
    private String aiServiceUrl;

    public NegotiationController(NegotiationLogRepository negotiationLogRepository,
                                  OrderRepository orderRepository,
                                  WebSocketNotificationService webSocketNotifier) {
        this.negotiationLogRepository = negotiationLogRepository;
        this.orderRepository = orderRepository;
        this.webSocketNotifier = webSocketNotifier;
    }

    /**
     * Get negotiation logs for a specific order.
     */
    @GetMapping("/{orderId}")
    public ResponseEntity<List<NegotiationLog>> getNegotiationLogs(@PathVariable String orderId) {
        List<NegotiationLog> logs = negotiationLogRepository.findByOrderIdOrderByTimestampAsc(orderId);
        return ResponseEntity.ok(logs);
    }

    /**
     * Trigger an AI negotiation for a product.
     * Calls the Flask AI service's /api/ai/negotiate endpoint.
     */
    @PostMapping("/trigger")
    public ResponseEntity<Map<String, Object>> triggerNegotiation(
            @RequestBody NegotiationRequest request,
            @AuthenticationPrincipal User user) {

        log.info("Triggering AI negotiation for SKU: {} by user: {}", request.sku(), user.getEmail());

        try {
            // Build the request to Flask AI service
            Map<String, Object> aiRequest = new HashMap<>();
            aiRequest.put("product", Map.of(
                    "sku", request.sku(),
                    "name", request.productName() != null ? request.productName() : request.sku(),
                    "base_price", request.basePrice(),
                    "current_stock", request.currentStock(),
                    "reorder_point", request.reorderPoint()
            ));
            aiRequest.put("forecast", Map.of(
                    "predicted_demand_7d", request.predictedDemand() != null ? request.predictedDemand() : 40,
                    "risk", request.risk() != null ? request.risk() : "HIGH",
                    "confidence", 0.85
            ));
            aiRequest.put("mpi", Map.of(
                    "value", 0.72,
                    "trend", "STABLE"
            ));
            aiRequest.put("max_turns", 3);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            ResponseEntity<Map> response = restTemplate.exchange(
                    aiServiceUrl + "/api/ai/negotiate",
                    HttpMethod.POST,
                    new HttpEntity<>(aiRequest, headers),
                    Map.class
            );

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Map<String, Object> result = response.getBody();

                // Save negotiation logs to database if we have an order
                if (request.orderId() != null) {
                    saveTranscript(request.orderId(), result);
                }

                // Push real-time WebSocket notification
                webSocketNotifier.notifyNegotiationUpdate(
                        request.orderId() != null ? request.orderId() : request.sku(),
                        result
                );

                return ResponseEntity.ok(result);
            }

            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "AI service returned non-200 response"
            ));
        } catch (Exception e) {
            log.warn("AI negotiation service call failed: {}. Running local fallback.", e.getMessage());

            // Return a demo negotiation result as fallback
            return ResponseEntity.ok(getDemoNegotiationResult(request));
        }
    }

    /**
     * Get the latest negotiation demo from the AI service.
     */
    @GetMapping("/demo")
    public ResponseEntity<Map<String, Object>> getNegotiationDemo() {
        try {
            ResponseEntity<Map> response = restTemplate.getForEntity(
                    aiServiceUrl + "/api/ai/negotiate/demo", Map.class
            );
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return ResponseEntity.ok(response.getBody());
            }
        } catch (Exception e) {
            log.warn("AI demo endpoint unreachable: {}", e.getMessage());
        }

        // Fallback demo
        return ResponseEntity.ok(getDemoNegotiationResult(null));
    }

    // ─── Helpers ──────────────────────────────────────────────

    private void saveTranscript(String orderId, Map<String, Object> result) {
        try {
            Optional<Order> orderOpt = orderRepository.findById(orderId);
            if (orderOpt.isEmpty()) return;

            Order order = orderOpt.get();
            List<Map<String, Object>> transcript = (List<Map<String, Object>>) result.get("transcript");

            if (transcript != null) {
                for (Map<String, Object> entry : transcript) {
                    NegotiationLog logEntry = new NegotiationLog();
                    logEntry.setOrder(order);
                    logEntry.setAgentType(String.valueOf(entry.getOrDefault("agent", "SYSTEM")));
                    logEntry.setMessagePayload(entry.toString());
                    logEntry.setTimestamp(LocalDateTime.now());
                    negotiationLogRepository.save(logEntry);
                }
            }

            // Update order status based on result
            Map<String, Object> negotiationResult = (Map<String, Object>) result.get("result");
            if (negotiationResult != null) {
                String status = String.valueOf(negotiationResult.getOrDefault("status", "NEGOTIATING"));
                order.setStatus(Order.OrderStatus.valueOf(status));
                orderRepository.save(order);
            }
        } catch (Exception e) {
            log.error("Failed to save negotiation transcript: {}", e.getMessage());
        }
    }

    private Map<String, Object> getDemoNegotiationResult(NegotiationRequest request) {
        String sku = request != null ? request.sku() : "SKU-003";
        String name = request != null && request.productName() != null ? request.productName() : "Bamboo Desk Organizer";
        double basePrice = request != null ? request.basePrice() : 34.50;
        int stock = request != null ? request.currentStock() : 12;

        List<Map<String, Object>> transcript = new ArrayList<>();
        transcript.add(Map.of(
                "agent", "SYSTEM", "action", "INIT",
                "message", "Negotiation initiated for " + name + " — Stock at " + stock + " units.",
                "timestamp", LocalDateTime.now().toString()
        ));
        transcript.add(Map.of(
                "agent", "RETAILER_AGENT", "action", "PROPOSE",
                "message", "Proposing purchase of 60 units at $" + String.format("%.2f", basePrice * 0.83) + "/unit (17% below list).",
                "timestamp", LocalDateTime.now().toString()
        ));
        transcript.add(Map.of(
                "agent", "WHOLESALER_AGENT", "action", "COUNTER",
                "message", "Counter at $" + String.format("%.2f", basePrice * 0.90) + "/unit — 10% discount. MPI at 72 (STABLE).",
                "timestamp", LocalDateTime.now().toString()
        ));
        transcript.add(Map.of(
                "agent", "RETAILER_AGENT", "action", "ACCEPT",
                "message", "Accepted at $" + String.format("%.2f", basePrice * 0.87) + "/unit. Savings confirmed.",
                "timestamp", LocalDateTime.now().toString()
        ));
        transcript.add(Map.of(
                "agent", "SYSTEM", "action", "COMPLETE",
                "message", "Negotiation complete. Status: ACCEPTED. Total: $" + String.format("%.2f", basePrice * 0.87 * 60),
                "timestamp", LocalDateTime.now().toString()
        ));

        return Map.of(
                "result", Map.of(
                        "status", "ACCEPTED",
                        "final_price", basePrice * 0.87,
                        "quantity", 60,
                        "total", basePrice * 0.87 * 60,
                        "turns", 2,
                        "savings", basePrice * 0.13 * 60
                ),
                "transcript", transcript
        );
    }

    public record NegotiationRequest(
            String orderId,
            String sku,
            String productName,
            double basePrice,
            int currentStock,
            int reorderPoint,
            Integer predictedDemand,
            String risk
    ) {}
}
