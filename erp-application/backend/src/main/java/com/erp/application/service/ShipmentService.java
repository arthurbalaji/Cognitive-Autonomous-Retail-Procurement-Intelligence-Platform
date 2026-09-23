package com.erp.application.service;

import com.erp.application.entity.SalesOrder;
import com.erp.application.entity.Shipment;
import com.erp.application.repository.SalesOrderRepository;
import com.erp.application.repository.ShipmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ShipmentService {

    private final ShipmentRepository shipmentRepository;
    private final SalesOrderRepository salesOrderRepository;

    public List<Shipment> getAllShipments() {
        return shipmentRepository.findAll();
    }

    public Shipment getShipmentById(Long id) {
        return shipmentRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Shipment not found with id: " + id));
    }

    public List<Shipment> getShipmentsBySalesOrder(Long salesOrderId) {
        return shipmentRepository.findBySalesOrderId(salesOrderId);
    }

    @Transactional
    public Shipment createShipment(Long salesOrderId, String trackingNumber, String carrier) {
        SalesOrder order = salesOrderRepository.findById(salesOrderId)
                .orElseThrow(() -> new RuntimeException("Sales order not found: " + salesOrderId));

        if (order.getStatus() != SalesOrder.SalesOrderStatus.CONFIRMED &&
                order.getStatus() != SalesOrder.SalesOrderStatus.PROCESSING) {
            throw new RuntimeException("Can only create shipments for CONFIRMED or PROCESSING orders");
        }

        order.setStatus(SalesOrder.SalesOrderStatus.SHIPPED);
        salesOrderRepository.save(order);

        return shipmentRepository.save(Shipment.builder()
                .salesOrder(order)
                .trackingNumber(trackingNumber)
                .carrier(carrier)
                .status(Shipment.ShipmentStatus.SHIPPED)
                .shippedAt(LocalDateTime.now())
                .build());
    }

    @Transactional
    public Shipment updateStatus(Long id, Shipment.ShipmentStatus newStatus) {
        Shipment shipment = getShipmentById(id);
        shipment.setStatus(newStatus);

        if (newStatus == Shipment.ShipmentStatus.DELIVERED) {
            shipment.setDeliveredAt(LocalDateTime.now());
            SalesOrder order = shipment.getSalesOrder();
            order.setStatus(SalesOrder.SalesOrderStatus.DELIVERED);
            salesOrderRepository.save(order);
        }

        return shipmentRepository.save(shipment);
    }
}
