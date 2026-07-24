CREATE TABLE IF NOT EXISTS discovered_assets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  parent_external_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  region TEXT,
  url TEXT,
  server_id TEXT,
  project_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_verified_at TEXT,
  stale_after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, account_id, kind, external_id),
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE SET NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS asset_discovery_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT 'default',
  mode TEXT NOT NULL DEFAULT 'incremental',
  status TEXT NOT NULL DEFAULT 'queued',
  discovered_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  stale_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resource_links (
  id TEXT PRIMARY KEY,
  source_asset_id TEXT NOT NULL,
  target_asset_id TEXT,
  project_id TEXT,
  relationship TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'confirmed',
  evidence TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_asset_id, target_asset_id, project_id, relationship),
  FOREIGN KEY(source_asset_id) REFERENCES discovered_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(target_asset_id) REFERENCES discovered_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assets_provider_kind ON discovered_assets(provider,kind);
CREATE INDEX IF NOT EXISTS idx_assets_server ON discovered_assets(server_id,kind);
CREATE INDEX IF NOT EXISTS idx_assets_project ON discovered_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_seen ON discovered_assets(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_provider ON asset_discovery_runs(provider,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_links_status ON resource_links(status,relationship);
