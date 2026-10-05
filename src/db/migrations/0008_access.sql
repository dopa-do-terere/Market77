-- Phase 6: access log. Readers push entry events; the list of people is pulled from the reader.
-- No face image or template is ever stored: only the opaque person id the reader sends.
CREATE TABLE access_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_sync_at timestamptz,
  last_sync_error text,
  last_event_at timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id)
);

CREATE TABLE access_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  source_id uuid NOT NULL,
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 64),
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  forgotten_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (source_id, org_id) REFERENCES access_sources (id, org_id)
);

CREATE TABLE access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  source_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'entry' CHECK (kind IN ('entry')),
  person_external_id text CHECK (person_external_id IS NULL OR char_length(person_external_id) BETWEEN 1 AND 64),
  event_id text CHECK (event_id IS NULL OR char_length(event_id) BETWEEN 1 AND 64),
  FOREIGN KEY (source_id, org_id) REFERENCES access_sources (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id)
);
CREATE UNIQUE INDEX access_events_dedupe_idx ON access_events (source_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX access_events_market_idx ON access_events (market_id, occurred_at);
CREATE INDEX access_events_time_idx ON access_events (occurred_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['access_sources', 'access_people', 'access_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- No DELETE for the app role: retention deletes with the admin role, forgetting a person is an UPDATE.
GRANT SELECT, INSERT, UPDATE ON access_sources, access_people, access_events TO market77_app;
