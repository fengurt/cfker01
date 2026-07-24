CREATE TABLE IF NOT EXISTS source_connectors (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  scanner_kind TEXT NOT NULL DEFAULT 'central',
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_seconds INTEGER NOT NULL DEFAULT 14400,
  credential_status TEXT NOT NULL DEFAULT 'unknown',
  last_success_at TEXT,
  next_due_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, account_id)
);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'incremental',
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL DEFAULT 'schedule',
  lease_owner TEXT,
  lease_until TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_id TEXT,
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT NOT NULL,
  claimed_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(connector_id) REFERENCES source_connectors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scanner_service_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  connector_ids TEXT NOT NULL DEFAULT '[]',
  allowed_providers TEXT NOT NULL DEFAULT '[]',
  allowed_accounts TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_batches (
  run_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  asset_count INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  PRIMARY KEY(run_id, batch_index),
  FOREIGN KEY(run_id) REFERENCES asset_discovery_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_annotations (
  asset_id TEXT PRIMARY KEY,
  display_name TEXT,
  description TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private',
  ignored INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  pin_rank INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(asset_id) REFERENCES discovered_assets(id) ON DELETE CASCADE
);

ALTER TABLE discovered_assets ADD COLUMN content_hash TEXT;
ALTER TABLE discovered_assets ADD COLUMN source_run_id TEXT;

ALTER TABLE asset_discovery_runs ADD COLUMN connector_id TEXT;
ALTER TABLE asset_discovery_runs ADD COLUMN job_id TEXT;
ALTER TABLE asset_discovery_runs ADD COLUMN schema_version TEXT;
ALTER TABLE asset_discovery_runs ADD COLUMN fingerprint TEXT;
ALTER TABLE asset_discovery_runs ADD COLUMN received_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_discovery_runs ADD COLUMN new_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_discovery_runs ADD COLUMN unchanged_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_connectors_due ON source_connectors(enabled, next_due_at);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_queue ON scan_jobs(status, priority DESC, queued_at);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_connector ON scan_jobs(connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanner_keys_active ON scanner_service_keys(revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_assets_content_hash ON discovered_assets(content_hash);
CREATE INDEX IF NOT EXISTS idx_assets_source_run ON discovered_assets(source_run_id);
CREATE INDEX IF NOT EXISTS idx_annotations_visibility ON asset_annotations(visibility, pinned, pin_rank);

INSERT OR IGNORE INTO source_connectors(id,provider,account_id,name,scanner_kind,enabled,interval_seconds,credential_status,next_due_at,created_at,updated_at)
VALUES
  ('central-tencent','tencent','*','Tencent Cloud','central',1,14400,'configured',datetime('now'),datetime('now'),datetime('now')),
  ('central-github','github','*','GitHub','central',1,14400,'configured',datetime('now'),datetime('now'),datetime('now')),
  ('central-docker','docker','*','Docker runtimes','central',1,14400,'configured',datetime('now'),datetime('now'),datetime('now')),
  ('central-cloudflare','cloudflare','*','Cloudflare','central',1,14400,'unconfigured',datetime('now'),datetime('now'),datetime('now')),
  ('local-cpro01','local','cpro01','Mac /Users/af/cpro01','local',1,14400,'configured',datetime('now'),datetime('now'),datetime('now'));
