CREATE TABLE purchases (
    id BIGSERIAL PRIMARY KEY,

    invoice_number VARCHAR(100) NOT NULL UNIQUE,

    supplier_id BIGINT NOT NULL,

    subtotal NUMERIC(12, 2) NOT NULL,

    tax_amount NUMERIC(12, 2) NOT NULL,

    total_amount NUMERIC(12, 2) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_purchase_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
);

CREATE TABLE purchase_items (
    id BIGSERIAL PRIMARY KEY,

    purchase_id BIGINT NOT NULL,

    product_id BIGINT NOT NULL,

    quantity INTEGER NOT NULL,

    unit_price NUMERIC(12, 2) NOT NULL,

    tax_amount NUMERIC(12, 2) NOT NULL,

    total_amount NUMERIC(12, 2) NOT NULL,

    CONSTRAINT fk_purchase_item_purchase
        FOREIGN KEY (purchase_id)
        REFERENCES purchases(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_purchase_item_product
        FOREIGN KEY (product_id)
        REFERENCES products(id),

    CONSTRAINT chk_purchase_item_quantity
        CHECK (quantity > 0)
);