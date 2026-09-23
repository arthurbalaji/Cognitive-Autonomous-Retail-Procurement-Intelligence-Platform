-- Seed sample data for POS application — CARPIP integration testing.
-- Categories, products, customers, and sales with items.

-- Categories
INSERT INTO categories (name, description, active) VALUES
    ('Bakery', 'Fresh baked goods and pastries', true),
    ('Beverages', 'Hot and cold drinks', true),
    ('Produce', 'Fresh fruits and vegetables', true),
    ('Dairy', 'Milk, eggs, cheese and dairy products', true),
    ('Meat', 'Fresh and packaged meats', true),
    ('Pantry', 'Shelf-stable groceries', true),
    ('Snacks', 'Chips, nuts, and confections', true),
    ('Frozen', 'Frozen meals and ice cream', true);

-- Products (8 items with barcodes, prices, realistic stock)
INSERT INTO products (name, sku, barcode, category_id, purchase_price, selling_price, tax_rate, stock_quantity, reorder_level, active) VALUES
    ('Artisan Sourdough Loaf',       'POS-001', '4901234567001', 1, 5.50,  8.99,  5.00, 45, 20, true),
    ('Cold Brew Coffee 16oz',        'POS-002', '4901234567002', 2, 2.80,  5.49,  5.00, 120, 50, true),
    ('Organic Avocado (each)',        'POS-003', '4901234567003', 3, 1.50,  2.99,  0.00, 38, 40, true),
    ('Free-Range Eggs (dozen)',       'POS-004', '4901234567004', 4, 4.20,  6.99,  0.00, 22, 30, true),
    ('Grass-Fed Ground Beef 1lb',     'POS-005', '4901234567005', 5, 8.50, 12.99,  0.00, 15, 25, true),
    ('Kombucha Variety 4-Pack',       'POS-006', '4901234567006', 2, 7.00, 11.99,  5.00, 67, 30, true),
    ('Gluten-Free Pasta 16oz',        'POS-007', '4901234567007', 6, 2.50,  4.49,  0.00, 83, 40, true),
    ('Local Honey 12oz Jar',          'POS-008', '4901234567008', 6, 6.00,  9.99,  0.00, 19, 15, true);

-- Customers
INSERT INTO customers (name, phone, email, address, active) VALUES
    ('Priya Menon',   '9876500001', 'priya.menon@email.com',   '12 MG Road, Bangalore',     true),
    ('Arjun Reddy',   '9876500002', 'arjun.reddy@email.com',   '45 Jubilee Hills, Hyderabad', true),
    ('Neha Sharma',   '9876500003', 'neha.sharma@email.com',    '8 Connaught Place, Delhi',   true);

-- Sales (10 completed transactions over the past 24 hours)
INSERT INTO sales (invoice_number, subtotal, tax_amount, total_amount, payment_method, status, customer_id, created_at) VALUES
    ('INV-2026-0001', 17.98,  0.90,  18.88, 'CARD',  'COMPLETED', 1, NOW() - INTERVAL '1 hour'),
    ('INV-2026-0002', 10.98,  0.55,  11.53, 'CASH',  'COMPLETED', NULL, NOW() - INTERVAL '2 hours'),
    ('INV-2026-0003', 32.97,  0.00,  32.97, 'CARD',  'COMPLETED', 2, NOW() - INTERVAL '3 hours'),
    ('INV-2026-0004', 23.97,  1.20,  25.17, 'UPI',   'COMPLETED', NULL, NOW() - INTERVAL '5 hours'),
    ('INV-2026-0005', 12.99,  0.00,  12.99, 'CASH',  'COMPLETED', 3, NOW() - INTERVAL '6 hours'),
    ('INV-2026-0006', 47.96,  2.40,  50.36, 'CARD',  'COMPLETED', 1, NOW() - INTERVAL '8 hours'),
    ('INV-2026-0007',  8.98,  0.00,   8.98, 'CASH',  'COMPLETED', NULL, NOW() - INTERVAL '10 hours'),
    ('INV-2026-0008', 25.98,  0.00,  25.98, 'UPI',   'COMPLETED', 2, NOW() - INTERVAL '14 hours'),
    ('INV-2026-0009', 35.97,  1.80,  37.77, 'CARD',  'COMPLETED', NULL, NOW() - INTERVAL '18 hours'),
    ('INV-2026-0010', 19.98,  1.00,  20.98, 'CASH',  'COMPLETED', 3, NOW() - INTERVAL '22 hours');

-- Sale Items (line items for each sale)
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, tax_amount, total_amount) VALUES
    -- INV-2026-0001: 2x Sourdough Loaf
    (1, 1, 2,  8.99, 0.90, 18.88),
    -- INV-2026-0002: 2x Cold Brew Coffee
    (2, 2, 2,  5.49, 0.55, 11.53),
    -- INV-2026-0003: 3x Avocado + 1x Eggs + 1x Beef
    (3, 3, 3,  2.99, 0.00,  8.97),
    (3, 4, 1,  6.99, 0.00,  6.99),
    (3, 5, 1, 12.99, 0.00, 12.99),
    -- INV-2026-0004: 2x Kombucha
    (4, 6, 2, 11.99, 1.20, 25.17),
    -- INV-2026-0005: 1x Beef
    (5, 5, 1, 12.99, 0.00, 12.99),
    -- INV-2026-0006: 4x Cold Brew + 2x Kombucha
    (6, 2, 4,  5.49, 1.10, 23.06),
    (6, 6, 2, 11.99, 1.20, 25.17),
    -- INV-2026-0007: 2x Pasta
    (7, 7, 2,  4.49, 0.00,  8.98),
    -- INV-2026-0008: 2x Eggs + 2x Honey
    (8, 4, 2,  6.99, 0.00, 13.98),
    (8, 8, 1,  9.99, 0.00,  9.99),
    -- INV-2026-0009: 3x Sourdough + 1x Kombucha
    (9, 1, 3,  8.99, 1.35, 28.32),
    (9, 6, 1, 11.99, 0.60, 12.59),
    -- INV-2026-0010: 2x Honey
    (10, 8, 2,  9.99, 1.00, 20.98);
