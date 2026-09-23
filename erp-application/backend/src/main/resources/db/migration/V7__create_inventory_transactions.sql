CREATE TABLE inventory_transactions (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL,
    type VARCHAR(20) NOT NULL,
    quantity INTEGER NOT NULL,
    reference_number VARCHAR(50),
    notes VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_inv_txn_product FOREIGN KEY (product_id) REFERENCES warehouse_products(id)
);

CREATE INDEX idx_inv_txn_product ON inventory_transactions(product_id);
CREATE INDEX idx_inv_txn_created ON inventory_transactions(created_at DESC);
