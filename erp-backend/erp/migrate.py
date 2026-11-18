from . import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('ZOHO','PATH_B')),
  carpip_tenant_public_id text,
  carpip_base_url text,
  carpip_api_key text,
  carpip_webhook_secret text,
  zoho_org_id text,
  oauth_client_id text,
  oauth_client_secret text,
  oauth_refresh_token text,
  auto_confirm boolean NOT NULL DEFAULT true,
  auto_progress boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'manager'
);

CREATE TABLE IF NOT EXISTS warehouses (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  sku text NOT NULL,
  gtin text,
  name text NOT NULL,
  category text,
  uom text NOT NULL DEFAULT 'EA',
  pack_size int NOT NULL DEFAULT 1,
  moq int NOT NULL DEFAULT 1,
  shelf_life_days int,
  lead_time_days int NOT NULL DEFAULT 3,
  max_discount_pct numeric(4,3) NOT NULL DEFAULT 0.200,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_items_gtin ON items(company_id, gtin);

-- volume price tiers; min_qty = 1 is the list price
CREATE TABLE IF NOT EXISTS item_prices (
  item_id int NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  min_qty int NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  PRIMARY KEY (item_id, min_qty)
);

CREATE TABLE IF NOT EXISTS stock_lots (
  id serial PRIMARY KEY,
  item_id int NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id int NOT NULL REFERENCES warehouses(id),
  lot_no text NOT NULL,
  qty_on_hand int NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  qty_reserved int NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  expiry_date date,
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_reserved <= qty_on_hand)
);
CREATE INDEX IF NOT EXISTS idx_lots_item ON stock_lots(item_id, expiry_date);

CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  carpip_tenant_public_id text,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  customer_id int NOT NULL REFERENCES customers(id),
  po_number text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED',
  currency text NOT NULL DEFAULT 'INR',
  promised_eta date,
  reject_reason text,
  source text NOT NULL DEFAULT 'CARPIP',
  quote_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, po_number)
);
CREATE INDEX IF NOT EXISTS idx_so_company ON sales_orders(company_id, id DESC);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id serial PRIMARY KEY,
  sales_order_id int NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_id int NOT NULL REFERENCES items(id),
  sku text NOT NULL,
  gtin text,
  name text NOT NULL,
  qty_ordered int NOT NULL CHECK (qty_ordered > 0),
  qty_confirmed int NOT NULL DEFAULT 0,
  qty_shipped int NOT NULL DEFAULT 0,
  qty_delivered int NOT NULL DEFAULT 0,
  unit_price numeric(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS allocations (
  id serial PRIMARY KEY,
  line_id int NOT NULL REFERENCES sales_order_lines(id) ON DELETE CASCADE,
  lot_id int NOT NULL REFERENCES stock_lots(id),
  qty int NOT NULL,
  shipped int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shipments (
  id serial PRIMARY KEY,
  sales_order_id int NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  shipment_no text NOT NULL,
  carrier text,
  tracking text,
  eta date,
  shipped_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE TABLE IF NOT EXISTS shipment_lines (
  id serial PRIMARY KEY,
  shipment_id int NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  line_id int NOT NULL REFERENCES sales_order_lines(id),
  qty int NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_history (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  sales_order_id int,
  promised date,
  delivered date NOT NULL,
  on_time boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id bigserial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  type text NOT NULL,
  event_id text NOT NULL UNIQUE,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status int,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox_events(next_attempt_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS inbound_requests (
  id bigserial PRIMARY KEY,
  company_id int NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response text,
  status int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  access_token text PRIMARY KEY,
  company_id int NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_log (
  id bigserial PRIMARY KEY,
  company_id int,
  direction text NOT NULL,
  method text,
  path text,
  status int,
  note text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ilog_company ON integration_log(company_id, id DESC);

-- purchase bills: stock received from the company's own vendors (each line becomes a stock lot)
CREATE TABLE IF NOT EXISTS purchase_bills (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  vendor text NOT NULL,
  bill_no text NOT NULL,
  bill_date date NOT NULL DEFAULT current_date,
  total numeric(14,2) NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, vendor, bill_no)
);
CREATE TABLE IF NOT EXISTS purchase_bill_lines (
  id serial PRIMARY KEY,
  bill_id int NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
  item_id int NOT NULL REFERENCES items(id),
  qty int NOT NULL CHECK (qty > 0),
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  lot_no text NOT NULL,
  expiry_date date,
  stock_lot_id int REFERENCES stock_lots(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO settings(key, value) VALUES ('partial_pct', '0'), ('zoho_token_ttl', '3600'), ('progress_delays', '3,6,10')
ON CONFLICT DO NOTHING;
"""


def migrate() -> None:
    db.execute(SCHEMA)
