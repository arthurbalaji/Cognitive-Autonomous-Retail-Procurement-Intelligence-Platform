package com.erp.application.repository;

import com.erp.application.entity.PurchaseOrder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PurchaseOrderRepository extends JpaRepository<PurchaseOrder, Long> {

    List<PurchaseOrder> findByStatus(PurchaseOrder.PurchaseOrderStatus status);

    List<PurchaseOrder> findBySupplierId(Long supplierId);
}
