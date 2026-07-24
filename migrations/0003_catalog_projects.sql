CREATE TABLE IF NOT EXISTS catalog_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  resource_types TEXT NOT NULL DEFAULT 'project',
  platform TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  homepage TEXT,
  repository_url TEXT,
  languages TEXT NOT NULL DEFAULT '[]',
  frameworks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'public',
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_catalog_projects_platform ON catalog_projects (platform);
CREATE INDEX IF NOT EXISTS idx_catalog_projects_status ON catalog_projects (status);
CREATE INDEX IF NOT EXISTS idx_catalog_projects_source_kind ON catalog_projects (source_kind);
