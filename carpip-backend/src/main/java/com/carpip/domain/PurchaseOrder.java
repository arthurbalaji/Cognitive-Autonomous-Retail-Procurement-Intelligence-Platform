package com.carpip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "purchase_order")
public class PurchaseOrder {
    @Id
    public UUID id;
    @Column(name = "po_number")
    public String poNumber;
    @Column(name = "retailer_tenant_id")
    public UUID retailerTenantId;
    @Column(name = "wholesaler_tenant_id")
    public UUID wholesalerTenantId;
    @Column(name = "product_id")
    public UUID productId;
    public String origin = "AI";
    @Column(name = "trigger")
    public String trigger;
    public String status;
    @Column(name = "negotiation_status")
    public String negotiationStatus = "PENDING";
    public int quantity;
    @Column(name = "qty_confirmed")
    public Integer qtyConfirmed;
    @Column(name = "qty_shipped")
    public int qtyShipped;
    @Column(name = "qty_received")
    public int qtyReceived;
    @Column(name = "unit_price_agreed")
    public BigDecimal unitPriceAgreed;
    @Column(name = "base_price")
    public BigDecimal basePrice;
    @Column(name = "discount_savings")
    public BigDecimal discountSavings = BigDecimal.ZERO;
    @Column(name = "total_amount")
    public BigDecimal totalAmount;
    public String currency = "INR";
    @Column(name = "order_by_date")
    public LocalDate orderByDate;
    @Column(name = "expected_delivery_date")
    public LocalDate expectedDeliveryDate;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    public Map<String, Object> decision;
    @Column(name = "quote_expires_at")
    public Instant quoteExpiresAt;
    @Column(name = "external_ref")
    public String externalRef;
    @Column(name = "cancel_reason")
    public String cancelReason;
    public boolean degraded;
    @Version
    public Long version;
    @Column(name = "created_at")
    public Instant createdAt = Instant.now();
    @Column(name = "updated_at")
    public Instant updatedAt = Instant.now();
}
