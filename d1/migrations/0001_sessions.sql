-- The registry: which Cathy chats exist. Messages live in each chat's own Durable Object.
-- Safe to run more than once; the Cathy Worker applies it on first use.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,               -- short random id, e.g. "k3f9q2"
  title        TEXT NOT NULL,                  -- first message, trimmed
  branch       TEXT NOT NULL,                  -- cathy/<id>
  status       TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_message TEXT                            -- preview for the explorer
);
CREATE INDEX IF NOT EXISTS sessions_active ON sessions (status, updated_at DESC);
