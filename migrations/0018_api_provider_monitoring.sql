ALTER TABLE admin_device_sessions ADD COLUMN last_reauthenticated_at TEXT;

CREATE TABLE IF NOT EXISTS api_provider_connectors (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_label TEXT NOT NULL,
  credential_kind TEXT NOT NULL DEFAULT 'api_key',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  credential_status TEXT NOT NULL DEFAULT 'unconfigured',
  overall_status TEXT NOT NULL DEFAULT 'unconfigured',
  probe_model TEXT,
  interval_seconds INTEGER NOT NULL DEFAULT 14400,
  inference_interval_seconds INTEGER NOT NULL DEFAULT 86400,
  last_checked_at TEXT,
  last_success_at TEXT,
  last_inference_at TEXT,
  next_due_at TEXT,
  stale_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_provider_probe_runs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES api_provider_connectors(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'standard',
  credential_status TEXT NOT NULL,
  overall_status TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  request_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(connector_id, run_id)
);

CREATE TABLE IF NOT EXISTS api_provider_probe_events (
  id TEXT PRIMARY KEY,
  probe_run_id TEXT NOT NULL REFERENCES api_provider_probe_runs(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL REFERENCES api_provider_connectors(id) ON DELETE CASCADE,
  probe_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  latency_ms INTEGER,
  model TEXT,
  model_count INTEGER,
  quota_summary TEXT,
  error_code TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(probe_run_id, probe_kind)
);

CREATE TABLE IF NOT EXISTS api_provider_probe_jobs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES api_provider_connectors(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT,
  requested_by TEXT,
  queued_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS api_provider_probe_events_connector_observed
  ON api_provider_probe_events(connector_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS api_provider_probe_jobs_status
  ON api_provider_probe_jobs(status, queued_at);

INSERT OR IGNORE INTO api_provider_connectors(id,provider,account_label,credential_kind,created_at,updated_at) VALUES
  ('doubao-ark','doubao','Volcengine Ark','general',datetime('now'),datetime('now')),
  ('minimax-api','minimax','MiniMax API','general',datetime('now'),datetime('now')),
  ('minimax-coding-plan','minimax','MiniMax Coding Plan','subscription',datetime('now'),datetime('now')),
  ('openai','openai','OpenAI','general',datetime('now'),datetime('now')),
  ('perplexity','perplexity','Perplexity','general',datetime('now'),datetime('now')),
  ('moonshot','moonshot','Kimi / Moonshot','general',datetime('now'),datetime('now')),
  ('gemini','gemini','Google Gemini','general',datetime('now'),datetime('now'));
