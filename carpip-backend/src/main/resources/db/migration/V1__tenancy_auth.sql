CREATE TABLE tenant (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('ADMIN','RETAILER','WHOLESALER')),
  status text NOT NULL DEFAULT 'ACTIVE',
  currency text NOT NULL DEFAULT 'INR',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  region text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN','RETAILER','WHOLESALER')),
  display_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_key (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  scopes text NOT NULL DEFAULT 'inventory:write,orders:write,catalog:write,graphql:read',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ROTATING','REVOKED')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_key_tenant ON api_key(tenant_id);
