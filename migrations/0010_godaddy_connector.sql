-- GoDaddy domain/DNS discovery is opt-in: credentials are materialized only at runtime.
INSERT OR IGNORE INTO source_connectors(id,provider,account_id,name,scanner_kind,enabled,interval_seconds,credential_status,next_due_at,created_at,updated_at)
VALUES ('central-godaddy','godaddy','*','GoDaddy','central',1,14400,'unconfigured',datetime('now'),datetime('now'),datetime('now'));
