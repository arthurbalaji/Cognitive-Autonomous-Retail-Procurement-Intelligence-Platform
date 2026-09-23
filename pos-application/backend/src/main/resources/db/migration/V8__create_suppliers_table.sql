CREATE TABLE suppliers (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    contact_person VARCHAR(255),

    phone VARCHAR(50) NOT NULL UNIQUE,

    email VARCHAR(255),

    address TEXT,

    gst_number VARCHAR(50),

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);