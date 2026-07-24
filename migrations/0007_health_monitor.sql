ALTER TABLE servers ADD COLUMN provider_resource_id TEXT;
ALTER TABLE servers ADD COLUMN cloud_status TEXT;
ALTER TABLE servers ADD COLUMN cloud_checked_at TEXT;
ALTER TABLE servers ADD COLUMN health_status TEXT;
ALTER TABLE servers ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN last_healthy_at TEXT;

ALTER TABLE deployments ADD COLUMN health_status TEXT;
ALTER TABLE deployments ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deployments ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deployments ADD COLUMN last_healthy_at TEXT;

CREATE TABLE IF NOT EXISTS availability_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,
  previous_status TEXT,
  error_code TEXT,
  http_status INTEGER,
  latency_ms INTEGER,
  started_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  healthy_count INTEGER NOT NULL DEFAULT 0,
  degraded_count INTEGER NOT NULL DEFAULT 0,
  down_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_availability_events_entity ON availability_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_events_open ON availability_events(resolved_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_started ON monitor_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_servers_provider_resource ON servers(provider, provider_resource_id);

UPDATE servers SET manual_status = NULL WHERE manual_status IN ('online', 'offline');
