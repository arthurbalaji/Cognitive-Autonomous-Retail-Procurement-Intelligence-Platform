CREATE TABLE shipments (
    id BIGSERIAL PRIMARY KEY,
    sales_order_id BIGINT NOT NULL,
    tracking_number VARCHAR(100),
    carrier VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'PREPARING',
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_shipment_sales_order FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id)
);
