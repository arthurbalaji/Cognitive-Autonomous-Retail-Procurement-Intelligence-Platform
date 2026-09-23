CREATE TABLE sales (
    id BIGSERIAL PRIMARY KEY,

    invoice_number VARCHAR(50) NOT NULL UNIQUE,

    subtotal NUMERIC(12,2) NOT NULL,

    tax_amount NUMERIC(12,2) NOT NULL,

    total_amount NUMERIC(12,2) NOT NULL,

    payment_method VARCHAR(30) NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_items (
    id BIGSERIAL PRIMARY KEY,

    sale_id BIGINT NOT NULL,

    product_id BIGINT NOT NULL,

    quantity INTEGER NOT NULL,

    unit_price NUMERIC(12,2) NOT NULL,

    tax_amount NUMERIC(12,2) NOT NULL,

    total_amount NUMERIC(12,2) NOT NULL,

    CONSTRAINT fk_sale_item_sale
        FOREIGN KEY (sale_id)
        REFERENCES sales(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_sale_item_product
        FOREIGN KEY (product_id)
        REFERENCES products(id),

    CONSTRAINT chk_sale_item_quantity
        CHECK (quantity > 0)
);