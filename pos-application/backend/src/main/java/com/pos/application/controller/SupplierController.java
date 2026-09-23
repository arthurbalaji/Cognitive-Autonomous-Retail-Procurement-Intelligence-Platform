package com.pos.application.controller;

import com.pos.application.entity.Supplier;
import com.pos.application.service.SupplierService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/suppliers")
@RequiredArgsConstructor
public class SupplierController {

    private final SupplierService supplierService;

    @PostMapping
    public ResponseEntity<Supplier> createSupplier(
            @Valid @RequestBody Supplier supplier) {

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(supplierService.createSupplier(supplier));
    }

    @GetMapping
    public ResponseEntity<List<Supplier>> getSuppliers(
            @RequestParam(required = false) String query) {

        if (query != null && !query.isBlank()) {
            return ResponseEntity.ok(
                    supplierService.searchSuppliers(query));
        }

        return ResponseEntity.ok(
                supplierService.getAllSuppliers());
    }

    @GetMapping("/active")
    public ResponseEntity<List<Supplier>> getActiveSuppliers() {

        return ResponseEntity.ok(
                supplierService.getActiveSuppliers());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Supplier> getSupplier(
            @PathVariable Long id) {

        return ResponseEntity.ok(
                supplierService.getSupplierById(id));
    }

    @GetMapping("/phone/{phone}")
    public ResponseEntity<Supplier> getSupplierByPhone(
            @PathVariable String phone) {

        return ResponseEntity.ok(
                supplierService.getSupplierByPhone(phone));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Supplier> updateSupplier(
            @PathVariable Long id,
            @Valid @RequestBody Supplier supplier) {

        return ResponseEntity.ok(
                supplierService.updateSupplier(id, supplier));
    }

    @PutMapping("/{id}/deactivate")
    public ResponseEntity<Supplier> deactivateSupplier(
            @PathVariable Long id) {

        return ResponseEntity.ok(
                supplierService.deactivateSupplier(id));
    }

    @PutMapping("/{id}/activate")
    public ResponseEntity<Supplier> activateSupplier(
            @PathVariable Long id) {

        return ResponseEntity.ok(
                supplierService.activateSupplier(id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSupplier(
            @PathVariable Long id) {

        supplierService.deleteSupplier(id);

        return ResponseEntity.noContent().build();
    }
}