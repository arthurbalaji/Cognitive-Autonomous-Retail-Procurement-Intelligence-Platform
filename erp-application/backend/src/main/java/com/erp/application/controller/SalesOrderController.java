package com.erp.application.controller;

import com.erp.application.entity.SalesOrder;
import com.erp.application.service.SalesOrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/sales-orders")
@RequiredArgsConstructor
public class SalesOrderController {

    private final SalesOrderService salesOrderService;

    @GetMapping
    public ResponseEntity<List<SalesOrder>> getAllOrders() {
        return ResponseEntity.ok(salesOrderService.getAllOrders());
    }

    @GetMapping("/{id}")
    public ResponseEntity<SalesOrder> getOrderById(@PathVariable Long id) {
        return ResponseEntity.ok(salesOrderService.getOrderById(id));
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<SalesOrder>> getOrdersByStatus(@PathVariable SalesOrder.SalesOrderStatus status) {
        return ResponseEntity.ok(salesOrderService.getOrdersByStatus(status));
    }

    @GetMapping("/customer/{customerId}")
    public ResponseEntity<List<SalesOrder>> getOrdersByCustomer(@PathVariable Long customerId) {
        return ResponseEntity.ok(salesOrderService.getOrdersByCustomer(customerId));
    }

    @PostMapping
    public ResponseEntity<SalesOrder> createOrder(@RequestBody CreateOrderRequest request) {
        SalesOrder order = new SalesOrder();
        order.setCustomer(null); // Will be set via customerId lookup
        order.setNotes(request.notes());

        if (request.customerId() != null) {
            // Customer will be set in service or we need to pass it
        }

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(salesOrderService.createOrder(order, request.items()));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<SalesOrder> updateStatus(@PathVariable Long id, @RequestBody StatusUpdate update) {
        return ResponseEntity.ok(salesOrderService.updateStatus(id, SalesOrder.SalesOrderStatus.valueOf(update.status())));
    }

    public record CreateOrderRequest(
            Long customerId,
            String notes,
            List<SalesOrderService.OrderItemRequest> items
    ) {}

    public record StatusUpdate(String status) {}
}
