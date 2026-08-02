CREATE TABLE IF NOT EXISTS task_people (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('person','agent','contact')),
  display_name TEXT NOT NULL,
  handle TEXT,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_milestones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT,
  target_at TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed','cancelled')),
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog' CHECK(status IN ('backlog','todo','in_progress','blocked','in_review','done','cancelled')),
  priority INTEGER NOT NULL DEFAULT 2 CHECK(priority BETWEEN 0 AND 4),
  project_id TEXT,
  milestone_id TEXT,
  owner_id TEXT,
  start_at TEXT,
  due_at TEXT,
  completed_at TEXT,
  expected_value_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'CNY',
  value_confidence INTEGER CHECK(value_confidence IS NULL OR value_confidence BETWEEN 0 AND 100),
  strategic_value INTEGER CHECK(strategic_value IS NULL OR strategic_value BETWEEN 1 AND 5),
  delivery_domain TEXT,
  created_by_type TEXT NOT NULL DEFAULT 'admin' CHECK(created_by_type IN ('admin','agent','system')),
  created_by_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES catalog_projects(id) ON DELETE SET NULL,
  FOREIGN KEY(milestone_id) REFERENCES task_milestones(id) ON DELETE SET NULL,
  FOREIGN KEY(owner_id) REFERENCES task_people(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_participants (
  task_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK(role IN ('collaborator','agent','counterpart','reviewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id, person_id, role),
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(person_id) REFERENCES task_people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  dependency_type TEXT NOT NULL DEFAULT 'blocks' CHECK(dependency_type IN ('blocks','related')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id, depends_on_task_id),
  CHECK(task_id != depends_on_task_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  body TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('admin','agent','system')),
  actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_activity (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('admin','agent','system')),
  actor_id TEXT,
  changes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_saved_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  view_type TEXT NOT NULL DEFAULT 'list' CHECK(view_type IN ('list','board','gantt')),
  filters TEXT NOT NULL DEFAULT '{}',
  group_by TEXT,
  sort_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON tasks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_updated ON tasks(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks(delivery_domain, status);
CREATE INDEX IF NOT EXISTS idx_task_people_kind_name ON task_people(kind, display_name);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id, created_at DESC);
