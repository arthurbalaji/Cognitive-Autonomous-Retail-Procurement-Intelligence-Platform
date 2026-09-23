package com.pos.application.controller;

import com.pos.application.entity.Customer;
import com.pos.application.entity.Sale;
import com.pos.application.service.CustomerService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/customers")
@RequiredArgsConstructor
public class CustomerController {

        private final CustomerService customerService;

        @PostMapping
        public ResponseEntity<Customer> createCustomer(
                        @Valid @RequestBody Customer customer) {

                return ResponseEntity
                                .status(HttpStatus.CREATED)
                                .body(customerService.createCustomer(customer));
        }

        @GetMapping
        public ResponseEntity<List<Customer>> getCustomers(
                        @RequestParam(required = false) String name) {

                if (name != null && !name.isBlank()) {
                        return ResponseEntity.ok(
                                        customerService.searchCustomers(name));
                }

                return ResponseEntity.ok(
                                customerService.getAllCustomers());
        }

        @GetMapping("/active")
        public ResponseEntity<List<Customer>> getActiveCustomers() {
                return ResponseEntity.ok(
                                customerService.getActiveCustomers());
        }

        @GetMapping("/{id}/sales")
        public ResponseEntity<List<Sale>> getCustomerSales(
                        @PathVariable Long id) {

                return ResponseEntity.ok(
                                customerService.getCustomerSales(id));
        }

        @GetMapping("/{id}")
        public ResponseEntity<Customer> getCustomer(
                        @PathVariable Long id) {

                return ResponseEntity.ok(
                                customerService.getCustomerById(id));
        }

        @GetMapping("/phone/{phone}")
        public ResponseEntity<Customer> getCustomerByPhone(
                        @PathVariable String phone) {

                return ResponseEntity.ok(
                                customerService.getCustomerByPhone(phone));
        }

        @GetMapping("/search")
        public ResponseEntity<List<Customer>> searchCustomers(
                        @RequestParam String query) {

                return ResponseEntity.ok(
                                customerService.searchActiveCustomers(query));
        }

        @PutMapping("/{id}")
        public ResponseEntity<Customer> updateCustomer(
                        @PathVariable Long id,
                        @Valid @RequestBody Customer customer) {

                return ResponseEntity.ok(
                                customerService.updateCustomer(id, customer));
        }

        @PutMapping("/{id}/deactivate")
        public ResponseEntity<Customer> deactivateCustomer(
                        @PathVariable Long id) {

                return ResponseEntity.ok(
                                customerService.deactivateCustomer(id));
        }

        @PutMapping("/{id}/activate")
        public ResponseEntity<Customer> activateCustomer(
                        @PathVariable Long id) {

                return ResponseEntity.ok(
                                customerService.activateCustomer(id));
        }
}