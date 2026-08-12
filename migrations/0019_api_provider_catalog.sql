ALTER TABLE api_provider_connectors ADD COLUMN credential_expires_at TEXT;
ALTER TABLE api_provider_connectors ADD COLUMN credential_expiry_source TEXT;
ALTER TABLE api_provider_connectors ADD COLUMN subscription_expires_at TEXT;
ALTER TABLE api_provider_connectors ADD COLUMN subscription_expiry_source TEXT;
ALTER TABLE api_provider_connectors ADD COLUMN quota_resets_at TEXT;
ALTER TABLE api_provider_probe_events ADD COLUMN model_catalog_json TEXT;
