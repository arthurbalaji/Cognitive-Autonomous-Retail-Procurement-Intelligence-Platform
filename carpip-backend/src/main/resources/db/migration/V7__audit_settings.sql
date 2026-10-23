CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  detail jsonb,
  correlation_id text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, at DESC);

CREATE TABLE system_setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO system_setting(key, value) VALUES
  ('demo.time_scale', '1'::jsonb),
  ('features', '{"mpi": true, "cdin": true, "dynamic_rop": true}'::jsonb),
  ('negotiation.mode', '"llm"'::jsonb),
  ('macro_signal', '0.5'::jsonb);
