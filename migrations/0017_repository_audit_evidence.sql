ALTER TABLE repository_snapshots ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE repository_snapshots ADD COLUMN hygiene TEXT NOT NULL DEFAULT '{}';
ALTER TABLE repository_snapshots ADD COLUMN deployment_status TEXT NOT NULL DEFAULT 'not_checked';
ALTER TABLE repository_snapshots ADD COLUMN deployment_evidence TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_repository_snapshots_sync_status ON repository_snapshots(sync_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_repository_snapshots_deployment_status ON repository_snapshots(deployment_status, updated_at DESC);
