CREATE TABLE integration_connection (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenant(id),
  type text NOT NULL CHECK (type IN ('SHOPIFY','CUSTOM_REST','ZOHO')),
  direction text NOT NULL CHECK (direction IN ('RETAIL_POS','SUPPLIER_ERP')),
  base_url text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_enc text,
  webhook_secret_enc text,
  webhook_secret_prev_enc text,
  prev_valid_until timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE',
  health text NOT NULL DEFAULT 'UNKNOWN',
  last_sync_at timestamptz,
  last_error text,
  sync_cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inbound_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  connection_id uuid,
  source text NOT NULL,
  external_event_id text NOT NULL,
  topic text,
  signature_valid boolean NOT NULL DEFAULT true,
  payload jsonb,
  status text NOT NULL DEFAULT 'RECEIVED',
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, external_event_id)
);
CREATE INDEX idx_inbound_tenant ON inbound_event(tenant_id, received_at DESC);

CREATE TABLE processed_event (
  consumer_group text NOT NULL,
  event_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);

CREATE TABLE outbox_event (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  msg_key text,
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX idx_outbox_unpublished ON outbox_event(id) WHERE published_at IS NULL;

CREATE TABLE writeback_task (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES integration_connection(id),
  tenant_id uuid NOT NULL,
  po_id uuid,
  kind text NOT NULL CHECK (kind IN ('SUBMIT_PO','CANCEL_PO','PUSH_INCOMING','ADJUST_STOCK')),
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED','DEAD')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_writeback_due ON writeback_task(next_attempt_at) WHERE status = 'PENDING';
