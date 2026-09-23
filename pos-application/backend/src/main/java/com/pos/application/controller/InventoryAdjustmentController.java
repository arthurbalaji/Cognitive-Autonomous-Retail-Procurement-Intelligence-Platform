package com.pos.application.controller;

import com.pos.application.entity.InventoryTransaction;
import com.pos.application.entity.InventoryTransactionType;
import com.pos.application.service.InventoryTransactionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/inventory")
@RequiredArgsConstructor
public class InventoryAdjustmentController {

        private final InventoryTransactionService inventoryTransactionService;

        @PostMapping("/adjust")
        public ResponseEntity<InventoryTransaction> adjustStock(
                        @Valid @RequestBody InventoryAdjustmentRequest request) {

                InventoryTransaction transaction = inventoryTransactionService.adjustStock(
                                request.productId(),
                                request.quantity(),
                                request.notes());

                return ResponseEntity.ok(transaction);
        }

        @GetMapping("/products/{productId}/history")
        public ResponseEntity<List<InventoryTransaction>> getProductHistory(
                        @PathVariable Long productId) {

                return ResponseEntity.ok(
                                inventoryTransactionService.getProductHistory(productId));
        }

        @GetMapping("/type/{type}")
        public ResponseEntity<List<InventoryTransaction>> getTransactionsByType(
                        @PathVariable InventoryTransactionType type) {

                return ResponseEntity.ok(
                                inventoryTransactionService.getTransactionsByType(type));
        }
}