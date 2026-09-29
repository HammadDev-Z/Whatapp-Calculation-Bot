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
