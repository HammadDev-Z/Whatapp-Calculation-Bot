CREATE TABLE IF NOT EXISTS groups (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_group_id TEXT NOT NULL UNIQUE,
  whatsapp_group_name TEXT NOT NULL,
  display_name TEXT,
  current_total NUMERIC(20, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_number TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  expression TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('calculation', 'adjustment', 'reset', 'undo')),
  amount NUMERIC(20, 2) NOT NULL,
  balance_before NUMERIC(20, 2) NOT NULL,
  balance_after NUMERIC(20, 2) NOT NULL,
  undone_transaction_id BIGINT REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_whatsapp_group_id ON groups (whatsapp_group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_group_created ON transactions (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_message_id ON transactions (message_id);
