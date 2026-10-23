CREATE TABLE purchase_order (
  id uuid PRIMARY KEY,
  po_number text NOT NULL UNIQUE,
  retailer_tenant_id uuid NOT NULL REFERENCES tenant(id),
  wholesaler_tenant_id uuid REFERENCES tenant(id),
  product_id uuid NOT NULL REFERENCES product(id),
  origin text NOT NULL DEFAULT 'AI' CHECK (origin IN ('AI','MANUAL')),
  trigger text,
  status text NOT NULL,
  negotiation_status text NOT NULL DEFAULT 'PENDING',
  quantity integer NOT NULL,
  qty_confirmed integer,
  qty_shipped integer NOT NULL DEFAULT 0,
  qty_received integer NOT NULL DEFAULT 0,
  unit_price_agreed numeric(12,2),
  base_price numeric(12,2),
  discount_savings numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'INR',
  order_by_date date,
  expected_delivery_date date,
  decision jsonb,
  quote_expires_at timestamptz,
  external_ref text,
  cancel_reason text,
  degraded boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_po_retailer ON purchase_order(retailer_tenant_id, created_at DESC);
CREATE INDEX idx_po_wholesaler ON purchase_order(wholesaler_tenant_id, created_at DESC);
CREATE INDEX idx_po_product ON purchase_order(product_id);
-- at most one in-flight AI PO per (retailer, product): reorder-storm guard
CREATE UNIQUE INDEX uq_po_inflight ON purchase_order(retailer_tenant_id, product_id)
  WHERE origin = 'AI' AND status IN ('NEGOTIATING','NEGOTIATION_ERROR','PENDING_APPROVAL','APPROVED','SUBMITTED');

CREATE TABLE po_status_history (
  id bigserial PRIMARY KEY,
  po_id uuid NOT NULL REFERENCES purchase_order(id),
  from_status text,
  to_status text NOT NULL,
  reason text,
  actor text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_po_hist ON po_status_history(po_id, at);

CREATE TABLE procurement_run (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  po_id uuid,
  trigger text,
  status text NOT NULL DEFAULT 'RUNNING',
  request jsonb,
  decision jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE negotiation (
  id uuid PRIMARY KEY,
  po_id uuid NOT NULL REFERENCES purchase_order(id),
  run_id uuid,
  retailer_tenant_id uuid NOT NULL,
  wholesaler_tenant_id uuid NOT NULL,
  mode text NOT NULL,
  model_id text,
  status text NOT NULL,
  base_price numeric(12,2),
  floor_price numeric(12,2),
  ceiling_price numeric(12,2),
  retailer_target numeric(12,2),
  retailer_max numeric(12,2),
  mpi_used numeric(5,4),
  final_price numeric(12,2),
  quantity integer,
  rank integer,
  selected boolean NOT NULL DEFAULT false,
  score numeric(6,4),
  tokens_in integer DEFAULT 0,
  tokens_out integer DEFAULT 0,
  latency_ms integer DEFAULT 0,
  guardrail_interventions integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_neg_po ON negotiation(po_id);

CREATE TABLE negotiation_log (
  id bigserial PRIMARY KEY,
  negotiation_id uuid NOT NULL REFERENCES negotiation(id),
  turn_no integer NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  price numeric(12,2),
  deterministic_price numeric(12,2),
  llm_proposed_price numeric(12,2),
  clamped boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'RULE',
  message text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_neglog ON negotiation_log(negotiation_id, turn_no, id);

CREATE SEQUENCE po_number_seq START 1000;
