package com.erp.application.controller;

import com.erp.application.entity.PurchaseOrder;
import com.erp.application.service.PurchaseOrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/purchase-orders")
@RequiredArgsConstructor
public class PurchaseOrderController {

    private final PurchaseOrderService purchaseOrderService;

    @GetMapping
    public ResponseEntity<List<PurchaseOrder>> getAllOrders() {
        return ResponseEntity.ok(purchaseOrderService.getAllOrders());
    }

    @GetMapping("/{id}")
    public ResponseEntity<PurchaseOrder> getOrderById(@PathVariable Long id) {
        return ResponseEntity.ok(purchaseOrderService.getOrderById(id));
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<PurchaseOrder>> getOrdersByStatus(@PathVariable PurchaseOrder.PurchaseOrderStatus status) {
        return ResponseEntity.ok(purchaseOrderService.getOrdersByStatus(status));
    }

    @PostMapping
    public ResponseEntity<PurchaseOrder> createOrder(@RequestBody CreatePurchaseOrderRequest request) {
        PurchaseOrder order = new PurchaseOrder();
        order.setNotes(request.notes());
        order.setExpectedDelivery(request.expectedDelivery());

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(purchaseOrderService.createOrder(order, request.items()));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<PurchaseOrder> updateStatus(@PathVariable Long id, @RequestBody StatusUpdate update) {
        return ResponseEntity.ok(purchaseOrderService.updateStatus(id,
                PurchaseOrder.PurchaseOrderStatus.valueOf(update.status())));
    }

    @PostMapping("/{id}/receive")
    public ResponseEntity<PurchaseOrder> receiveGoods(@PathVariable Long id) {
        return ResponseEntity.ok(purchaseOrderService.receiveGoods(id));
    }

    public record CreatePurchaseOrderRequest(
            Long supplierId,
            String notes,
            java.time.LocalDate expectedDelivery,
            List<PurchaseOrderService.PurchaseItemRequest> items
    ) {}

    public record StatusUpdate(String status) {}
}
