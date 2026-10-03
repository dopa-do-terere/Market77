-- Phase 3: totem agent. Heartbeat state on terminals, the remote command queue, and agent packages.
ALTER TABLE terminals
  ADD COLUMN last_heartbeat_at timestamptz,
  ADD COLUMN agent_version text,
  ADD COLUMN pdv_status text CHECK (pdv_status IN ('running', 'stopped'));

CREATE TABLE terminal_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('restart_pdv', 'reboot', 'update')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'succeeded', 'failed')),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  finished_at timestamptz,
  error text,
  UNIQUE (id, org_id),
  FOREIGN KEY (terminal_id, org_id) REFERENCES terminals (id, org_id)
);
CREATE INDEX terminal_commands_terminal_idx ON terminal_commands (terminal_id, created_at DESC);
-- At most one open command of each type per terminal (the panel cannot stack reboots).
CREATE UNIQUE INDEX terminal_commands_open_idx
  ON terminal_commands (terminal_id, type) WHERE status IN ('pending', 'delivered');

ALTER TABLE terminal_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminal_commands
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON terminal_commands TO market77_app;

-- Agent packages are the same for every tenant: no org_id, no RLS, no grant for the application role.
-- Only adminSql (through ReleaseStore) reads or writes them.
CREATE TABLE agent_releases (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
