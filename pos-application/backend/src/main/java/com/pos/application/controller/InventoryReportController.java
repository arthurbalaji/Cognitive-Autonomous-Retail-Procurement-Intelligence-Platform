package com.pos.application.controller;

import com.pos.application.service.InventoryReportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/reports")
@RequiredArgsConstructor
public class InventoryReportController {

    private final InventoryReportService inventoryReportService;

    @GetMapping("/inventory")
    public ResponseEntity<InventoryReportService.InventorySummary> getInventoryReport() {

        return ResponseEntity.ok(
                inventoryReportService.getInventorySummary());
    }
}