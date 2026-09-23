package com.pos.application.service;

import com.pos.application.entity.InventoryTransaction;
import com.pos.application.entity.InventoryTransactionType;
import com.pos.application.entity.Product;
import com.pos.application.exception.BusinessException;
import com.pos.application.exception.ResourceNotFoundException;
import com.pos.application.repository.InventoryTransactionRepository;
import com.pos.application.repository.ProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class InventoryTransactionService {

        private final InventoryTransactionRepository inventoryTransactionRepository;
        private final ProductRepository productRepository;

        @Transactional
        public InventoryTransaction recordTransaction(
                        Long productId,
                        InventoryTransactionType type,
                        Integer quantity,
                        Long referenceId,
                        String notes) {

                Product product = productRepository.findById(productId)
                                .orElseThrow(() -> new ResourceNotFoundException("Product not found"));

                if (type == null) {
                        throw new BusinessException(
                                        "Inventory transaction type is required");
                }

                if (quantity == null || quantity <= 0) {
                        throw new BusinessException(
                                        "Quantity must be greater than zero");
                }

                int stockChange;

                if (type == InventoryTransactionType.PURCHASE
                                || type == InventoryTransactionType.SALES_RETURN) {

                        stockChange = quantity;

                } else {

                        stockChange = -quantity;
                }

                int newStock = product.getStockQuantity() + stockChange;

                if (newStock < 0) {
                        throw new BusinessException("Insufficient stock");
                }

                product.setStockQuantity(newStock);
                productRepository.save(product);

                InventoryTransaction transaction = InventoryTransaction.builder()
                                .product(product)
                                .type(type)
                                .quantity(quantity)
                                .referenceId(referenceId)
                                .notes(notes)
                                .build();

                return inventoryTransactionRepository.save(transaction);
        }

        @Transactional
        public InventoryTransaction adjustStock(
                        Long productId,
                        Integer quantity,
                        String notes) {

                Product product = productRepository.findById(productId)
                                .orElseThrow(() -> new ResourceNotFoundException("Product not found"));

                if (quantity == null || quantity == 0) {
                        throw new BusinessException(
                                        "Adjustment quantity cannot be zero");
                }

                int newStock = product.getStockQuantity() + quantity;

                if (newStock < 0) {
                        throw new BusinessException(
                                        "Adjustment would result in negative stock");
                }

                product.setStockQuantity(newStock);
                productRepository.save(product);

                String adjustmentNote = (quantity > 0 ? "Stock increase: +" : "Stock decrease: ")
                                + quantity
                                + (notes != null && !notes.isBlank()
                                                ? " - " + notes
                                                : "");

                InventoryTransaction transaction = InventoryTransaction.builder()
                                .product(product)
                                .type(InventoryTransactionType.ADJUSTMENT)
                                .quantity(Math.abs(quantity))
                                .referenceId(null)
                                .notes(adjustmentNote)
                                .build();

                return inventoryTransactionRepository.save(transaction);
        }

        @Transactional(readOnly = true)
        public List<InventoryTransaction> getProductHistory(
                        Long productId) {

                if (!productRepository.existsById(productId)) {
                        throw new ResourceNotFoundException(
                                        "Product not found");
                }

                return inventoryTransactionRepository
                                .findByProductIdOrderByCreatedAtDesc(productId);
        }

        @Transactional(readOnly = true)
        public List<InventoryTransaction> getTransactionsByType(
                        InventoryTransactionType type) {

                if (type == null) {
                        throw new BusinessException(
                                        "Transaction type is required");
                }

                return inventoryTransactionRepository
                                .findByTypeOrderByCreatedAtDesc(type);
        }
}