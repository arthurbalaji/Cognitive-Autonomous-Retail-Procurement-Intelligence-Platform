package com.erp.application.repository;

import com.erp.application.entity.SalesOrder;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

public interface SalesOrderRepository extends JpaRepository<SalesOrder, Long> {

    List<SalesOrder> findByStatus(SalesOrder.SalesOrderStatus status);

    List<SalesOrder> findByCustomerId(Long customerId);

    List<SalesOrder> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end);

    @Query("SELECT COALESCE(SUM(s.totalAmount), 0) FROM SalesOrder s WHERE s.status != 'CANCELLED' AND s.createdAt BETWEEN ?1 AND ?2")
    BigDecimal sumRevenueByDateRange(LocalDateTime start, LocalDateTime end);

    @Query("SELECT COUNT(s) FROM SalesOrder s WHERE s.status = ?1 AND s.createdAt BETWEEN ?2 AND ?3")
    long countByStatusAndDateRange(SalesOrder.SalesOrderStatus status, LocalDateTime start, LocalDateTime end);
}
