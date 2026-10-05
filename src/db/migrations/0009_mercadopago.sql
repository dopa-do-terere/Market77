-- Phase 7: Mercado Pago. Credentials per organization (encrypted by the app, never readable as plain text)
-- and the Point machine paired with a totem.
CREATE TABLE provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  provider text NOT NULL CHECK (provider IN ('mercadopago')),
  access_token_enc text NOT NULL,
  webhook_secret_enc text NOT NULL,
  token_last4 text NOT NULL CHECK (char_length(token_last4) = 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON provider_credentials
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_credentials TO market77_app;

ALTER TABLE terminals ADD COLUMN point_device_id text
  CHECK (point_device_id IS NULL OR char_length(point_device_id) BETWEEN 1 AND 64);
GRANT UPDATE (point_device_id) ON terminals TO market77_app;
