package com.erp.application.controller;

import com.erp.application.entity.InventoryTransaction;
import com.erp.application.service.InventoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/inventory")
@RequiredArgsConstructor
public class InventoryController {

    private final InventoryService inventoryService;

    @GetMapping
    public ResponseEntity<List<InventoryTransaction>> getAllTransactions() {
        return ResponseEntity.ok(inventoryService.getAllTransactions());
    }

    @GetMapping("/product/{productId}")
    public ResponseEntity<List<InventoryTransaction>> getTransactionsByProduct(@PathVariable Long productId) {
        return ResponseEntity.ok(inventoryService.getTransactionsByProduct(productId));
    }

    @PostMapping("/adjust")
    public ResponseEntity<InventoryTransaction> createAdjustment(@RequestBody AdjustmentRequest request) {
        return ResponseEntity.ok(inventoryService.createAdjustment(
                request.productId(), request.quantity(), request.notes()));
    }

    public record AdjustmentRequest(Long productId, int quantity, String notes) {}
}
