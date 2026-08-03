ALTER TABLE catalog_projects ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'unclassified';
ALTER TABLE catalog_projects ADD COLUMN lifecycle_source TEXT NOT NULL DEFAULT 'migration';
ALTER TABLE catalog_projects ADD COLUMN lifecycle_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_catalog_projects_lifecycle ON catalog_projects(lifecycle, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_deployment_requirements (
  project_id TEXT PRIMARY KEY,
  architecture TEXT,
  runtime TEXT,
  min_cpu REAL,
  min_memory_mb INTEGER,
  min_disk_gb INTEGER,
  stateful INTEGER NOT NULL DEFAULT 0,
  required_region TEXT,
  network_requirements TEXT NOT NULL DEFAULT '[]',
  storage_requirements TEXT NOT NULL DEFAULT '[]',
  max_downtime_minutes INTEGER,
  health_check_url TEXT,
  rollback_strategy TEXT,
  backup_policy TEXT,
  criticality TEXT NOT NULL DEFAULT 'normal',
  confirmed_by TEXT,
  confirmed_at TEXT,
  source TEXT NOT NULL DEFAULT 'unconfirmed',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS operational_facts (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  source TEXT NOT NULL,
  value_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  valid_until TEXT,
  freshness_state TEXT NOT NULL DEFAULT 'current',
  confidence REAL NOT NULL DEFAULT 1,
  connector_id TEXT,
  run_id TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operational_facts_subject ON operational_facts(subject_type, subject_id, field_name, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_facts_freshness ON operational_facts(freshness_state, observed_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL CHECK(severity IN ('p0','p1','p2','p3')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','in_progress','resolved','ignored')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  owner_user_id TEXT,
  task_id TEXT,
  task_link_status TEXT NOT NULL DEFAULT 'pending' CHECK(task_link_status IN ('pending','linked','failed','not_required')),
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  resolved_at TEXT,
  recurrence_count INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS incident_notification_deliveries (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'opened',
  channel TEXT NOT NULL,
  destination_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','suppressed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(incident_id, event_type, channel),
  FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS incident_task_outbox (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incidents_status_severity ON incidents(status, severity, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_entity ON incidents(entity_type, entity_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_project ON incidents(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_notifications_due ON incident_notification_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_incident_outbox_due ON incident_task_outbox(status, next_attempt_at);

UPDATE catalog_projects SET lifecycle='unclassified', lifecycle_source='migration', lifecycle_updated_at=COALESCE(updated_at, datetime('now')) WHERE lifecycle IS NULL OR lifecycle='';
