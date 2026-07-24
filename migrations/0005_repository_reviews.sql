CREATE TABLE IF NOT EXISTS repository_scan_runs (
  id TEXT PRIMARY KEY, mode TEXT NOT NULL, status TEXT NOT NULL,
  source_root TEXT, repository_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0, cache_hit_count INTEGER NOT NULL DEFAULT 0,
  token_input INTEGER NOT NULL DEFAULT 0, token_output INTEGER NOT NULL DEFAULT 0,
  error TEXT, started_at TEXT NOT NULL, completed_at TEXT
);

CREATE TABLE IF NOT EXISTS repository_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT, canonical_key TEXT NOT NULL UNIQUE,
  github_owner TEXT, github_repo TEXT, repository_url TEXT, local_paths TEXT NOT NULL DEFAULT '[]',
  head_sha TEXT, branch TEXT, dirty INTEGER NOT NULL DEFAULT 0, ahead INTEGER, behind INTEGER,
  default_branch TEXT, pushed_at TEXT, visibility TEXT, archived INTEGER NOT NULL DEFAULT 0,
  fork INTEGER NOT NULL DEFAULT 0, ci_status TEXT, release_name TEXT, topics TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL, dossier TEXT NOT NULL, dossier_bytes INTEGER NOT NULL,
  github_metadata TEXT NOT NULL DEFAULT '{}', scan_evidence TEXT NOT NULL DEFAULT '[]',
  last_scanned_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS repository_reviews (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, project_id TEXT,
  fingerprint TEXT NOT NULL, review_version TEXT NOT NULL, status TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0, summary TEXT, suggested_description TEXT,
  suggested_types TEXT NOT NULL DEFAULT '[]', suggested_tags TEXT NOT NULL DEFAULT '[]',
  maturity TEXT, recommendations TEXT NOT NULL DEFAULT '[]', evidence TEXT NOT NULL DEFAULT '[]',
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_hit INTEGER NOT NULL DEFAULT 0, error TEXT, reviewed_at TEXT NOT NULL,
  FOREIGN KEY(snapshot_id) REFERENCES repository_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS repository_review_candidates (
  id TEXT PRIMARY KEY, project_id TEXT, snapshot_id TEXT NOT NULL, field_name TEXT NOT NULL,
  proposed_value TEXT NOT NULL, current_value TEXT, confidence REAL NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
  reviewed_at TEXT, reviewed_by TEXT,
  FOREIGN KEY(snapshot_id) REFERENCES repository_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repository_snapshots_project ON repository_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_repository_reviews_snapshot ON repository_reviews(snapshot_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_repository_candidates_status ON repository_review_candidates(status, created_at DESC);
