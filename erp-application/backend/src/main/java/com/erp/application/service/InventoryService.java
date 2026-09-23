package com.erp.application.service;

import com.erp.application.entity.InventoryTransaction;
import com.erp.application.entity.WarehouseProduct;
import com.erp.application.repository.InventoryTransactionRepository;
import com.erp.application.repository.WarehouseProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class InventoryService {

    private final InventoryTransactionRepository transactionRepository;
    private final WarehouseProductRepository productRepository;

    public List<InventoryTransaction> getAllTransactions() {
        return transactionRepository.findAllByOrderByCreatedAtDesc();
    }

    public List<InventoryTransaction> getTransactionsByProduct(Long productId) {
        return transactionRepository.findByProductIdOrderByCreatedAtDesc(productId);
    }

    @Transactional
    public InventoryTransaction createAdjustment(Long productId, int quantity, String notes) {
        WarehouseProduct product = productRepository.findById(productId)
                .orElseThrow(() -> new RuntimeException("Product not found: " + productId));

        product.setStockQuantity(product.getStockQuantity() + quantity);
        productRepository.save(product);

        InventoryTransaction.InventoryTransactionType type = quantity >= 0
                ? InventoryTransaction.InventoryTransactionType.ADJUSTMENT
                : InventoryTransaction.InventoryTransactionType.ADJUSTMENT;

        return transactionRepository.save(InventoryTransaction.builder()
                .product(product)
                .type(type)
                .quantity(quantity)
                .referenceNumber("ADJ-" + System.currentTimeMillis())
                .notes(notes != null ? notes : "Manual stock adjustment")
                .build());
    }
}
