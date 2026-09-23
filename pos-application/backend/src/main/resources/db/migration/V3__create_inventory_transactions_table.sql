CREATE TABLE inventory_transactions (
    id BIGSERIAL PRIMARY KEY,

    product_id BIGINT NOT NULL,

    type VARCHAR(30) NOT NULL,

    quantity INTEGER NOT NULL,

    reference_id BIGINT,

    notes VARCHAR(255),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_inventory_product
        FOREIGN KEY (product_id)
        REFERENCES products(id),

    CONSTRAINT chk_inventory_quantity
        CHECK (quantity > 0)
);