-- Money: Chris's Monzo transactions, sent by Monzo's webhook through the public money Worker.
-- Only what's needed to show and total spending: no account numbers, no card details. Safe to run more than once.

CREATE TABLE IF NOT EXISTS money_transactions (
  id TEXT PRIMARY KEY,            -- Monzo's transaction id (tx_...); Monzo retries webhooks, so this keeps each one once
  amount INTEGER NOT NULL,        -- pence; negative = money out
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL,    -- ms since epoch, from Monzo
  week TEXT NOT NULL,             -- Monday the week starts on, London time (YYYY-MM-DD)
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,             -- spend | refund | income | declined | pot
  decline_reason TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS money_week ON money_transactions (week, kind);

-- Small settings, e.g. which chat is the Money chat.
CREATE TABLE IF NOT EXISTS money_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
