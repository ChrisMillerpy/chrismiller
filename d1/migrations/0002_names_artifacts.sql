-- Chat names, model choice, attachments and artifacts. Safe to run more than once
-- (the Worker skips "duplicate column" from the ALTERs on later runs).
-- File bytes live in R2 (binding FILES), keyed as noted below; these tables hold the facts.

-- Who named the chat: null (from the first message), 'cathy' (set_title) or 'chris'.
-- Cathy never overwrites a name Chris chose.
ALTER TABLE sessions ADD COLUMN named_by TEXT;
-- The chat's model and thinking effort; null = the defaults in cathy/worker/wrangler.jsonc.
ALTER TABLE sessions ADD COLUMN model TEXT;
ALTER TABLE sessions ADD COLUMN effort TEXT;

-- Files Chris attaches to messages. Bytes at R2 uploads/<id>.
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Files Cathy publishes. Each publish adds a version; links always serve the latest.
CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,                -- short random id
  session_id  TEXT NOT NULL,                   -- chat that made it
  title       TEXT NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'private', -- private (admin only) | link (anyone with the link)
  token       TEXT NOT NULL,                   -- unguessable part of the share link
  version     INTEGER NOT NULL,                -- latest version
  filename    TEXT NOT NULL,                   -- of the latest version
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_recent ON artifacts (updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS artifacts_token ON artifacts (token);

-- Every version of every artifact. Bytes at R2 artifacts/<artifact id>/v<version>.
CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_id TEXT NOT NULL,
  version     INTEGER NOT NULL,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, version)
);
