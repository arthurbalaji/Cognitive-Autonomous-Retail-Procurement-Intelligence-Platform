CREATE TABLE product (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  sku text NOT NULL,
  gtin text,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'LIFESTYLE',
  uom text NOT NULL DEFAULT 'EA',
  current_stock integer NOT NULL DEFAULT 0,
  reorder_point integer NOT NULL DEFAULT 0,
  rop_source text NOT NULL DEFAULT 'AUTO',
  base_price numeric(12,2),
  retail_price numeric(12,2),
  shelf_life_days integer,
  perishable boolean NOT NULL DEFAULT false,
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  stock_source_version timestamptz,
  reorder_blocked_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);
CREATE UNIQUE INDEX uq_product_gtin ON product(tenant_id, gtin) WHERE gtin IS NOT NULL;
CREATE INDEX idx_product_inv_item ON product(tenant_id, (external_ids->>'inventory_item_id'));

CREATE TABLE stock_movement (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product(id),
  mode text NOT NULL,
  delta integer NOT NULL,
  qty_before integer NOT NULL,
  qty_after integer NOT NULL,
  reason text NOT NULL,
  reference text,
  event_id text,
  source_version timestamptz,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movement_product ON stock_movement(product_id, at DESC);

CREATE TABLE sales_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product(id),
  event_id text,
  source text NOT NULL,
  external_order_id text NOT NULL,
  external_line_id text NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric(12,2),
  is_refund boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, external_order_id, external_line_id)
);

CREATE TABLE sales_daily (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product(id),
  day date NOT NULL,
  units integer NOT NULL DEFAULT 0,
  revenue numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, day)
);
CREATE INDEX idx_sales_daily_tenant_day ON sales_daily(tenant_id, day);
