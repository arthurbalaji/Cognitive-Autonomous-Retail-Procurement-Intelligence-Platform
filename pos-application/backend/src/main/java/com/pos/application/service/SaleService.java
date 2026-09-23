package com.pos.application.service;

import com.pos.application.entity.*;
import com.pos.application.repository.ProductRepository;
import com.pos.application.repository.SaleRepository;
import com.pos.application.repository.CustomerRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pos.application.exception.BusinessException;
import com.pos.application.exception.ResourceNotFoundException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

@Service
@RequiredArgsConstructor
public class SaleService {

    private final SaleRepository saleRepository;
    private final ProductRepository productRepository;
    private final CustomerRepository customerRepository;
    private final InventoryTransactionService inventoryTransactionService;

    @Transactional
    public Sale createSale(
            String invoiceNumber,
            PaymentMethod paymentMethod,
            Long customerId,
            List<SaleRequestItem> requestItems) {

        if (saleRepository.existsByInvoiceNumber(invoiceNumber)) {
            throw new BusinessException("Invoice number already exists");
        }

        if (requestItems == null || requestItems.isEmpty()) {
            throw new BusinessException("Sale must contain at least one product");
        }

        Customer customer = null;

        if (customerId != null) {
            customer = customerRepository.findById(customerId)
                    .orElseThrow(() -> new ResourceNotFoundException("Customer not found"));

            if (!Boolean.TRUE.equals(customer.getActive())) {
                throw new BusinessException("Customer is inactive");
            }
        }
        Sale sale = Sale.builder()
                .invoiceNumber(invoiceNumber)
                .paymentMethod(paymentMethod)
                .customer(customer)
                .subtotal(BigDecimal.ZERO)
                .taxAmount(BigDecimal.ZERO)
                .totalAmount(BigDecimal.ZERO)
                .build();

        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal taxAmount = BigDecimal.ZERO;

        for (SaleRequestItem requestItem : requestItems) {

            Product product = productRepository.findById(requestItem.productId())
                    .orElseThrow(() -> new ResourceNotFoundException("Product not found"));

            if (requestItem.quantity() <= 0) {
                throw new BusinessException("Quantity must be greater than zero");
            }

            if (product.getStockQuantity() < requestItem.quantity()) {
                throw new BusinessException(
                        "Insufficient stock for product: " + product.getName());
            }

            BigDecimal unitPrice = product.getSellingPrice();

            BigDecimal itemSubtotal = unitPrice
                    .multiply(BigDecimal.valueOf(requestItem.quantity()));

            BigDecimal itemTax = itemSubtotal
                    .multiply(product.getTaxRate())
                    .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);

            BigDecimal itemTotal = itemSubtotal.add(itemTax);

            SaleItem saleItem = SaleItem.builder()
                    .sale(sale)
                    .product(product)
                    .quantity(requestItem.quantity())
                    .unitPrice(unitPrice)
                    .taxAmount(itemTax)
                    .totalAmount(itemTotal)
                    .build();

            sale.getItems().add(saleItem);

            subtotal = subtotal.add(itemSubtotal);
            taxAmount = taxAmount.add(itemTax);
        }

        sale.setSubtotal(subtotal);
        sale.setTaxAmount(taxAmount);
        sale.setTotalAmount(subtotal.add(taxAmount));

        Sale savedSale = saleRepository.save(sale);

        for (SaleItem item : savedSale.getItems()) {
            inventoryTransactionService.recordTransaction(
                    item.getProduct().getId(),
                    InventoryTransactionType.SALE,
                    item.getQuantity(),
                    savedSale.getId(),
                    "Sale " + savedSale.getInvoiceNumber());
        }

        return savedSale;
    }

    @Transactional(readOnly = true)
    public java.util.Optional<Sale> getSaleById(Long id) {
        return saleRepository.findById(id);
    }

    public record SaleRequestItem(
            @jakarta.validation.constraints.NotNull(message = "Product ID is required") Long productId,

            @jakarta.validation.constraints.NotNull(message = "Quantity is required") @jakarta.validation.constraints.Positive(message = "Quantity must be greater than zero") Integer quantity) {
    }

    @Transactional
    public Sale cancelSale(Long saleId) {

        Sale sale = saleRepository.findById(saleId)
                .orElseThrow(() -> new ResourceNotFoundException("Sale not found"));

        if ("CANCELLED".equals(sale.getStatus())) {
            throw new BusinessException("Sale is already cancelled");
        }

        for (SaleItem item : sale.getItems()) {

            inventoryTransactionService.recordTransaction(
                    item.getProduct().getId(),
                    InventoryTransactionType.SALES_RETURN,
                    item.getQuantity(),
                    sale.getId(),
                    "Cancellation of sale " + sale.getInvoiceNumber());

        }

        sale.setStatus("CANCELLED");

        return saleRepository.save(sale);
    }
}