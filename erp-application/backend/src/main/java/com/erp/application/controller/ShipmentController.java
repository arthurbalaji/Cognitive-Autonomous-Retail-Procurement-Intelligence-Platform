package com.erp.application.controller;

import com.erp.application.entity.Shipment;
import com.erp.application.service.ShipmentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/shipments")
@RequiredArgsConstructor
public class ShipmentController {

    private final ShipmentService shipmentService;

    @GetMapping
    public ResponseEntity<List<Shipment>> getAllShipments() {
        return ResponseEntity.ok(shipmentService.getAllShipments());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Shipment> getShipmentById(@PathVariable Long id) {
        return ResponseEntity.ok(shipmentService.getShipmentById(id));
    }

    @GetMapping("/order/{salesOrderId}")
    public ResponseEntity<List<Shipment>> getShipmentsBySalesOrder(@PathVariable Long salesOrderId) {
        return ResponseEntity.ok(shipmentService.getShipmentsBySalesOrder(salesOrderId));
    }

    @PostMapping
    public ResponseEntity<Shipment> createShipment(@RequestBody CreateShipmentRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(shipmentService.createShipment(request.salesOrderId(), request.trackingNumber(), request.carrier()));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<Shipment> updateStatus(@PathVariable Long id, @RequestBody StatusUpdate update) {
        return ResponseEntity.ok(shipmentService.updateStatus(id, Shipment.ShipmentStatus.valueOf(update.status())));
    }

    public record CreateShipmentRequest(Long salesOrderId, String trackingNumber, String carrier) {}

    public record StatusUpdate(String status) {}
}
