CREATE TABLE intel_mpi_snapshot (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_tenant_id uuid,
  computed_at timestamptz NOT NULL DEFAULT now(),
  mpi numeric(5,4) NOT NULL,
  dp numeric(5,4), sa numeric(5,4), pv numeric(5,4), si numeric(5,4), cs numeric(5,4),
  trend text,
  quality text,
  inputs jsonb
);
CREATE INDEX idx_mpi_prod ON intel_mpi_snapshot(product_id, computed_at DESC);

CREATE TABLE intel_forecast (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  target_date date NOT NULL,
  yhat numeric(10,3) NOT NULL,
  yhat_lo numeric(10,3),
  yhat_hi numeric(10,3),
  model_version text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, target_date)
);

CREATE TABLE intel_model_registry (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  kind text NOT NULL,
  version integer NOT NULL,
  path text,
  arch_hash text,
  metrics jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intel_cdin_round (
  id uuid PRIMARY KEY,
  round_no integer NOT NULL,
  base_version integer NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  quorum integer NOT NULL,
  deadline_at timestamptz NOT NULL,
  participants integer NOT NULL DEFAULT 0,
  metrics jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE intel_cdin_update (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES intel_cdin_round(id),
  tenant_id uuid NOT NULL,
  num_samples integer NOT NULL,
  base_version integer NOT NULL,
  sha256 text,
  l2_delta numeric(12,6),
  accepted boolean NOT NULL DEFAULT false,
  reject_reason text,
  growth jsonb,
  val_loss numeric(12,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, tenant_id)
);

CREATE TABLE intel_rdi (
  gtin text PRIMARY KEY,
  rdi numeric(5,4) NOT NULL,
  n_nodes integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
