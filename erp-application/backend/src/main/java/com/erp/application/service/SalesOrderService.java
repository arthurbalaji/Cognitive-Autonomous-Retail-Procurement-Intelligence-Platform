package com.erp.application.service;

import com.erp.application.entity.*;
import com.erp.application.repository.InventoryTransactionRepository;
import com.erp.application.repository.SalesOrderItemRepository;
import com.erp.application.repository.SalesOrderRepository;
import com.erp.application.repository.WarehouseProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class SalesOrderService {

    private final SalesOrderRepository salesOrderRepository;
    private final SalesOrderItemRepository salesOrderItemRepository;
    private final WarehouseProductRepository productRepository;
    private final InventoryTransactionRepository inventoryTransactionRepository;

    public List<SalesOrder> getAllOrders() {
        return salesOrderRepository.findAll();
    }

    public SalesOrder getOrderById(Long id) {
        return salesOrderRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Sales order not found with id: " + id));
    }

    public List<SalesOrder> getOrdersByStatus(SalesOrder.SalesOrderStatus status) {
        return salesOrderRepository.findByStatus(status);
    }

    public List<SalesOrder> getOrdersByCustomer(Long customerId) {
        return salesOrderRepository.findByCustomerId(customerId);
    }

    @Transactional
    public SalesOrder createOrder(SalesOrder order, List<OrderItemRequest> itemRequests) {
        order.setOrderNumber("SO-" + System.currentTimeMillis());
        order.setCreatedAt(LocalDateTime.now());

        BigDecimal subtotal = BigDecimal.ZERO;

        SalesOrder savedOrder = salesOrderRepository.save(order);

        for (OrderItemRequest req : itemRequests) {
            WarehouseProduct product = productRepository.findById(req.productId())
                    .orElseThrow(() -> new RuntimeException("Product not found: " + req.productId()));

            BigDecimal unitPrice = product.getSellingPrice();
            BigDecimal totalPrice = unitPrice.multiply(BigDecimal.valueOf(req.quantity()));

            SalesOrderItem item = SalesOrderItem.builder()
                    .salesOrder(savedOrder)
                    .product(product)
                    .quantity(req.quantity())
                    .unitPrice(unitPrice)
                    .totalPrice(totalPrice)
                    .build();

            salesOrderItemRepository.save(item);
            savedOrder.getItems().add(item);
            subtotal = subtotal.add(totalPrice);
        }

        BigDecimal taxAmount = subtotal.multiply(BigDecimal.valueOf(0.18));
        savedOrder.setSubtotal(subtotal);
        savedOrder.setTaxAmount(taxAmount);
        savedOrder.setTotalAmount(subtotal.add(taxAmount));

        return salesOrderRepository.save(savedOrder);
    }

    @Transactional
    public SalesOrder updateStatus(Long id, SalesOrder.SalesOrderStatus newStatus) {
        SalesOrder order = getOrderById(id);
        SalesOrder.SalesOrderStatus oldStatus = order.getStatus();
        order.setStatus(newStatus);

        // Deduct stock when confirmed
        if (newStatus == SalesOrder.SalesOrderStatus.CONFIRMED && oldStatus == SalesOrder.SalesOrderStatus.DRAFT) {
            for (SalesOrderItem item : order.getItems()) {
                WarehouseProduct product = item.getProduct();
                if (product.getStockQuantity() < item.getQuantity()) {
                    throw new RuntimeException("Insufficient stock for " + product.getName()
                            + ". Available: " + product.getStockQuantity() + ", Requested: " + item.getQuantity());
                }
                product.setStockQuantity(product.getStockQuantity() - item.getQuantity());
                productRepository.save(product);

                inventoryTransactionRepository.save(InventoryTransaction.builder()
                        .product(product)
                        .type(InventoryTransaction.InventoryTransactionType.OUTBOUND)
                        .quantity(item.getQuantity())
                        .referenceNumber(order.getOrderNumber())
                        .notes("Sales order confirmed")
                        .build());
            }
        }

        // Restore stock when cancelled
        if (newStatus == SalesOrder.SalesOrderStatus.CANCELLED &&
                (oldStatus == SalesOrder.SalesOrderStatus.CONFIRMED || oldStatus == SalesOrder.SalesOrderStatus.PROCESSING)) {
            for (SalesOrderItem item : order.getItems()) {
                WarehouseProduct product = item.getProduct();
                product.setStockQuantity(product.getStockQuantity() + item.getQuantity());
                productRepository.save(product);

                inventoryTransactionRepository.save(InventoryTransaction.builder()
                        .product(product)
                        .type(InventoryTransaction.InventoryTransactionType.INBOUND)
                        .quantity(item.getQuantity())
                        .referenceNumber(order.getOrderNumber())
                        .notes("Sales order cancelled — stock restored")
                        .build());
            }
        }

        return salesOrderRepository.save(order);
    }

    public record OrderItemRequest(Long productId, int quantity) {}
}
