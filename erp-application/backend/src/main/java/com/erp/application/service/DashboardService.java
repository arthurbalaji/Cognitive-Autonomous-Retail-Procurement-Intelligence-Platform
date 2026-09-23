package com.erp.application.service;

import com.erp.application.entity.SalesOrder;
import com.erp.application.entity.Shipment;
import com.erp.application.entity.WarehouseProduct;
import com.erp.application.repository.SalesOrderRepository;
import com.erp.application.repository.ShipmentRepository;
import com.erp.application.repository.WarehouseProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class DashboardService {

    private final SalesOrderRepository salesOrderRepository;
    private final WarehouseProductRepository productRepository;
    private final ShipmentRepository shipmentRepository;

    public Map<String, Object> getTodayDashboard() {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        LocalDateTime endOfDay = startOfDay.plusDays(1);

        Map<String, Object> dashboard = new HashMap<>();

        BigDecimal revenue = salesOrderRepository.sumRevenueByDateRange(startOfDay, endOfDay);
        dashboard.put("revenue", revenue);

        long confirmedOrders = salesOrderRepository.countByStatusAndDateRange(
                SalesOrder.SalesOrderStatus.CONFIRMED, startOfDay, endOfDay);
        long shippedOrders = salesOrderRepository.countByStatusAndDateRange(
                SalesOrder.SalesOrderStatus.SHIPPED, startOfDay, endOfDay);
        long cancelledOrders = salesOrderRepository.countByStatusAndDateRange(
                SalesOrder.SalesOrderStatus.CANCELLED, startOfDay, endOfDay);
        long pendingOrders = salesOrderRepository.countByStatusAndDateRange(
                SalesOrder.SalesOrderStatus.DRAFT, startOfDay, endOfDay);

        dashboard.put("confirmedOrders", confirmedOrders);
        dashboard.put("shippedOrders", shippedOrders);
        dashboard.put("cancelledOrders", cancelledOrders);
        dashboard.put("pendingOrders", pendingOrders);

        List<WarehouseProduct> allProducts = productRepository.findByActiveTrue();
        dashboard.put("totalProducts", allProducts.size());

        List<WarehouseProduct> lowStock = allProducts.stream()
                .filter(p -> p.getStockQuantity() <= p.getReorderLevel())
                .toList();
        dashboard.put("lowStockProducts", lowStock);
        dashboard.put("lowStockCount", lowStock.size());

        List<Shipment> activeShipments = shipmentRepository.findByStatus(Shipment.ShipmentStatus.SHIPPED);
        activeShipments.addAll(shipmentRepository.findByStatus(Shipment.ShipmentStatus.IN_TRANSIT));
        dashboard.put("activeShipments", activeShipments.size());

        return dashboard;
    }
}
