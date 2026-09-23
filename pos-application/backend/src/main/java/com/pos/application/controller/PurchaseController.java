package com.pos.application.controller;

import com.pos.application.entity.Purchase;
import com.pos.application.service.PurchaseService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/purchases")
@RequiredArgsConstructor
public class PurchaseController {

    private final PurchaseService purchaseService;

    @GetMapping
    public ResponseEntity<List<Purchase>> getAllPurchases() {
        return ResponseEntity.ok(
                purchaseService.getAllPurchases());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Purchase> getPurchase(
            @PathVariable Long id) {

        return purchaseService.getPurchaseById(id)
                .map(ResponseEntity::ok)
                .orElse(
                        ResponseEntity.notFound().build());
    }

    @GetMapping("/invoice/{invoiceNumber}")
    public ResponseEntity<Purchase> getPurchaseByInvoiceNumber(
            @PathVariable String invoiceNumber) {

        return purchaseService
                .getPurchaseByInvoiceNumber(invoiceNumber)
                .map(ResponseEntity::ok)
                .orElse(
                        ResponseEntity.notFound().build());
    }

    @GetMapping("/supplier/{supplierId}")
    public ResponseEntity<List<Purchase>> getPurchasesBySupplier(
            @PathVariable Long supplierId) {

        return ResponseEntity.ok(
                purchaseService.getPurchasesBySupplier(
                        supplierId));
    }

    @GetMapping("/date-range")
    public ResponseEntity<List<Purchase>> getPurchasesByDateRange(
            @RequestParam String start,
            @RequestParam String end) {

        LocalDateTime startDateTime = LocalDate.parse(start).atStartOfDay();

        LocalDateTime endDateTime = LocalDate.parse(end)
                .plusDays(1)
                .atStartOfDay();

        return ResponseEntity.ok(
                purchaseService.getPurchasesByDateRange(
                        startDateTime,
                        endDateTime));
    }

    @PostMapping
    public ResponseEntity<Purchase> createPurchase(
            @RequestParam String invoiceNumber,
            @RequestParam Long supplierId,
            @Valid @RequestBody List<PurchaseService.PurchaseRequestItem> requestItems) {

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(
                        purchaseService.createPurchase(
                                invoiceNumber,
                                supplierId,
                                requestItems));
    }
}