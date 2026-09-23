package com.pos.application.repository;

import com.pos.application.entity.Sale;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface SaleRepository extends JpaRepository<Sale, Long> {

    Optional<Sale> findByInvoiceNumber(String invoiceNumber);

    boolean existsByInvoiceNumber(String invoiceNumber);

    List<Sale> findByStatusOrderByCreatedAtDesc(String status);

    List<Sale> findAllByOrderByCreatedAtDesc();

    @Query("""
                SELECT COALESCE(SUM(s.totalAmount), 0)
                FROM Sale s
                WHERE s.status = 'COMPLETED'
                AND s.createdAt >= :start
                AND s.createdAt < :end
            """)
    BigDecimal getTotalRevenueBetween(
            LocalDateTime start,
            LocalDateTime end);

    @Query("""
                SELECT COUNT(s)
                FROM Sale s
                WHERE s.status = 'COMPLETED'
                AND s.createdAt >= :start
                AND s.createdAt < :end
            """)
    long countCompletedSalesBetween(
            LocalDateTime start,
            LocalDateTime end);

    @Query("""
                SELECT COUNT(s)
                FROM Sale s
                WHERE s.status = 'CANCELLED'
                AND s.createdAt >= :start
                AND s.createdAt < :end
            """)
    long countCancelledSalesBetween(
            LocalDateTime start,
            LocalDateTime end);

    @Query("""
                SELECT s
                FROM Sale s
                WHERE s.createdAt >= :start
                AND s.createdAt < :end
                ORDER BY s.createdAt DESC
            """)
    List<Sale> findSalesBetween(
            LocalDateTime start,
            LocalDateTime end);

    @Query("""
                SELECT s
                FROM Sale s
                WHERE s.customer.id = :customerId
                ORDER BY s.createdAt DESC
            """)
    List<Sale> findByCustomerIdOrderByCreatedAtDesc(Long customerId);

    List<Sale> findByCreatedAtAfter(LocalDateTime cutoff);
}