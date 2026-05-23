-- cfker01 management audit log
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events (event_type);
