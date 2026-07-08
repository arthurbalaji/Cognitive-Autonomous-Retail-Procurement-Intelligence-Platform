package com.carpip.controller;

import com.carpip.entity.NegotiationLog;
import com.carpip.entity.Order;
import com.carpip.entity.User;
import com.carpip.repository.NegotiationLogRepository;
import com.carpip.repository.OrderRepository;
import com.carpip.repository.TenantRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderRepository orderRepository;
    private final TenantRepository tenantRepository;
    private final NegotiationLogRepository negotiationLogRepository;

    public OrderController(OrderRepository orderRepository,
                           TenantRepository tenantRepository,
                           NegotiationLogRepository negotiationLogRepository) {
        this.orderRepository = orderRepository;
        this.tenantRepository = tenantRepository;
        this.negotiationLogRepository = negotiationLogRepository;
    }

    @GetMapping
    public ResponseEntity<List<Order>> getOrders(@AuthenticationPrincipal User user) {
        String tenantId = user.getTenant().getId();
        List<Order> orders;

        if (user.getRole() == User.UserRole.RETAILER) {
            orders = orderRepository.findByRetailerId(tenantId);
        } else if (user.getRole() == User.UserRole.WHOLESALER) {
            orders = orderRepository.findByWholesalerId(tenantId);
        } else {
            orders = orderRepository.findAll();
        }

        return ResponseEntity.ok(orders);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Order> getOrder(@PathVariable String id) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Order not found"));
        return ResponseEntity.ok(order);
    }

    @PostMapping
    public ResponseEntity<Order> createOrder(@RequestBody Order order, @AuthenticationPrincipal User user) {
        order.setRetailer(user.getTenant());
        order.setStatus(Order.OrderStatus.PENDING);
        Order saved = orderRepository.save(order);
        return ResponseEntity.ok(saved);
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<Order> updateOrderStatus(@PathVariable String id,
                                                     @RequestBody StatusUpdate statusUpdate,
                                                     @AuthenticationPrincipal User user) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Order not found"));

        order.setStatus(Order.OrderStatus.valueOf(statusUpdate.status()));
        Order saved = orderRepository.save(order);
        return ResponseEntity.ok(saved);
    }

    /**
     * Get negotiation logs for a specific order.
     */
    @GetMapping("/{id}/negotiations")
    public ResponseEntity<List<NegotiationLog>> getOrderNegotiations(@PathVariable String id) {
        List<NegotiationLog> logs = negotiationLogRepository.findByOrderIdOrderByTimestampAsc(id);
        return ResponseEntity.ok(logs);
    }

    /**
     * Get summary statistics for orders.
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getOrderStats(@AuthenticationPrincipal User user) {
        String tenantId = user.getTenant().getId();
        List<Order> orders;

        if (user.getRole() == User.UserRole.RETAILER) {
            orders = orderRepository.findByRetailerId(tenantId);
        } else if (user.getRole() == User.UserRole.WHOLESALER) {
            orders = orderRepository.findByWholesalerId(tenantId);
        } else {
            orders = orderRepository.findAll();
        }

        long pending = orders.stream().filter(o -> o.getStatus() == Order.OrderStatus.PENDING).count();
        long negotiating = orders.stream().filter(o -> o.getStatus() == Order.OrderStatus.NEGOTIATING).count();
        long accepted = orders.stream().filter(o -> o.getStatus() == Order.OrderStatus.ACCEPTED).count();
        long rejected = orders.stream().filter(o -> o.getStatus() == Order.OrderStatus.REJECTED).count();

        return ResponseEntity.ok(Map.of(
                "total", orders.size(),
                "pending", pending,
                "negotiating", negotiating,
                "accepted", accepted,
                "rejected", rejected
        ));
    }

    public record StatusUpdate(String status) {}
}
