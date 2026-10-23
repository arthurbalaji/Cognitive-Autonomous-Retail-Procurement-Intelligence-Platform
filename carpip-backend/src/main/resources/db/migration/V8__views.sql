CREATE VIEW v_inventory_position AS
SELECT p.id AS product_id,
       p.tenant_id,
       p.current_stock,
       COALESCE((
         SELECT SUM(GREATEST(COALESCE(po.qty_confirmed, po.quantity) - po.qty_received, 0))
         FROM purchase_order po
         WHERE po.product_id = p.id
           AND po.status IN ('SUBMITTED','CONFIRMED','PARTIALLY_CONFIRMED','PARTIALLY_SHIPPED','SHIPPED','DELIVERED','PARTIALLY_RECEIVED')
       ), 0) AS on_order
FROM product p;

CREATE VIEW v_mpi_latest AS
SELECT DISTINCT ON (product_id) *
FROM intel_mpi_snapshot
WHERE supplier_tenant_id IS NULL
ORDER BY product_id, computed_at DESC;
