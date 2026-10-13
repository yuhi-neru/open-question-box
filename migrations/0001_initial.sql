PRAGMA foreign_keys = ON;
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  bio TEXT NOT NULL,
  accepting INTEGER NOT NULL DEFAULT 1 CHECK (accepting IN (0, 1))
);
INSERT INTO profile (id, name, bio) VALUES (1, 'わたしの質問箱', '質問でも、感想でも、ちょっとしたひとことでも。気軽に送ってください。');
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'feedback', 'idea', 'bug')),
  status TEXT NOT NULL DEFAULT 'unanswered' CHECK (status IN ('unanswered', 'answered', 'archived')),
  answer TEXT,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX messages_status_date ON messages(status, created_at DESC, id DESC);
CREATE INDEX messages_public_date ON messages(published, updated_at DESC, id DESC);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  created_at TEXT NOT NULL
);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, delivered_at INTEGER,
  claim_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX webhook_pending ON webhook_events(delivered_at, next_attempt_at);
