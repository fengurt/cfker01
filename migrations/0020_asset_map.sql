CREATE TABLE IF NOT EXISTS asset_map_annotations (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL UNIQUE,
  label TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  actor_type TEXT NOT NULL DEFAULT 'admin',
  actor_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_map_manual_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','candidate','rejected')),
  confidence REAL NOT NULL DEFAULT 1 CHECK(confidence >= 0 AND confidence <= 1),
  evidence TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  actor_type TEXT NOT NULL DEFAULT 'admin',
  actor_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id,target_id,relationship)
);

CREATE TABLE IF NOT EXISTS asset_map_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual',
  snapshot TEXT NOT NULL,
  summary TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_map_annotations_updated ON asset_map_annotations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_map_edges_source ON asset_map_manual_edges(source_id,status);
CREATE INDEX IF NOT EXISTS idx_asset_map_edges_target ON asset_map_manual_edges(target_id,status);
CREATE INDEX IF NOT EXISTS idx_asset_map_versions_created ON asset_map_versions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_map_versions_hash ON asset_map_versions(content_hash,created_at DESC);
