CREATE TABLE IF NOT EXISTS asset_map_version_chunks (
  version_id TEXT NOT NULL REFERENCES asset_map_versions(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(version_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_asset_map_version_chunks_version
  ON asset_map_version_chunks(version_id, chunk_index);
