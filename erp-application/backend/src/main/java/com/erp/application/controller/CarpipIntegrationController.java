package com.erp.application.controller;

import com.erp.application.entity.SalesOrder;
import com.erp.application.entity.WarehouseProduct;
import com.erp.application.repository.SalesOrderRepository;
import com.erp.application.repository.WarehouseProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * CARPIP Integration Controller.
 * Exposes REST endpoints that CARPIP's WholesalerErpAdapter calls
 * to sync inventory and sales data from this ERP system.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CarpipIntegrationController {

    private final WarehouseProductRepository productRepository;
    private final SalesOrderRepository salesOrderRepository;

    /**
     * Health check endpoint — CARPIP calls this to verify connectivity.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "erp-backend",
                "timestamp", LocalDateTime.now().toString()
        ));
    }

    /**
     * Warehouse stock endpoint — returns inventory in the schema that
     * CARPIP's WholesalerErpAdapter.syncInventory() expects:
     *   material_code, material_description, material_group,
     *   unit_cost, available_qty, safety_stock
     */
    @GetMapping("/warehouse/stock")
    public ResponseEntity<List<Map<String, Object>>> getWarehouseStock(
            @RequestParam(value = "warehouse_id", required = false) String warehouseId) {

        List<WarehouseProduct> products = productRepository.findByActiveTrue();
        List<Map<String, Object>> result = new ArrayList<>();

        for (WarehouseProduct p : products) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("material_code", p.getSku());
            item.put("material_description", p.getName());
            item.put("material_group", p.getCategory() != null ? p.getCategory().getName() : "General");
            item.put("unit_cost", p.getUnitCost());
            item.put("available_qty", p.getStockQuantity());
            item.put("safety_stock", p.getReorderLevel());
            item.put("warehouse_location", p.getWarehouseLocation());
            item.put("unit", p.getUnit());
            result.add(item);
        }

        return ResponseEntity.ok(result);
    }

    /**
     * Sales orders endpoint — returns confirmed sales orders in the schema that
     * CARPIP's WholesalerErpAdapter.fetchSales() expects:
     *   sales_order_number, material_code, order_qty, net_amount, order_date
     */
    @GetMapping("/sales-orders")
    public ResponseEntity<List<Map<String, Object>>> getSalesOrders(
            @RequestParam(value = "status", required = false, defaultValue = "confirmed") String status,
            @RequestParam(value = "limit", required = false, defaultValue = "50") int limit) {

        List<SalesOrder> orders;
        try {
            SalesOrder.SalesOrderStatus orderStatus = SalesOrder.SalesOrderStatus.valueOf(status.toUpperCase());
            orders = salesOrderRepository.findByStatus(orderStatus);
        } catch (IllegalArgumentException e) {
            orders = salesOrderRepository.findAll();
        }

        List<Map<String, Object>> result = new ArrayList<>();

        for (SalesOrder order : orders.stream().limit(limit).toList()) {
            for (var item : order.getItems()) {
                Map<String, Object> sale = new LinkedHashMap<>();
                sale.put("sales_order_number", order.getOrderNumber());
                sale.put("material_code", item.getProduct().getSku());
                sale.put("order_qty", item.getQuantity());
                sale.put("net_amount", item.getTotalPrice());
                sale.put("order_date", order.getCreatedAt().toString());
                sale.put("customer", order.getCustomer() != null ? order.getCustomer().getCompanyName() : "Walk-in");
                result.add(sale);
            }
        }

        return ResponseEntity.ok(result);
    }

    /**
     * Receive order from CARPIP auto-procurement.
     * CARPIP can push purchase orders to this ERP for fulfillment.
     */
    @PostMapping("/orders/receive")
    public ResponseEntity<Map<String, Object>> receiveOrder(@RequestBody Map<String, Object> orderData) {
        return ResponseEntity.ok(Map.of(
                "received", true,
                "message", "Order received by ERP system",
                "timestamp", LocalDateTime.now().toString()
        ));
    }
}
