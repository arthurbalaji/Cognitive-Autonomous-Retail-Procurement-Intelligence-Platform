CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(150) NOT NULL,

    sku VARCHAR(50) NOT NULL,
    barcode VARCHAR(100),

    category_id BIGINT NOT NULL,

    purchase_price NUMERIC(12, 2) NOT NULL,
    selling_price NUMERIC(12, 2) NOT NULL,

    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,

    stock_quantity INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uk_product_sku UNIQUE (sku),
    CONSTRAINT uk_product_barcode UNIQUE (barcode),

    CONSTRAINT fk_product_category
        FOREIGN KEY (category_id)
        REFERENCES categories(id)
);