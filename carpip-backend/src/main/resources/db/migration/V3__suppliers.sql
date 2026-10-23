CREATE TABLE supplier_offer (
  id uuid PRIMARY KEY,
  wholesaler_tenant_id uuid NOT NULL REFERENCES tenant(id),
  supplier_sku text NOT NULL,
  gtin text,
  name text NOT NULL,
  category text,
  uom text DEFAULT 'EA',
  pack_size integer NOT NULL DEFAULT 1,
  moq integer NOT NULL DEFAULT 1,
  list_price numeric(12,2) NOT NULL,
  price_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_qty integer NOT NULL DEFAULT 0,
  lead_time_days integer NOT NULL DEFAULT 3,
  shipping_reliability numeric(4,3) NOT NULL DEFAULT 0.900,
  nearest_expiry date,
  shelf_life_days integer,
  max_discount_pct numeric(4,3) NOT NULL DEFAULT 0.200,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wholesaler_tenant_id, supplier_sku)
);
CREATE INDEX idx_supplier_offer_gtin ON supplier_offer(gtin);

CREATE TABLE supplier_price_history (
  id bigserial PRIMARY KEY,
  wholesaler_tenant_id uuid NOT NULL,
  gtin text NOT NULL,
  price numeric(12,2) NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sph_gtin ON supplier_price_history(gtin, at DESC);

CREATE TABLE trade_relationship (
  retailer_tenant_id uuid NOT NULL REFERENCES tenant(id),
  wholesaler_tenant_id uuid NOT NULL REFERENCES tenant(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  external_customer_ref text,
  PRIMARY KEY (retailer_tenant_id, wholesaler_tenant_id)
);

CREATE TABLE competitor_price (
  id bigserial PRIMARY KEY,
  gtin text NOT NULL,
  price numeric(12,2) NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_competitor_gtin ON competitor_price(gtin, at DESC);
