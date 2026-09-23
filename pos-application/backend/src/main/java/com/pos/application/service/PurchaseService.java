package com.pos.application.service;

import com.pos.application.entity.InventoryTransactionType;
import com.pos.application.entity.Product;
import com.pos.application.entity.Purchase;
import com.pos.application.entity.PurchaseItem;
import com.pos.application.entity.Supplier;
import com.pos.application.exception.BusinessException;
import com.pos.application.exception.ResourceNotFoundException;
import com.pos.application.repository.ProductRepository;
import com.pos.application.repository.PurchaseRepository;
import com.pos.application.repository.SupplierRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class PurchaseService {

    private final PurchaseRepository purchaseRepository;
    private final ProductRepository productRepository;
    private final SupplierRepository supplierRepository;
    private final InventoryTransactionService inventoryTransactionService;

    @Transactional
    public Purchase createPurchase(
            String invoiceNumber,
            Long supplierId,
            List<PurchaseRequestItem> requestItems) {

        if (invoiceNumber == null || invoiceNumber.isBlank()) {
            throw new BusinessException(
                    "Invoice number is required");
        }

        if (purchaseRepository.existsByInvoiceNumber(invoiceNumber)) {
            throw new BusinessException(
                    "Purchase invoice number already exists");
        }

        if (requestItems == null || requestItems.isEmpty()) {
            throw new BusinessException(
                    "Purchase must contain at least one product");
        }

        Supplier supplier = supplierRepository.findById(supplierId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Supplier not found"));

        if (!Boolean.TRUE.equals(supplier.getActive())) {
            throw new BusinessException(
                    "Supplier is inactive");
        }

        Purchase purchase = Purchase.builder()
                .invoiceNumber(invoiceNumber)
                .supplier(supplier)
                .subtotal(BigDecimal.ZERO)
                .taxAmount(BigDecimal.ZERO)
                .totalAmount(BigDecimal.ZERO)
                .status("COMPLETED")
                .build();

        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal taxAmount = BigDecimal.ZERO;

        for (PurchaseRequestItem requestItem : requestItems) {

            if (requestItem.productId() == null) {
                throw new BusinessException(
                        "Product ID is required");
            }

            if (requestItem.quantity() == null
                    || requestItem.quantity() <= 0) {
                throw new BusinessException(
                        "Quantity must be greater than zero");
            }

            if (requestItem.unitPrice() == null
                    || requestItem.unitPrice().compareTo(BigDecimal.ZERO) < 0) {
                throw new BusinessException(
                        "Purchase price cannot be negative");
            }

            Product product = productRepository
                    .findById(requestItem.productId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Product not found"));

            if (!Boolean.TRUE.equals(product.getActive())) {
                throw new BusinessException(
                        "Product is inactive: " + product.getName());
            }

            BigDecimal unitPrice = requestItem.unitPrice()
                    .setScale(2, RoundingMode.HALF_UP);

            BigDecimal itemSubtotal = unitPrice
                    .multiply(
                            BigDecimal.valueOf(
                                    requestItem.quantity()));

            BigDecimal taxRate = product.getTaxRate() == null
                    ? BigDecimal.ZERO
                    : product.getTaxRate();

            BigDecimal itemTax = itemSubtotal
                    .multiply(taxRate)
                    .divide(
                            BigDecimal.valueOf(100),
                            2,
                            RoundingMode.HALF_UP);

            BigDecimal itemTotal = itemSubtotal.add(itemTax);

            PurchaseItem purchaseItem = PurchaseItem.builder()
                    .purchase(purchase)
                    .product(product)
                    .quantity(requestItem.quantity())
                    .unitPrice(unitPrice)
                    .taxAmount(itemTax)
                    .totalAmount(itemTotal)
                    .build();

            purchase.getItems().add(purchaseItem);

            subtotal = subtotal.add(itemSubtotal);
            taxAmount = taxAmount.add(itemTax);

            // Increase stock immediately.
            product.setStockQuantity(
                    product.getStockQuantity()
                            + requestItem.quantity());

            productRepository.save(product);
        }

        purchase.setSubtotal(subtotal);
        purchase.setTaxAmount(taxAmount);
        purchase.setTotalAmount(
                subtotal.add(taxAmount));

        Purchase savedPurchase = purchaseRepository.save(purchase);

        // Record inventory transactions after purchase is saved.
        for (PurchaseItem item : savedPurchase.getItems()) {

            inventoryTransactionService.recordTransaction(
                    item.getProduct().getId(),
                    InventoryTransactionType.PURCHASE,
                    item.getQuantity(),
                    savedPurchase.getId(),
                    "Purchase " +
                            savedPurchase.getInvoiceNumber());
        }

        return savedPurchase;
    }

    @Transactional(readOnly = true)
    public List<Purchase> getAllPurchases() {
        return purchaseRepository
                .findAllByOrderByCreatedAtDesc();
    }

    @Transactional(readOnly = true)
    public Optional<Purchase> getPurchaseById(Long id) {
        return purchaseRepository.findById(id);
    }

    @Transactional(readOnly = true)
    public Optional<Purchase> getPurchaseByInvoiceNumber(
            String invoiceNumber) {

        return purchaseRepository
                .findByInvoiceNumber(invoiceNumber);
    }

    @Transactional(readOnly = true)
    public List<Purchase> getPurchasesBySupplier(
            Long supplierId) {

        if (!supplierRepository.existsById(supplierId)) {
            throw new ResourceNotFoundException(
                    "Supplier not found");
        }

        return purchaseRepository
                .findBySupplierIdOrderByCreatedAtDesc(
                        supplierId);
    }

    @Transactional(readOnly = true)
    public List<Purchase> getPurchasesByDateRange(
            LocalDateTime start,
            LocalDateTime end) {

        return purchaseRepository
                .findByCreatedAtBetweenOrderByCreatedAtDesc(
                        start,
                        end);
    }

    public record PurchaseRequestItem(
            Long productId,
            Integer quantity,
            BigDecimal unitPrice) {
    }
}