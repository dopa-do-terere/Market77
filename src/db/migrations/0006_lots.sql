-- Phase 5A: lots and expiry. A lot is a label on ledger movements; its balance is the sum of its movements.
ALTER TABLE market_products ADD COLUMN tracks_expiry boolean NOT NULL DEFAULT false;

CREATE TABLE stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_product_id uuid NOT NULL,
  expires_on date NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (id, market_product_id),
  UNIQUE (market_product_id, expires_on),
  FOREIGN KEY (market_product_id, org_id) REFERENCES market_products (id, org_id)
);

ALTER TABLE stock_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_lots
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT ON stock_lots TO market77_app;

-- A movement may point at a lot, and the lot must belong to the same product.
ALTER TABLE stock_movements ADD COLUMN lot_id uuid;
ALTER TABLE stock_movements
  ADD FOREIGN KEY (lot_id, market_product_id) REFERENCES stock_lots (id, market_product_id);
CREATE INDEX stock_movements_lot_idx ON stock_movements (lot_id) WHERE lot_id IS NOT NULL;

-- A sale takes each product out of each lot at most once (a sale may span several lots).
DROP INDEX stock_movements_sale_item_idx;
CREATE UNIQUE INDEX stock_movements_sale_item_idx
  ON stock_movements (sale_id, market_product_id, (coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE type = 'sale' AND sale_id IS NOT NULL;
