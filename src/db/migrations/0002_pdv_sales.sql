-- Terminals: device identity for the self-service totem. Only the SHA-256 of the token is stored.
CREATE TABLE terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id)
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'awaiting_payment', 'paid', 'cancelled', 'expired')),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0 AND total_cents <= 1000000),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id),
  FOREIGN KEY (terminal_id, org_id) REFERENCES terminals (id, org_id)
);
CREATE INDEX sales_market_created_idx ON sales (market_id, created_at DESC);
CREATE INDEX sales_awaiting_idx ON sales (status) WHERE status = 'awaiting_payment';

-- Name and price are copied at the moment of the scan. unit_cost_cents stays null until lots exist (phase 5).
CREATE TABLE sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  market_product_id uuid NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  unit_cost_cents integer,
  UNIQUE (sale_id, market_product_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (market_product_id, org_id) REFERENCES market_products (id, org_id)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  method text NOT NULL DEFAULT 'pix' CHECK (method IN ('pix')),
  provider text NOT NULL,
  external_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'expired', 'failed')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  qr_payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  checked_at timestamptz,
  webhook_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id)
);
-- One pending charge per sale at any time.
CREATE UNIQUE INDEX payments_one_pending_idx ON payments (sale_id) WHERE status = 'pending';

-- A sale takes each product out of stock at most once, even if confirmation runs twice.
ALTER TABLE stock_movements ADD COLUMN sale_id uuid;
ALTER TABLE stock_movements
  ADD FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id);
CREATE UNIQUE INDEX stock_movements_sale_item_idx
  ON stock_movements (sale_id, market_product_id) WHERE type = 'sale' AND sale_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['terminals', 'sales', 'sale_items', 'payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON terminals, sales, payments TO market77_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sale_items TO market77_app;
-- stock_movements keeps SELECT and INSERT only (append-only ledger).
