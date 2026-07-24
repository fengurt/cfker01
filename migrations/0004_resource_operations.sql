ALTER TABLE catalog_projects ADD COLUMN source_updated_at TEXT;
ALTER TABLE catalog_projects ADD COLUMN last_scanned_at TEXT;
ALTER TABLE catalog_projects ADD COLUMN update_provenance TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 310000,
  role TEXT NOT NULL DEFAULT 'system_admin',
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_tags (project_id TEXT NOT NULL, tag_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,tag_id), FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE CASCADE, FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS project_pins (project_id TEXT PRIMARY KEY, rank INTEGER NOT NULL DEFAULT 100, pinned_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS backup_repositories (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'github', repository_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main', status TEXT NOT NULL DEFAULT 'unknown', last_verified_at TEXT, last_backup_at TEXT,
  last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, ip_address TEXT, architecture TEXT,
  cpu TEXT, memory_mb INTEGER, disk_gb INTEGER, operating_system TEXT, due_at TEXT, health_url TEXT, public_url TEXT,
  status TEXT NOT NULL DEFAULT 'unknown', manual_status TEXT, last_checked_at TEXT, last_latency_ms INTEGER, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, server_id TEXT NOT NULL, environment TEXT NOT NULL,
  deployed_url TEXT, version TEXT, status TEXT NOT NULL DEFAULT 'unknown', deployed_at TEXT, last_checked_at TEXT,
  last_latency_ms INTEGER, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_type TEXT NOT NULL,
  ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, key_version TEXT NOT NULL, content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id,document_type), FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS benchmark_discovery_jobs (
  id TEXT PRIMARY KEY, project_id TEXT, query TEXT NOT NULL, providers TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  requested_by TEXT, started_at TEXT, completed_at TEXT, error TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS benchmark_candidates (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, summary TEXT,
  canonical_url TEXT NOT NULL, source_type TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT,
  confidence REAL NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES benchmark_discovery_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_candidate_canonical ON benchmark_candidates(canonical_url);
CREATE INDEX IF NOT EXISTS idx_project_tags_tag ON project_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_servers_due ON servers(due_at);
CREATE INDEX IF NOT EXISTS idx_benchmark_jobs_status ON benchmark_discovery_jobs(status);
