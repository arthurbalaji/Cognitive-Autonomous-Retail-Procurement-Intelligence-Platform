package com.erp.application.repository;

import com.erp.application.entity.Shipment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ShipmentRepository extends JpaRepository<Shipment, Long> {

    List<Shipment> findBySalesOrderId(Long salesOrderId);

    List<Shipment> findByStatus(Shipment.ShipmentStatus status);
}
