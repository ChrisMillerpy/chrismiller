-- Chat names, artifacts and stored files. Safe to run more than once (the Worker
-- ignores "duplicate column" from the ALTER on later runs).

-- Who named the chat: null (first message), 'cathy' (set_title) or 'chris' (renamed it).
-- Cathy never overwrites a name Chris chose.
ALTER TABLE sessions ADD COLUMN named_by TEXT;

-- Files Cathy publishes. Bytes live in blobs under the same id.
CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,                -- short random id
  session_id  TEXT NOT NULL,                   -- chat that made it
  title       TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'private', -- private | link | public
  token       TEXT NOT NULL,                   -- unguessable part of the share link
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_recent ON artifacts (updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS artifacts_token ON artifacts (token);

-- Files Chris attaches to a chat message. Bytes live in blobs as upload:<id>.
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- File bytes in 1 MB parts (D1 caps a value at 2 MB): artifacts and chat attachments.
CREATE TABLE IF NOT EXISTS blobs (
  id    TEXT NOT NULL,
  part  INTEGER NOT NULL,
  data  BLOB NOT NULL,
  PRIMARY KEY (id, part)
);
