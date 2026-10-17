-- Sub-agents: a Cathy can start child chats that work in parallel. A child is a normal
-- session (own Durable Object, box and branch) with a parent. Safe to run more than once.

-- The chat that started this one; null for chats Chris started.
ALTER TABLE sessions ADD COLUMN parent_id TEXT;
-- How the child started: fresh (just the task) | fork (copy of the parent's conversation) | custom (extra instructions).
ALTER TABLE sessions ADD COLUMN mode TEXT;
-- The task the parent gave it, and any extra instructions (custom mode). Shown in admin.
ALTER TABLE sessions ADD COLUMN task TEXT;
ALTER TABLE sessions ADD COLUMN instructions TEXT;
-- working | idle. Kept for every chat, so admin can show which ones are busy.
ALTER TABLE sessions ADD COLUMN state TEXT NOT NULL DEFAULT 'idle';
CREATE INDEX IF NOT EXISTS sessions_parent ON sessions (parent_id, created_at);
