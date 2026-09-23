package com.pos.application.controller;

import com.pos.application.service.DashboardService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    @GetMapping("/today")
    public ResponseEntity<DashboardService.DashboardSummary> getTodaySummary() {

        return ResponseEntity.ok(
                dashboardService.getTodaySummary());
    }
}