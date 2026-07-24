CREATE TABLE IF NOT EXISTS resource_snapshots (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_snapshots_generated_at ON resource_snapshots(generated_at DESC);
