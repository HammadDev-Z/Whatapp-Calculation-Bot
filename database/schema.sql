-- Applied in full by `npm run migrate` on every deploy, so every statement must be idempotent.
-- The `groups` / `transactions` tables from the previous version are no longer used and are
-- left untouched in existing databases.

CREATE TABLE IF NOT EXISTS calculation_balances (
  group_id      TEXT PRIMARY KEY,
  current_total NUMERIC(20, 2) NOT NULL DEFAULT 0,
  group_name    TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE, -- controls visibility in /calculate only
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 'addition' / 'subtraction' / 'multiplication' are legacy values; the parser only
-- emits 'adjustment' or 'expression'.
CREATE TABLE IF NOT EXISTS calculation_transactions (
  id               BIGSERIAL PRIMARY KEY,
  group_id         TEXT NOT NULL REFERENCES calculation_balances(group_id) ON DELETE CASCADE,
  message_id       TEXT NOT NULL UNIQUE,
  sender           TEXT NOT NULL,
  expression       TEXT NOT NULL,
  calculation_type TEXT NOT NULL CHECK (calculation_type IN
                     ('adjustment', 'addition', 'subtraction', 'multiplication', 'expression')),
  amount           NUMERIC(20, 2) NOT NULL,
  balance_before   NUMERIC(20, 2) NOT NULL,
  balance_after    NUMERIC(20, 2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calculation_transactions_group_created_idx
  ON calculation_transactions (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS calculate_access_groups (
  group_id   TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calculate_access_groups_active_idx ON calculate_access_groups (active);

-- Website admin account(s) and login sessions. Passwords are stored as scrypt hashes.
CREATE TABLE IF NOT EXISTS admin_users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id   BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Numbers (digits only, with country code) whose messages the bot answers. A message from a
-- number that is not here, or is not active, is ignored. Managed from the website.
CREATE TABLE IF NOT EXISTS allowed_numbers (
  number     TEXT PRIMARY KEY,
  label      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-group settings. `label` is the name shown in the receipt header: "MUSHFIK X <LABEL>"; no
-- label = the default "MUSHFIK STORE" header. The website lists the union of this table and
-- calculation_balances, so every group with a balance can be labelled.
CREATE TABLE IF NOT EXISTS bot_groups (
  group_id      TEXT PRIMARY KEY,
  detected_name TEXT,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Senders whose calculation or /calculate message was ignored because their number is not
-- allowed. Shown on the website so they can be added with one click.
CREATE TABLE IF NOT EXISTS ignored_senders (
  sender_id     TEXT PRIMARY KEY,
  number        TEXT NOT NULL,
  push_name     TEXT,
  last_group_id TEXT,
  message_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
