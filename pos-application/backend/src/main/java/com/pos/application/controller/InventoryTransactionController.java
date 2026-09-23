package com.pos.application.controller;

import com.pos.application.entity.InventoryTransaction;
import com.pos.application.entity.InventoryTransactionType;
import com.pos.application.service.InventoryTransactionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/inventory")
@RequiredArgsConstructor
public class InventoryTransactionController {

        private final InventoryTransactionService inventoryTransactionService;

        @PostMapping("/transactions")
        public ResponseEntity<InventoryTransaction> recordTransaction(
                        @RequestParam Long productId,
                        @RequestParam InventoryTransactionType type,
                        @RequestParam Integer quantity,
                        @RequestParam(required = false) Long referenceId,
                        @RequestParam(required = false) String notes) {

                return ResponseEntity.ok(
                                inventoryTransactionService.recordTransaction(
                                                productId,
                                                type,
                                                quantity,
                                                referenceId,
                                                notes));
        }

        @GetMapping("/products/{productId}/transactions")
        public ResponseEntity<List<InventoryTransaction>> getProductHistory(
                        @PathVariable Long productId) {

                return ResponseEntity.ok(
                                inventoryTransactionService.getProductHistory(productId));
        }

        @GetMapping("/transactions/type/{type}")
        public ResponseEntity<List<InventoryTransaction>> getTransactionsByType(
                        @PathVariable InventoryTransactionType type) {

                return ResponseEntity.ok(
                                inventoryTransactionService.getTransactionsByType(type));
        }
}