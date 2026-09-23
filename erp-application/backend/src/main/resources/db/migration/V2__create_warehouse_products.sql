CREATE TABLE warehouse_products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    sku VARCHAR(50) NOT NULL,
    description VARCHAR(500),
    category_id BIGINT NOT NULL,
    unit_cost DECIMAL(12,2) NOT NULL,
    selling_price DECIMAL(12,2) NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    warehouse_location VARCHAR(50),
    unit VARCHAR(20) DEFAULT 'PCS',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uk_warehouse_product_sku UNIQUE (sku),
    CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(id)
);

INSERT INTO warehouse_products (name, sku, description, category_id, unit_cost, selling_price, stock_quantity, reorder_level, warehouse_location, unit) VALUES
    ('Industrial Bearing Assembly 6205', 'MAT-10001', 'High-precision ball bearing for industrial use', 1, 18.50, 24.50, 2400, 500, 'A-01-03', 'PCS'),
    ('Stainless Steel Pipe 2" x 6m', 'MAT-10002', '304 grade stainless steel pipe', 2, 65.00, 89.00, 180, 100, 'B-02-01', 'PCS'),
    ('LED Panel Light 60x60 40W', 'MAT-10003', 'Commercial LED panel light, 4000K', 3, 22.00, 32.75, 850, 200, 'C-01-05', 'PCS'),
    ('Hydraulic Pump HP-200', 'MAT-10004', 'Heavy-duty hydraulic pump, 200 bar', 4, 890.00, 1250.00, 18, 10, 'D-01-01', 'PCS'),
    ('Safety Helmet Class E (Case/12)', 'MAT-10005', 'ANSI Z89.1 Class E safety helmets, case of 12', 5, 110.00, 156.00, 320, 100, 'E-03-02', 'CASE'),
    ('Copper Wire 2.5mm² (100m Roll)', 'MAT-10006', 'Solid copper conductor, PVC insulated', 3, 55.00, 78.50, 95, 50, 'C-02-04', 'ROLL'),
    ('Welding Rod E6013 (25kg Box)', 'MAT-10007', 'Mild steel welding electrodes', 6, 32.00, 45.99, 410, 150, 'F-01-01', 'BOX'),
    ('Pneumatic Cylinder SC-50x100', 'MAT-10008', 'Standard pneumatic air cylinder', 7, 45.00, 67.80, 42, 30, 'G-02-03', 'PCS'),
    ('Industrial Adhesive EP-400 (5L)', 'MAT-10009', 'Two-component epoxy adhesive', 8, 88.00, 128.00, 65, 25, 'H-01-02', 'PCS'),
    ('Conveyor Belt Module CBM-800', 'MAT-10010', 'Modular conveyor belt section, 800mm width', 9, 620.00, 890.00, 8, 5, 'D-03-01', 'PCS');
