CREATE TABLE organization_branding (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  logo_data_url text CHECK (octet_length(logo_data_url) <= 700000)
);
ALTER TABLE organization_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_branding
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON organization_branding TO market77_app;
