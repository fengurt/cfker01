CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_principals (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('user','agent','system')),
  external_id text,
  display_name text NOT NULL,
  email text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, external_id)
);

CREATE TABLE IF NOT EXISTS task_organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_organization_members (
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES task_principals(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member','guest')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, principal_id)
);

CREATE TABLE IF NOT EXISTS task_invites (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL CHECK (role IN ('admin','member','guest')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  catalog_project_id text,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  restricted boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, catalog_project_id)
);

CREATE TABLE IF NOT EXISTS task_project_members (
  project_id uuid NOT NULL REFERENCES task_projects(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES task_principals(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','guest')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, principal_id)
);

CREATE SEQUENCE IF NOT EXISTS task_identifier_sequence START 1;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  identifier text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','todo','in_progress','blocked','in_review','done','cancelled')),
  priority smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 4),
  owner_id uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  milestone_id uuid,
  start_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  expected_value_minor bigint,
  currency char(3) NOT NULL DEFAULT 'CNY',
  value_confidence smallint CHECK (value_confidence BETWEEN 0 AND 100),
  strategic_value smallint CHECK (strategic_value BETWEEN 1 AND 5),
  delivery_domain text,
  visibility text NOT NULL DEFAULT 'organization' CHECK (visibility IN ('organization','project_members','private')),
  version bigint NOT NULL DEFAULT 1,
  created_by uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_at IS NULL OR due_at IS NULL OR start_at <= due_at)
);

CREATE TABLE IF NOT EXISTS task_project_links (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES task_projects(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id, project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_project_per_task ON task_project_links(task_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS task_participants (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES task_principals(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'collaborator' CHECK (role IN ('collaborator','agent','counterpart','reviewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id, principal_id, role)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'blocks' CHECK (dependency_type IN ('blocks','related')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id, depends_on_task_id),
  CHECK(task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body text NOT NULL,
  actor_id uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  media_type text,
  size_bytes bigint,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  checksum text,
  created_by uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_milestones (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  project_id uuid REFERENCES task_projects(id) ON DELETE SET NULL,
  target_at timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_milestone_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_milestone_id_fkey FOREIGN KEY (milestone_id) REFERENCES task_milestones(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_boards (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES task_projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL,
  view_type text NOT NULL DEFAULT 'board' CHECK (view_type IN ('list','board','gantt')),
  grouping text NOT NULL DEFAULT 'status' CHECK (grouping IN ('status','priority','owner','milestone','delivery_domain','custom')),
  filters jsonb NOT NULL DEFAULT '{}',
  columns jsonb NOT NULL DEFAULT '[]',
  shared boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);

CREATE TABLE IF NOT EXISTS task_board_memberships (
  board_id uuid NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  lane_key text,
  rank numeric(30,12) NOT NULL DEFAULT 1000,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(board_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_saved_views (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  principal_id uuid REFERENCES task_principals(id) ON DELETE CASCADE,
  name text NOT NULL,
  view_type text NOT NULL CHECK (view_type IN ('list','board','gantt')),
  filters jsonb NOT NULL DEFAULT '{}',
  group_by text,
  sort_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_events (
  sequence bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  event_type text NOT NULL,
  actor_id uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_api_keys (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES task_principals(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  project_ids uuid[] NOT NULL DEFAULT '{}',
  field_policy jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_idempotency (
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES task_principals(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY(organization_id, actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS task_webhooks (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES task_organizations(id) ON DELETE CASCADE,
  url text NOT NULL,
  event_types text[] NOT NULL DEFAULT '{}',
  secret_ciphertext text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES task_principals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_webhook_deliveries (
  id uuid PRIMARY KEY,
  webhook_id uuid NOT NULL REFERENCES task_webhooks(id) ON DELETE CASCADE,
  event_sequence bigint NOT NULL REFERENCES task_events(sequence) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','delivered','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  response_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(webhook_id, event_sequence)
);

CREATE INDEX IF NOT EXISTS idx_tasks_org_updated ON tasks(organization_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks(organization_id, status, due_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_events_org_sequence ON task_events(organization_id, sequence);
CREATE INDEX IF NOT EXISTS idx_task_board_memberships_rank ON task_board_memberships(board_id, lane_key, rank);
CREATE INDEX IF NOT EXISTS idx_task_webhook_deliveries_due ON task_webhook_deliveries(status, next_attempt_at);
