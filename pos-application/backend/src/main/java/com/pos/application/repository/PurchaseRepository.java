package com.pos.application.repository;

import com.pos.application.entity.Purchase;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface PurchaseRepository
        extends JpaRepository<Purchase, Long> {

    boolean existsByInvoiceNumber(String invoiceNumber);

    Optional<Purchase> findByInvoiceNumber(String invoiceNumber);

    List<Purchase> findAllByOrderByCreatedAtDesc();

    List<Purchase> findBySupplierIdOrderByCreatedAtDesc(Long supplierId);

    List<Purchase> findByCreatedAtBetweenOrderByCreatedAtDesc(
            LocalDateTime start,
            LocalDateTime end);
}