-- Phase 5B: NFC-e. Fiscal data on markets and products, the customer CPF on a sale, and a document queue.
ALTER TABLE markets
  ADD COLUMN nfce_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN state_registration text,
  ADD COLUMN uf text CHECK (uf ~ '^[A-Z]{2}$'),
  ADD COLUMN tax_regime text NOT NULL DEFAULT 'simples' CHECK (tax_regime IN ('simples', 'normal')),
  ADD COLUMN nfce_series integer NOT NULL DEFAULT 1 CHECK (nfce_series BETWEEN 1 AND 999);

ALTER TABLE products
  ADD COLUMN ncm text CHECK (ncm ~ '^[0-9]{8}$'),
  ADD COLUMN cest text CHECK (cest ~ '^[0-9]{7}$'),
  ADD COLUMN cfop text NOT NULL DEFAULT '5102' CHECK (cfop ~ '^[0-9]{4}$'),
  ADD COLUMN csosn text NOT NULL DEFAULT '102' CHECK (csosn ~ '^[0-9]{3}$'),
  ADD COLUMN unit text NOT NULL DEFAULT 'UN' CHECK (char_length(unit) BETWEEN 1 AND 6),
  ADD COLUMN origin smallint NOT NULL DEFAULT 0 CHECK (origin BETWEEN 0 AND 8);

ALTER TABLE sales ADD COLUMN customer_cpf text CHECK (customer_cpf ~ '^[0-9]{11}$');

CREATE TABLE fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  market_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'error')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  payload jsonb NOT NULL,
  provider text,
  external_id text,
  number integer,
  access_key text,
  danfe_url text,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id)
);
CREATE INDEX fiscal_documents_due_idx ON fiscal_documents (next_attempt_at) WHERE status = 'pending';
CREATE UNIQUE INDEX fiscal_documents_external_idx
  ON fiscal_documents (provider, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE fiscal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fiscal_documents
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON fiscal_documents TO market77_app;
