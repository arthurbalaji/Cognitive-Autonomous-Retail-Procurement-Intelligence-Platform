import { pool } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (version int PRIMARY KEY, applied_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS shops (
  id serial PRIMARY KEY,
  handle text UNIQUE NOT NULL,
  name text NOT NULL,
  domain text UNIQUE NOT NULL,
  mode text NOT NULL DEFAULT 'SHOPIFY' CHECK (mode IN ('SHOPIFY','LEGACY')),
  access_token_hash text NOT NULL,
  webhook_secret text NOT NULL,
  carpip_base_url text,
  carpip_tenant_public_id text,
  carpip_api_key text,
  allow_oversell boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'INR',
  city text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  name text NOT NULL,
  pin_hash text NOT NULL,
  role text NOT NULL DEFAULT 'cashier'
);

CREATE TABLE IF NOT EXISTS locations (
  id bigserial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id bigserial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  title text NOT NULL,
  product_type text,
  tags text DEFAULT '',
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variants (
  id bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id),
  shop_id int NOT NULL REFERENCES shops(id),
  title text NOT NULL DEFAULT 'Default Title',
  sku text NOT NULL,
  barcode text,
  price numeric(12,2) NOT NULL,
  inventory_item_id bigint UNIQUE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (shop_id, sku)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id bigserial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  sku text NOT NULL,
  cost numeric(12,2),
  tracked boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS inventory_levels (
  inventory_item_id bigint NOT NULL REFERENCES inventory_items(id),
  location_id bigint NOT NULL REFERENCES locations(id),
  available int NOT NULL DEFAULT 0,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (inventory_item_id, location_id)
);

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id bigserial PRIMARY KEY,
  inventory_item_id bigint NOT NULL,
  location_id bigint NOT NULL,
  delta int NOT NULL,
  reason text NOT NULL,
  reference text,
  idempotency_key text UNIQUE,
  result_available int,
  at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id bigserial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  order_number int NOT NULL,
  total numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  cashier text,
  status text NOT NULL DEFAULT 'paid',
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop_id, id DESC);

CREATE TABLE IF NOT EXISTS order_line_items (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  variant_id bigint NOT NULL,
  sku text NOT NULL,
  title text NOT NULL,
  quantity int NOT NULL,
  price numeric(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refund_line_items (
  id bigserial PRIMARY KEY,
  refund_id bigint NOT NULL REFERENCES refunds(id),
  line_item_id bigint NOT NULL,
  quantity int NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id bigserial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  topic text NOT NULL,
  address text NOT NULL,
  format text NOT NULL DEFAULT 'json',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, topic, address)
);

-- outbox for BOTH Shopify-style webhooks and legacy REST pushes
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id bigserial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  kind text NOT NULL DEFAULT 'SHOPIFY_WEBHOOK',
  webhook_id text UNIQUE NOT NULL,
  topic text NOT NULL,
  address text NOT NULL,
  body text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(3) NOT NULL DEFAULT now(),
  last_status_code int,
  last_error text,
  triggered_at timestamptz(3) NOT NULL DEFAULT now(),
  delivered_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_due ON webhook_deliveries(next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_deliveries_shop ON webhook_deliveries(shop_id, id DESC);

CREATE TABLE IF NOT EXISTS incoming_purchase_orders (
  id bigserial PRIMARY KEY,
  shop_id int NOT NULL REFERENCES shops(id),
  po_number text NOT NULL,
  supplier text,
  status text NOT NULL,
  eta text,
  currency text DEFAULT 'INR',
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (shop_id, po_number)
);

CREATE TABLE IF NOT EXISTS api_log (
  id bigserial PRIMARY KEY,
  shop_id int,
  direction text NOT NULL,
  method text,
  path text,
  status int,
  note text,
  at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_log_shop ON api_log(shop_id, id DESC);

CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO settings(key, value) VALUES ('webhooks_paused', 'false'), ('webhooks_drop', 'false') ON CONFLICT DO NOTHING;
`;

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query('INSERT INTO schema_version(version) VALUES (1) ON CONFLICT DO NOTHING');
}
