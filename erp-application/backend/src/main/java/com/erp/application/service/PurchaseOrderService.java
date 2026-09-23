package com.erp.application.service;

import com.erp.application.entity.*;
import com.erp.application.repository.InventoryTransactionRepository;
import com.erp.application.repository.PurchaseOrderItemRepository;
import com.erp.application.repository.PurchaseOrderRepository;
import com.erp.application.repository.WarehouseProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class PurchaseOrderService {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final PurchaseOrderItemRepository purchaseOrderItemRepository;
    private final WarehouseProductRepository productRepository;
    private final InventoryTransactionRepository inventoryTransactionRepository;

    public List<PurchaseOrder> getAllOrders() {
        return purchaseOrderRepository.findAll();
    }

    public PurchaseOrder getOrderById(Long id) {
        return purchaseOrderRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Purchase order not found with id: " + id));
    }

    public List<PurchaseOrder> getOrdersByStatus(PurchaseOrder.PurchaseOrderStatus status) {
        return purchaseOrderRepository.findByStatus(status);
    }

    @Transactional
    public PurchaseOrder createOrder(PurchaseOrder order, List<PurchaseItemRequest> itemRequests) {
        order.setPoNumber("PO-" + System.currentTimeMillis());
        order.setCreatedAt(LocalDateTime.now());

        BigDecimal subtotal = BigDecimal.ZERO;

        PurchaseOrder savedOrder = purchaseOrderRepository.save(order);

        for (PurchaseItemRequest req : itemRequests) {
            WarehouseProduct product = productRepository.findById(req.productId())
                    .orElseThrow(() -> new RuntimeException("Product not found: " + req.productId()));

            BigDecimal unitCost = product.getUnitCost();
            BigDecimal totalCost = unitCost.multiply(BigDecimal.valueOf(req.quantity()));

            PurchaseOrderItem item = PurchaseOrderItem.builder()
                    .purchaseOrder(savedOrder)
                    .product(product)
                    .quantity(req.quantity())
                    .unitCost(unitCost)
                    .totalCost(totalCost)
                    .build();

            purchaseOrderItemRepository.save(item);
            savedOrder.getItems().add(item);
            subtotal = subtotal.add(totalCost);
        }

        BigDecimal taxAmount = subtotal.multiply(BigDecimal.valueOf(0.18));
        savedOrder.setSubtotal(subtotal);
        savedOrder.setTaxAmount(taxAmount);
        savedOrder.setTotalAmount(subtotal.add(taxAmount));

        return purchaseOrderRepository.save(savedOrder);
    }

    @Transactional
    public PurchaseOrder receiveGoods(Long id) {
        PurchaseOrder order = getOrderById(id);

        if (order.getStatus() != PurchaseOrder.PurchaseOrderStatus.ORDERED) {
            throw new RuntimeException("Can only receive goods for orders in ORDERED status");
        }

        for (PurchaseOrderItem item : order.getItems()) {
            WarehouseProduct product = item.getProduct();
            product.setStockQuantity(product.getStockQuantity() + item.getQuantity());
            productRepository.save(product);

            inventoryTransactionRepository.save(InventoryTransaction.builder()
                    .product(product)
                    .type(InventoryTransaction.InventoryTransactionType.INBOUND)
                    .quantity(item.getQuantity())
                    .referenceNumber(order.getPoNumber())
                    .notes("Goods received from purchase order")
                    .build());
        }

        order.setStatus(PurchaseOrder.PurchaseOrderStatus.RECEIVED);
        return purchaseOrderRepository.save(order);
    }

    @Transactional
    public PurchaseOrder updateStatus(Long id, PurchaseOrder.PurchaseOrderStatus newStatus) {
        PurchaseOrder order = getOrderById(id);
        order.setStatus(newStatus);
        return purchaseOrderRepository.save(order);
    }

    public record PurchaseItemRequest(Long productId, int quantity) {}
}
