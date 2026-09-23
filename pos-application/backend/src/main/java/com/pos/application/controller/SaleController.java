package com.pos.application.controller;

import com.pos.application.entity.PaymentMethod;
import com.pos.application.entity.Sale;
import com.pos.application.repository.SaleRepository;
import com.pos.application.service.SaleService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/sales")
@RequiredArgsConstructor
public class SaleController {

        private final SaleService saleService;
        private final SaleRepository saleRepository;

        @GetMapping("/date-range")
        public ResponseEntity<List<Sale>> getSalesByDateRange(
                        @RequestParam String start,
                        @RequestParam String end) {

                LocalDateTime startDateTime = LocalDate.parse(start).atStartOfDay();
                LocalDateTime endDateTime = LocalDate.parse(end).plusDays(1).atStartOfDay();

                return ResponseEntity.ok(
                                saleRepository.findSalesBetween(
                                                startDateTime,
                                                endDateTime));
        }

        @GetMapping("/{id}")
        public ResponseEntity<Sale> getSale(@PathVariable Long id) {

                return saleService.getSaleById(id)
                                .map(ResponseEntity::ok)
                                .orElse(ResponseEntity.notFound().build());
        }

        @GetMapping
        public ResponseEntity<List<Sale>> getAllSales(
                        @RequestParam(required = false) String status) {

                if (status == null || status.isBlank()) {
                        return ResponseEntity.ok(
                                        saleRepository.findAllByOrderByCreatedAtDesc());
                }

                return ResponseEntity.ok(
                                saleRepository.findByStatusOrderByCreatedAtDesc(
                                                status.toUpperCase()));
        }

        @GetMapping("/invoice/{invoiceNumber}")
        public ResponseEntity<Sale> getSaleByInvoiceNumber(
                        @PathVariable String invoiceNumber) {

                return saleRepository.findByInvoiceNumber(invoiceNumber)
                                .map(ResponseEntity::ok)
                                .orElse(ResponseEntity.notFound().build());
        }

        @PostMapping
        public ResponseEntity<Sale> createSale(
                        @RequestParam String invoiceNumber,
                        @RequestParam PaymentMethod paymentMethod,
                        @RequestParam(required = false) Long customerId,
                        @Valid @RequestBody List<SaleService.SaleRequestItem> requestItems) {

                return ResponseEntity
                                .status(HttpStatus.CREATED)
                                .body(
                                                saleService.createSale(
                                                                invoiceNumber,
                                                                paymentMethod,
                                                                customerId,
                                                                requestItems));
        }

        @PutMapping("/{id}/cancel")
        public ResponseEntity<Sale> cancelSale(
                        @PathVariable Long id) {

                Sale cancelledSale = saleService.cancelSale(id);

                return ResponseEntity.ok(cancelledSale);
        }
}