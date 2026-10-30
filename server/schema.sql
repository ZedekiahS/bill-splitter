CREATE TABLE IF NOT EXISTS bs_schema (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bs_users (
  id uuid PRIMARY KEY, display_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Provider identities are separate from the permanent user ID used by ledgers.
CREATE TABLE IF NOT EXISTS bs_identities (
  provider text NOT NULL, subject text NOT NULL, user_id uuid NOT NULL REFERENCES bs_users(id),
  password_hash text, verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY(provider,subject), UNIQUE(user_id,provider)
);
CREATE TABLE IF NOT EXISTS bs_sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES bs_users(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_session_expiry ON bs_sessions(expires_at);
CREATE TABLE IF NOT EXISTS bs_auth_limits (
  key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
-- A ledger is a transaction aggregate: locking its row serializes related writes
-- without locking other ledgers. Receipts are kept out of the JSON document.
CREATE TABLE IF NOT EXISTS bs_ledgers (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES bs_users(id), body jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bs_ledgers ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS bs_memberships (
  ledger_id uuid NOT NULL REFERENCES bs_ledgers(id), user_id uuid NOT NULL REFERENCES bs_users(id),
  PRIMARY KEY(ledger_id,user_id)
);
CREATE INDEX IF NOT EXISTS bs_membership_user ON bs_memberships(user_id);
CREATE TABLE IF NOT EXISTS bs_invites (
  id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES bs_ledgers(id)
);
CREATE TABLE IF NOT EXISTS bs_receipts (
  id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES bs_ledgers(id), expense_id uuid NOT NULL,
  name text NOT NULL, mime text NOT NULL, bytes bytea NOT NULL,
  CHECK (octet_length(bytes) BETWEEN 1 AND 204800)
);
CREATE TABLE IF NOT EXISTS bs_requests (
  user_id uuid NOT NULL REFERENCES bs_users(id), key uuid NOT NULL, fingerprint text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
INSERT INTO bs_schema(version) VALUES (1) ON CONFLICT DO NOTHING;
