INSERT OR IGNORE INTO source_connectors(id,provider,account_id,name,scanner_kind,enabled,interval_seconds,credential_status,next_due_at,created_at,updated_at)
VALUES
  ('central-ens','ens','ethereum-mainnet','ENS / Ethereum','central',1,86400,'unconfigured',datetime('now'),datetime('now'),datetime('now')),
  ('central-solana','solana','sns','Solana Name Service','central',1,86400,'unconfigured',datetime('now'),datetime('now'),datetime('now'));
