-- Seed sample confirmed sales orders for CARPIP integration testing.
-- These orders reference existing warehouse products (V2) and customers (V3).

INSERT INTO sales_orders (order_number, customer_id, status, subtotal, tax_amount, total_amount, notes, created_at) VALUES
    ('SO-2026-001', 1, 'CONFIRMED', 4900.00, 882.00, 5782.00, 'Bulk bearing order for production line', NOW() - INTERVAL '2 hours'),
    ('SO-2026-002', 2, 'CONFIRMED', 8900.00, 1602.00, 10502.00, 'Stainless steel pipes for plant expansion', NOW() - INTERVAL '5 hours'),
    ('SO-2026-003', 3, 'CONFIRMED', 3275.00, 589.50, 3864.50, 'LED panel lights for warehouse retrofit', NOW() - INTERVAL '8 hours'),
    ('SO-2026-004', 1, 'CONFIRMED', 12500.00, 2250.00, 14750.00, 'Hydraulic pump replacement', NOW() - INTERVAL '12 hours'),
    ('SO-2026-005', 4, 'CONFIRMED', 7800.00, 1404.00, 9204.00, 'Safety equipment quarterly restock', NOW() - INTERVAL '1 day'),
    ('SO-2026-006', 5, 'CONFIRMED', 3925.00, 706.50, 4631.50, 'Copper wire for rewiring project', NOW() - INTERVAL '1 day 6 hours'),
    ('SO-2026-007', 2, 'CONFIRMED', 4599.00, 827.82, 5426.82, 'Welding consumables monthly order', NOW() - INTERVAL '2 days'),
    ('SO-2026-008', 3, 'CONFIRMED', 8900.00, 1602.00, 10502.00, 'Conveyor module for Line-3 upgrade', NOW() - INTERVAL '3 days');

-- Sales order items for each order (referencing warehouse_products by ID from V2 seed)
-- Product IDs: 1=MAT-10001(Bearing), 2=MAT-10002(Pipe), 3=MAT-10003(LED), 4=MAT-10004(Pump),
-- 5=MAT-10005(Helmet), 6=MAT-10006(Wire), 7=MAT-10007(Welding Rod), 8=MAT-10008(Cylinder),
-- 9=MAT-10009(Adhesive), 10=MAT-10010(Conveyor)

INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, total_price) VALUES
    -- SO-2026-001: 200x Bearings
    (1, 1, 200, 24.50, 4900.00),
    -- SO-2026-002: 100x Steel Pipes
    (2, 2, 100, 89.00, 8900.00),
    -- SO-2026-003: 100x LED Panels
    (3, 3, 100, 32.75, 3275.00),
    -- SO-2026-004: 10x Hydraulic Pumps
    (4, 4, 10, 1250.00, 12500.00),
    -- SO-2026-005: 50x Safety Helmets
    (5, 5, 50, 156.00, 7800.00),
    -- SO-2026-006: 50x Copper Wire Rolls
    (6, 6, 50, 78.50, 3925.00),
    -- SO-2026-007: 100x Welding Rod Boxes
    (7, 7, 100, 45.99, 4599.00),
    -- SO-2026-008: 10x Conveyor Modules
    (8, 10, 10, 890.00, 8900.00);
