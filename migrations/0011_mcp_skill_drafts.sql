-- Agent-authored skills remain drafts until a local, authenticated GitHub
-- publisher creates a branch and pull request. Raw API keys are never stored.
CREATE TABLE IF NOT EXISTS mcp_skill_drafts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','validated','publish_requested','published','rejected')),
  validation TEXT NOT NULL DEFAULT '{}',
  target_repo TEXT NOT NULL DEFAULT 'fengurt/cfker01',
  target_path TEXT NOT NULL,
  branch TEXT,
  github_pr_url TEXT,
  published_commit_sha TEXT,
  created_by_key_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_skill_drafts_slug_updated
  ON mcp_skill_drafts(slug, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_skill_drafts_status_updated
  ON mcp_skill_drafts(status, updated_at DESC);
