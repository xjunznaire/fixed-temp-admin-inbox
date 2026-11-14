PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mailboxes (
  address TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  from_address TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  received_at INTEGER NOT NULL,
  FOREIGN KEY (to_address) REFERENCES mailboxes(address) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_to_received
ON messages(to_address, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_mailboxes_expiry
ON mailboxes(expires_at);

-- Admin dashboard accounts and sessions.
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

-- Audit trail for mailbox creation and inbox checks/views.
CREATE TABLE IF NOT EXISTS inbox_history (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'visitor',
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_history_created ON inbox_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_history_address ON inbox_history(address, created_at DESC);
