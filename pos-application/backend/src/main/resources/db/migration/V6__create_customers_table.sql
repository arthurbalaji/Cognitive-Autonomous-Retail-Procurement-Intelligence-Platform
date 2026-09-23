CREATE TABLE customers (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(150) NOT NULL,

    phone VARCHAR(20) NOT NULL,

    email VARCHAR(150),

    address VARCHAR(255),

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_customer_phone UNIQUE (phone)
);