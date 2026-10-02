-- Application role. Dev password only: production must run
-- ALTER ROLE market77_app PASSWORD '...' with a real secret.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'market77_app') THEN
    CREATE ROLE market77_app LOGIN PASSWORD 'market77_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- Auth tables: no RLS, only reached through the admin connection (src/auth).
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'restocker')),
  UNIQUE (org_id, user_id)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- Business tables: org_id on every row; composite FKs keep children in the same tenant.
CREATE TABLE markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  cnpj text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

CREATE TABLE product_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  product_id uuid NOT NULL,
  code text NOT NULL,
  UNIQUE (org_id, code),
  FOREIGN KEY (product_id, org_id) REFERENCES products (id, org_id) ON DELETE CASCADE
);

CREATE TABLE market_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  min_stock integer NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (market_id, product_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id),
  FOREIGN KEY (product_id, org_id) REFERENCES products (id, org_id)
);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_product_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('in', 'sale', 'loss', 'adjustment')),
  quantity integer NOT NULL,
  note text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (type = 'in' AND quantity > 0)
    OR (type IN ('sale', 'loss') AND quantity < 0)
    OR (type = 'adjustment' AND quantity <> 0)
  ),
  FOREIGN KEY (market_product_id, org_id) REFERENCES market_products (id, org_id)
);
CREATE INDEX stock_movements_mp_idx ON stock_movements (market_product_id);

-- Tenant isolation. nullif() because a reused pooled connection keeps app.org_id
-- as '' (not NULL) after SET LOCAL ends, and ''::uuid would raise an error.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['markets', 'products', 'product_barcodes', 'market_products', 'stock_movements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON markets, products, product_barcodes, market_products TO market77_app;
-- Ledger is append-only for the app role.
GRANT SELECT, INSERT ON stock_movements TO market77_app;
