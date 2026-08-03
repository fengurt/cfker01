ALTER TABLE servers ADD COLUMN region TEXT;

CREATE INDEX IF NOT EXISTS idx_servers_region ON servers(region);
