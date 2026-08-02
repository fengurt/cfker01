CREATE TABLE IF NOT EXISTS admin_device_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  ip_prefix TEXT,
  user_agent_hash TEXT,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_device_sessions_user ON admin_device_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_device_sessions_expiry ON admin_device_sessions(expires_at);
