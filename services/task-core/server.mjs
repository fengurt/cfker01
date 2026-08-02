import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import pg from "pg";
import { createClient } from "redis";
import { WebSocketServer } from "ws";
import {
  apiError,
  canTransition,
  cleanText,
  decryptSecret,
  encryptSecret,
  hmac,
  iso,
  parseVersion,
  randomToken,
  rankBetween,
  ROLES,
  safeEqual,
  serializeTask,
  sha256,
  STATUSES,
  uuid,
  verifySessionCookie,
} from "./lib.mjs";

const { Pool } = pg;
const PORT = Number(process.env.PORT || 8790),
  DATABASE_URL = process.env.DATABASE_URL,
  REDIS_URL = process.env.REDIS_URL || "redis://valkey:6379";
const SESSION_SECRET = process.env.SESSION_SIGNING_KEY || "",
  INTERNAL_TOKEN = process.env.TASK_CORE_INTERNAL_TOKEN || "",
  ENCRYPTION_KEY = process.env.TASK_ENCRYPTION_KEY || "";
const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORGANIZATION_SLUG || "tableai",
  DEFAULT_ORG_NAME = process.env.DEFAULT_ORGANIZATION_NAME || "TableAI Catalog";
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.POSTGRES_POOL_SIZE || 20),
  application_name: "tableai-task-core",
});
let redis = null,
  subscriber = null,
  defaultOrg = null;
const sockets = new Map();
const metrics = {
  requests: 0,
  errors: 0,
  conflicts: 0,
  events: 0,
  requestDurationMs: 0,
  eventBroadcastLagMs: 0,
};
const here = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const files = (await readdir(join(here, "migrations")))
    .filter((x) => x.endsWith(".sql"))
    .sort();
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const file of files) {
    const exists = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version=$1",
      [file],
    );
    if (exists.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        await readFile(join(here, "migrations", file), "utf8"),
      );
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
async function bootstrap() {
  const found = await pool.query(
    "SELECT * FROM task_organizations WHERE slug=$1",
    [DEFAULT_ORG_SLUG],
  );
  if (found.rowCount) defaultOrg = found.rows[0];
  else {
    const id = uuid();
    defaultOrg = (
      await pool.query(
        "INSERT INTO task_organizations(id,slug,name) VALUES($1,$2,$3) RETURNING *",
        [id, DEFAULT_ORG_SLUG, DEFAULT_ORG_NAME],
      )
    ).rows[0];
  }
}
async function connectRedis() {
  try {
    redis = createClient({ url: REDIS_URL });
    subscriber = redis.duplicate();
    redis.on("error", (error) =>
      log("redis.error", { message: error.message }),
    );
    subscriber.on("error", (error) =>
      log("redis.subscriber_error", { message: error.message }),
    );
    await Promise.all([redis.connect(), subscriber.connect()]);
    await subscriber.pSubscribe("task-events:*", (message) => {
      try {
        broadcast(JSON.parse(message));
      } catch {}
    });
  } catch (error) {
    log("redis.unavailable", { message: error.message });
    redis = subscriber = null;
  }
}

function log(event, data = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      service: "task-core",
      event,
      timestamp: new Date().toISOString(),
      ...data,
    }),
  );
}
function requestId(req) {
  return req.headers["x-request-id"] || req.headers["cf-ray"] || uuid();
}
function send(res, status, data, meta = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(meta.etag ? { etag: meta.etag } : {}),
  });
  res.end(JSON.stringify({ data, meta }));
}
function fail(res, req, error) {
  const status = Number(error.status) || 500,
    code = error.code || "internal_error";
  metrics.errors++;
  if (status === 409) metrics.conflicts++;
  if (status >= 500)
    log("request.error", {
      requestId: requestId(req),
      code,
      message: error.message,
    });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(
    JSON.stringify({
      error: {
        code,
        message: status >= 500 ? "Task service request failed." : code,
        requestId: requestId(req),
        details: error.details || null,
      },
    }),
  );
}
async function body(req, limit = 1_048_576) {
  let size = 0,
    text = "";
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw apiError("payload_too_large", 413);
    text += chunk;
  }
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw apiError("invalid_json", 400);
  }
}
function pathParts(req) {
  return new URL(req.url, "http://task-core").pathname
    .split("/")
    .filter(Boolean);
}
function query(req) {
  return new URL(req.url, "http://task-core").searchParams;
}
function bearer(req) {
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ")
    ? auth.slice(7)
    : req.headers["x-api-key"] || null;
}

async function principalForSession(session) {
  const id = String(session.uid);
  const display = String(session.phone || session.email || session.uid);
  await pool.query(
    `INSERT INTO task_principals(id,kind,external_id,display_name) VALUES($1,'user',$2,$3) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,active=true,updated_at=now()`,
    [id, id, display],
  );
  if (session.role === "system_admin")
    await pool.query(
      `INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,'owner') ON CONFLICT(organization_id,principal_id) DO UPDATE SET role='owner',updated_at=now()`,
      [defaultOrg.id, id],
    );
  return {
    id,
    kind: "user",
    system: session.role === "system_admin",
    session: true,
    organizationId: null,
    scopes: ["*"],
  };
}
async function authenticate(req) {
  if (
    INTERNAL_TOKEN &&
    safeEqual(
      String(req.headers["x-task-internal-token"] || ""),
      INTERNAL_TOKEN,
    )
  ) {
    const candidate = String(req.headers["x-task-actor-id"] || ""),
      id =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          candidate,
        )
          ? candidate
          : null,
      kind = String(req.headers["x-task-actor-type"] || "system");
    if (id)
      await pool.query(
        `INSERT INTO task_principals(id,kind,external_id,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET active=true,updated_at=now()`,
        [
          id,
          ["user", "agent", "system"].includes(kind) ? kind : "system",
          id,
          `internal:${id.slice(0, 8)}`,
        ],
      );
    return { id, kind, system: true, organizationId: null, scopes: ["*"] };
  }
  const raw = bearer(req);
  if (raw && String(raw).startsWith("tsk_")) {
    const row = (
      await pool.query(
        `SELECT k.*,p.kind FROM task_api_keys k JOIN task_principals p ON p.id=k.principal_id WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now())`,
        [sha256(raw)],
      )
    ).rows[0];
    if (!row) throw apiError("unauthorized", 401);
    pool
      .query("UPDATE task_api_keys SET last_used_at=now() WHERE id=$1", [
        row.id,
      ])
      .catch(() => {});
    return {
      id: String(row.principal_id),
      kind: row.kind,
      system: false,
      organizationId: String(row.organization_id),
      scopes: row.scopes || [],
      projectIds: (row.project_ids || []).map(String),
      fieldPolicy: row.field_policy || {},
    };
  }
  const session = SESSION_SECRET
    ? verifySessionCookie(req.headers.cookie, SESSION_SECRET)
    : null;
  if (session) return principalForSession(session);
  throw apiError("unauthorized", 401);
}
function requireScope(actor, scope) {
  if (
    actor.system ||
    actor.scopes.includes("*") ||
    actor.scopes.includes(scope)
  )
    return;
  throw apiError("forbidden", 403, { requiredScope: scope });
}
function validSessionOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return false;
  const proto = String(req.headers["x-forwarded-proto"] || "https")
      .split(",")[0]
      .trim(),
    host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
      .split(",")[0]
      .trim();
  return origin === `${proto}://${host}`;
}
async function orgFor(actor, requested, minimum = "guest") {
  const id = String(requested || actor.organizationId || defaultOrg.id);
  if (actor.system) return id;
  if (actor.organizationId && actor.organizationId !== id)
    throw apiError("cross_organization_forbidden", 403);
  const membership = (
    await pool.query(
      "SELECT role FROM task_organization_members WHERE organization_id=$1 AND principal_id=$2",
      [id, actor.id],
    )
  ).rows[0];
  if (!membership || ROLES[membership.role] < ROLES[minimum])
    throw apiError("forbidden", 403);
  return id;
}
function enforceProjectIds(actor, projectIds) {
  if (actor.system || !actor.projectIds?.length) return;
  const denied = (projectIds || [])
    .map(String)
    .filter((id) => !actor.projectIds.includes(id));
  if (denied.length)
    throw apiError("project_scope_forbidden", 403, { projectIds: denied });
}
function enforceFieldPolicy(actor, values, { creating = false } = {}) {
  if (actor.system) return;
  const allowed = actor.fieldPolicy?.allowedFields;
  if (Array.isArray(allowed)) {
    const denied = Object.keys(values).filter(
      (field) => !allowed.includes(field),
    );
    if (denied.length)
      throw apiError("field_scope_forbidden", 403, { fields: denied });
  }
  if (
    Object.hasOwn(values, "owner_id") &&
    !actor.scopes.includes("tasks:assign")
  )
    throw apiError("forbidden", 403, { requiredScope: "tasks:assign" });
  if (
    Object.hasOwn(values, "status") &&
    !(creating && values.status === "backlog") &&
    !actor.scopes.includes("tasks:transition")
  )
    throw apiError("forbidden", 403, { requiredScope: "tasks:transition" });
  if (
    actor.fieldPolicy?.denyTerminal &&
    ["done", "cancelled"].includes(values.status)
  )
    throw apiError("terminal_transition_forbidden", 403);
}
async function enforceTaskAccess(client, actor, task) {
  if (actor.system || !actor.projectIds?.length) return;
  const allowed = (task.project_ids || [])
    .map(String)
    .some((id) => actor.projectIds.includes(id));
  if (!allowed) throw apiError("project_scope_forbidden", 403);
}
function enforceBoardAccess(actor, board) {
  if (actor.system || !actor.projectIds?.length) return;
  if (
    !board?.project_id ||
    !actor.projectIds.includes(String(board.project_id))
  )
    throw apiError("project_scope_forbidden", 403);
}

async function taskRow(client, id, orgId) {
  return (
    (
      await client.query(
        `SELECT t.*,COALESCE(array_agg(l.project_id::text) FILTER(WHERE l.project_id IS NOT NULL),'{}') project_ids,max(l.project_id::text) FILTER(WHERE l.is_primary) primary_project_id,pp.name project_name,o.display_name owner_name,o.kind owner_kind,m.name milestone_name,(SELECT count(*) FROM task_dependencies d WHERE d.task_id=t.id) dependency_count,(SELECT count(*) FROM task_dependencies d JOIN tasks blocker ON blocker.id=d.depends_on_task_id WHERE d.task_id=t.id AND blocker.status NOT IN ('done','cancelled')) blocked_by_count FROM tasks t LEFT JOIN task_project_links l ON l.task_id=t.id LEFT JOIN task_projects pp ON pp.id=(SELECT project_id FROM task_project_links WHERE task_id=t.id AND is_primary LIMIT 1) LEFT JOIN task_principals o ON o.id=t.owner_id LEFT JOIN task_milestones m ON m.id=t.milestone_id WHERE (t.id::text=$1 OR t.identifier=$1) AND t.organization_id=$2 GROUP BY t.id,pp.name,o.display_name,o.kind,m.name`,
        [id, orgId],
      )
    ).rows[0] || null
  );
}
async function addEvent(
  client,
  orgId,
  type,
  aggregateType,
  aggregateId,
  actorId,
  data,
) {
  const event = (
    await client.query(
      `INSERT INTO task_events(id,organization_id,aggregate_type,aggregate_id,event_type,actor_id,data) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        uuid(),
        orgId,
        aggregateType,
        aggregateId,
        type,
        actorId,
        JSON.stringify(data || {}),
      ],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO task_webhook_deliveries(id,webhook_id,event_sequence) SELECT gen_random_uuid(),id,$1 FROM task_webhooks WHERE organization_id=$2 AND active AND ($3=ANY(event_types) OR '*'=ANY(event_types)) ON CONFLICT DO NOTHING`,
    [event.sequence, orgId, type],
  );
  return event;
}
async function publish(event) {
  if (!event) return;
  const scopedTaskId =
      event.aggregate_type === "task"
        ? event.aggregate_id
        : event.aggregate_type === "board"
          ? event.data?.taskId
          : null,
    projectIds = scopedTaskId
      ? (
          await pool.query(
            "SELECT project_id::text FROM task_project_links WHERE task_id=$1",
            [scopedTaskId],
          )
        ).rows.map((row) => row.project_id)
      : [];
  const payload = {
    type: "event",
    sequence: Number(event.sequence),
    id: event.id,
    organizationId: String(event.organization_id),
    eventType: event.event_type,
    aggregateType: event.aggregate_type,
    aggregateId: event.aggregate_id ? String(event.aggregate_id) : null,
    data: event.data,
    projectIds,
    createdAt: event.created_at,
  };
  metrics.events++;
  metrics.eventBroadcastLagMs = Math.max(
    0,
    Date.now() - new Date(event.created_at).getTime(),
  );
  if (redis)
    await redis.publish(
      `task-events:${payload.organizationId}`,
      JSON.stringify(payload),
    );
  else broadcast(payload);
}
function broadcast(payload) {
  for (const client of sockets.get(String(payload.organizationId)) || []) {
    const scoped = client.actor?.projectIds || [],
      allowed =
        !scoped.length ||
        (payload.projectIds || []).some((id) => scoped.includes(String(id)));
    if (allowed && client.readyState === 1)
      client.send(JSON.stringify(payload));
  }
}

async function mutation(req, actor, orgId, payload, handler) {
  const key =
      String(req.headers["idempotency-key"] || payload.mutationId || "").slice(
        0,
        200,
      ) || null,
    hash = sha256(JSON.stringify(payload)),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (key && actor.id) {
      const existing = (
        await client.query(
          "SELECT * FROM task_idempotency WHERE organization_id=$1 AND actor_id=$2 AND idempotency_key=$3 AND expires_at>now() FOR UPDATE",
          [orgId, actor.id, key],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== hash)
          throw apiError("idempotency_key_reused", 409);
        await client.query("COMMIT");
        return {
          status: existing.response_status,
          data: existing.response_body,
          replayed: true,
        };
      }
    }
    const result = await handler(client);
    if (key && actor.id)
      await client.query(
        `INSERT INTO task_idempotency(organization_id,actor_id,idempotency_key,request_hash,response_status,response_body) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          orgId,
          actor.id,
          key,
          hash,
          result.status || 200,
          JSON.stringify(result.data),
        ],
      );
    await client.query("COMMIT");
    const events = [
      ...(result.events || []),
      ...(result.event ? [result.event] : []),
    ];
    for (const event of events) await publish(event);
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function taskInput(input, partial = false) {
  const out = {};
  const set = (name, column, fn = (x) => x) => {
    if (!partial || Object.hasOwn(input, name)) out[column] = fn(input[name]);
  };
  set("title", "title", (v) => cleanText(v, 240, true));
  set("description", "description", (v) => cleanText(v, 20000));
  set("status", "status", (v) => {
    const value = String(v || "backlog");
    if (!STATUSES.includes(value)) throw apiError("invalid_status", 400);
    return value;
  });
  set("priority", "priority", (v) => {
    const n = Number(v ?? 2);
    if (!Number.isInteger(n) || n < 0 || n > 4)
      throw apiError("invalid_priority", 400);
    return n;
  });
  set("ownerId", "owner_id", (v) => v || null);
  set("milestoneId", "milestone_id", (v) => v || null);
  set("startAt", "start_at", iso);
  set("dueAt", "due_at", iso);
  set("expectedValue", "expected_value_minor", (v) =>
    v == null || v === "" ? null : Math.round(Number(v) * 100),
  );
  set("currency", "currency", (v) => String(v || "CNY").toUpperCase());
  set("valueConfidence", "value_confidence", (v) =>
    v == null ? null : Number(v),
  );
  set("strategicValue", "strategic_value", (v) =>
    v == null ? null : Number(v),
  );
  set("deliveryDomain", "delivery_domain", (v) => cleanText(v, 120));
  set("visibility", "visibility", (v) => String(v || "organization"));
  return out;
}
async function createTask(req, res, actor, input) {
  requireScope(actor, "tasks:write");
  const orgId = await orgFor(actor, input.organizationId, "member"),
    values = taskInput(input),
    projectIds = [
      ...new Set(
        (input.projectIds || [input.projectId]).filter(Boolean).map(String),
      ),
    ],
    primary =
      String(
        input.primaryProjectId || input.projectId || projectIds[0] || "",
      ) || null;
  enforceProjectIds(actor, projectIds);
  enforceFieldPolicy(actor, values, { creating: true });
  const result = await mutation(req, actor, orgId, input, async (client) => {
    if (projectIds.length) {
      const valid = await client.query(
        "SELECT id::text FROM task_projects WHERE organization_id=$1 AND id=ANY($2::uuid[])",
        [orgId, projectIds],
      );
      if (valid.rowCount !== projectIds.length)
        throw apiError("invalid_project", 400);
    }
    const id = input.id && actor.system ? String(input.id) : uuid();
    const identifier =
      input.identifier && actor.system
        ? String(input.identifier)
        : (await client.query("SELECT nextval('task_identifier_sequence') n"))
            .rows[0].n;
    const code = String(identifier).startsWith("T-")
      ? String(identifier)
      : `T-${String(identifier).padStart(6, "0")}`;
    const columns = Object.keys(values),
      bind = [id, orgId, code, ...columns.map((k) => values[k]), actor.id];
    await client.query(
      `INSERT INTO tasks(id,organization_id,identifier,${columns.join(",")},created_by) VALUES($1,$2,$3,${columns.map((_, i) => `$${i + 4}`).join(",")},$${columns.length + 4})`,
      bind,
    );
    for (const projectId of projectIds)
      await client.query(
        "INSERT INTO task_project_links(task_id,project_id,is_primary) VALUES($1,$2,$3)",
        [id, projectId, projectId === primary],
      );
    const row = await taskRow(client, id, orgId),
      event = await addEvent(
        client,
        orgId,
        "task.created",
        "task",
        id,
        actor.id,
        serializeTask(row),
      );
    return { status: 201, data: serializeTask(row), event };
  });
  send(res, result.status, result.data, { replayed: Boolean(result.replayed) });
}
async function updateTask(req, res, actor, id, input) {
  requireScope(actor, "tasks:write");
  const requestedVersion = parseVersion(req, input);
  if (!requestedVersion) throw apiError("version_required", 428);
  const orgId = await orgFor(actor, input.organizationId, "member"),
    values = taskInput(
      input.changes && typeof input.changes === "object"
        ? input.changes
        : input,
      true,
    );
  enforceFieldPolicy(actor, values);
  const result = await mutation(req, actor, orgId, input, async (client) => {
    const current = await taskRow(client, id, orgId);
    if (!current) throw apiError("task_not_found", 404);
    await enforceTaskAccess(client, actor, current);
    if (Number(current.version) !== requestedVersion)
      throw apiError("version_conflict", 409, {
        expectedVersion: requestedVersion,
        current: serializeTask(current),
        changedFields: Object.keys(values),
      });
    if (values.status && !canTransition(current.status, values.status))
      throw apiError("invalid_transition", 409);
    if (values.status === "done")
      values.completed_at = new Date().toISOString();
    else if (values.status && current.status === "done")
      values.completed_at = null;
    const fields = Object.keys(values);
    if (!fields.length) throw apiError("no_changes", 400);
    await client.query(
      `UPDATE tasks SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(",")},version=version+1,updated_at=now() WHERE id=$${fields.length + 1} AND organization_id=$${fields.length + 2}`,
      [...fields.map((k) => values[k]), current.id, orgId],
    );
    const row = await taskRow(client, String(current.id), orgId),
      event = await addEvent(
        client,
        orgId,
        values.status && values.status !== current.status
          ? "task.transitioned"
          : "task.updated",
        "task",
        current.id,
        actor.id,
        { version: row.version, changes: values },
      );
    return { data: serializeTask(row), event };
  });
  send(res, result.status || 200, result.data, {
    replayed: Boolean(result.replayed),
  });
}
async function listTasks(req, res, actor) {
  requireScope(actor, "tasks:read");
  const params = query(req),
    orgId = await orgFor(actor, params.get("organizationId"), "guest"),
    values = [orgId],
    where = ["t.organization_id=$1", "t.archived_at IS NULL"];
  for (const [name, column] of [
    ["status", "t.status"],
    ["ownerId", "t.owner_id::text"],
  ])
    if (params.get(name)) {
      values.push(params.get(name));
      where.push(`${column}=$${values.length}`);
    }
  if (params.get("projectId")) {
    enforceProjectIds(actor, [params.get("projectId")]);
    values.push(params.get("projectId"));
    where.push(
      `EXISTS(SELECT 1 FROM task_project_links x WHERE x.task_id=t.id AND x.project_id::text=$${values.length})`,
    );
  }
  if (actor.projectIds?.length) {
    values.push(actor.projectIds);
    where.push(
      `EXISTS(SELECT 1 FROM task_project_links scoped WHERE scoped.task_id=t.id AND scoped.project_id=ANY($${values.length}::uuid[]))`,
    );
  }
  if (params.get("q")) {
    values.push(`%${params.get("q")}%`);
    where.push(
      `(t.title ILIKE $${values.length} OR t.description ILIKE $${values.length} OR t.identifier ILIKE $${values.length})`,
    );
  }
  const limit = Math.min(Math.max(Number(params.get("limit") || 100), 1), 200);
  values.push(limit);
  const rows = await pool.query(
      `SELECT t.*,COALESCE(array_agg(l.project_id::text) FILTER(WHERE l.project_id IS NOT NULL),'{}') project_ids,max(l.project_id::text) FILTER(WHERE l.is_primary) primary_project_id,pp.name project_name,o.display_name owner_name,o.kind owner_kind,m.name milestone_name,(SELECT count(*) FROM task_dependencies d WHERE d.task_id=t.id) dependency_count,(SELECT count(*) FROM task_dependencies d JOIN tasks blocker ON blocker.id=d.depends_on_task_id WHERE d.task_id=t.id AND blocker.status NOT IN ('done','cancelled')) blocked_by_count FROM tasks t LEFT JOIN task_project_links l ON l.task_id=t.id LEFT JOIN task_projects pp ON pp.id=(SELECT project_id FROM task_project_links WHERE task_id=t.id AND is_primary LIMIT 1) LEFT JOIN task_principals o ON o.id=t.owner_id LEFT JOIN task_milestones m ON m.id=t.milestone_id WHERE ${where.join(" AND ")} GROUP BY t.id,pp.name,o.display_name,o.kind,m.name ORDER BY t.updated_at DESC LIMIT $${values.length}`,
      values,
    ),
    summaryValues = [orgId],
    summaryWhere = ["t.organization_id=$1", "t.archived_at IS NULL"];
  if (actor.projectIds?.length) {
    summaryValues.push(actor.projectIds);
    summaryWhere.push(
      `EXISTS(SELECT 1 FROM task_project_links scoped WHERE scoped.task_id=t.id AND scoped.project_id=ANY($${summaryValues.length}::uuid[]))`,
    );
  }
  const summary = (
    await pool.query(
      `SELECT count(*) FILTER(WHERE status NOT IN ('done','cancelled')) open,count(*) FILTER(WHERE status NOT IN ('done','cancelled') AND due_at<now()) overdue,count(*) FILTER(WHERE status NOT IN ('done','cancelled') AND due_at BETWEEN now() AND now()+interval '7 days') due_soon,count(*) FILTER(WHERE status NOT IN ('done','cancelled') AND owner_id IS NULL) unassigned,COALESCE(sum(expected_value_minor) FILTER(WHERE status NOT IN ('done','cancelled')),0) open_value FROM tasks t WHERE ${summaryWhere.join(" AND ")}`,
      summaryValues,
    )
  ).rows[0];
  send(res, 200, rows.rows.map(serializeTask), {
    organizationId: orgId,
    count: rows.rowCount,
    summary: {
      open: Number(summary.open),
      overdue: Number(summary.overdue),
      dueSoon: Number(summary.due_soon),
      unassigned: Number(summary.unassigned),
      openExpectedValue: Number(summary.open_value) / 100,
    },
  });
}
async function getTaskHandler(req, res, actor, id) {
  requireScope(actor, "tasks:read");
  const orgId = await orgFor(actor, query(req).get("organizationId"), "guest"),
    client = await pool.connect();
  try {
    const row = await taskRow(client, id, orgId);
    if (!row) throw apiError("task_not_found", 404);
    await enforceTaskAccess(client, actor, row);
    const [comments, dependencies, participants, boards] = await Promise.all([
      pool.query(
        "SELECT * FROM task_comments WHERE task_id=$1 ORDER BY created_at DESC LIMIT 100",
        [row.id],
      ),
      pool.query(
        "SELECT d.*,t.identifier,t.title,t.status FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_task_id WHERE d.task_id=$1",
        [row.id],
      ),
      pool.query(
        "SELECT x.*,p.display_name,p.kind FROM task_participants x JOIN task_principals p ON p.id=x.principal_id WHERE x.task_id=$1",
        [row.id],
      ),
      pool.query(
        "SELECT m.*,b.name board_name FROM task_board_memberships m JOIN task_boards b ON b.id=m.board_id WHERE m.task_id=$1",
        [row.id],
      ),
    ]);
    send(
      res,
      200,
      {
        ...serializeTask(row),
        comments: comments.rows,
        dependencies: dependencies.rows,
        participants: participants.rows,
        boards: boards.rows,
      },
      { etag: `W/\"${row.version}\"` },
    );
  } finally {
    client.release();
  }
}
async function addComment(req, res, actor, id, input) {
  requireScope(actor, "comments:write");
  const orgId = await orgFor(actor, input.organizationId, "member"),
    result = await mutation(req, actor, orgId, input, async (client) => {
      const task = await taskRow(client, id, orgId);
      if (!task) throw apiError("task_not_found", 404);
      await enforceTaskAccess(client, actor, task);
      const comment = (
          await client.query(
            "INSERT INTO task_comments(id,task_id,body,actor_id) VALUES($1,$2,$3,$4) RETURNING *",
            [uuid(), task.id, cleanText(input.body, 10000, true), actor.id],
          )
        ).rows[0],
        event = await addEvent(
          client,
          orgId,
          "comment.created",
          "task",
          task.id,
          actor.id,
          { comment },
        );
      return { status: 201, data: comment, event };
    });
  send(res, result.status, result.data, { replayed: Boolean(result.replayed) });
}
async function replaceProjects(req, res, actor, id, input) {
  requireScope(actor, "tasks:write");
  const orgId = await orgFor(actor, input.organizationId, "member"),
    projectIds = [...new Set((input.projectIds || []).map(String))],
    primary = input.primaryProjectId ? String(input.primaryProjectId) : null,
    result = await mutation(req, actor, orgId, input, async (client) => {
      const task = await taskRow(client, id, orgId);
      if (!task) throw apiError("task_not_found", 404);
      await enforceTaskAccess(client, actor, task);
      enforceProjectIds(actor, projectIds);
      if (primary && !projectIds.includes(primary))
        throw apiError("primary_project_not_linked", 400);
      const valid = await client.query(
        "SELECT id::text FROM task_projects WHERE organization_id=$1 AND id=ANY($2::uuid[])",
        [orgId, projectIds],
      );
      if (valid.rowCount !== projectIds.length)
        throw apiError("invalid_project", 400);
      await client.query("DELETE FROM task_project_links WHERE task_id=$1", [
        task.id,
      ]);
      for (const projectId of projectIds)
        await client.query(
          "INSERT INTO task_project_links(task_id,project_id,is_primary) VALUES($1,$2,$3)",
          [task.id, projectId, projectId === primary],
        );
      await client.query(
        "UPDATE tasks SET version=version+1,updated_at=now() WHERE id=$1",
        [task.id],
      );
      const row = await taskRow(client, String(task.id), orgId),
        event = await addEvent(
          client,
          orgId,
          "task.projects_linked",
          "task",
          task.id,
          actor.id,
          { projectIds, primaryProjectId: primary, version: row.version },
        );
      return { data: serializeTask(row), event };
    });
  send(res, 200, result.data, { replayed: Boolean(result.replayed) });
}

async function dependencies(req, res, actor, id, childId, input) {
  requireScope(actor, "tasks:write");
  const orgId = await orgFor(actor, input.organizationId, "member"),
    dependsOn = String(childId || input.dependsOnTaskId || "");
  if (!dependsOn) throw apiError("dependency_required", 400);
  const result = await mutation(req, actor, orgId, input, async (client) => {
    const task = await taskRow(client, id, orgId),
      parent = await taskRow(client, dependsOn, orgId);
    if (!task || !parent) throw apiError("task_not_found", 404);
    await enforceTaskAccess(client, actor, task);
    await enforceTaskAccess(client, actor, parent);
    if (String(task.id) === String(parent.id))
      throw apiError("self_dependency", 400);
    if (req.method === "DELETE") {
      await client.query(
        "DELETE FROM task_dependencies WHERE task_id=$1 AND depends_on_task_id=$2",
        [task.id, parent.id],
      );
      const event = await addEvent(
        client,
        orgId,
        "task.dependency_removed",
        "task",
        task.id,
        actor.id,
        { dependsOnTaskId: parent.id },
      );
      return { data: { removed: true }, event };
    }
    const cycle = await client.query(
      `WITH RECURSIVE chain(id) AS (SELECT depends_on_task_id FROM task_dependencies WHERE task_id=$1 UNION SELECT d.depends_on_task_id FROM task_dependencies d JOIN chain c ON d.task_id=c.id) SELECT 1 FROM chain WHERE id=$2 LIMIT 1`,
      [parent.id, task.id],
    );
    if (cycle.rowCount) throw apiError("dependency_cycle", 409);
    await client.query(
      "INSERT INTO task_dependencies(task_id,depends_on_task_id,dependency_type) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [task.id, parent.id, input.dependencyType || "blocks"],
    );
    const event = await addEvent(
      client,
      orgId,
      "task.dependency_added",
      "task",
      task.id,
      actor.id,
      {
        dependsOnTaskId: parent.id,
        dependencyType: input.dependencyType || "blocks",
      },
    );
    return {
      status: 201,
      data: { taskId: task.id, dependsOnTaskId: parent.id },
      event,
    };
  });
  send(res, result.status || 200, result.data, {
    replayed: Boolean(result.replayed),
  });
}
async function participants(req, res, actor, id, input) {
  requireScope(actor, "tasks:write");
  const orgId = await orgFor(actor, input.organizationId, "member"),
    result = await mutation(req, actor, orgId, input, async (client) => {
      const task = await taskRow(client, id, orgId);
      if (!task) throw apiError("task_not_found", 404);
      await enforceTaskAccess(client, actor, task);
      const entries = Array.isArray(input.participants)
        ? input.participants
        : [];
      await client.query("DELETE FROM task_participants WHERE task_id=$1", [
        task.id,
      ]);
      for (const item of entries)
        await client.query(
          "INSERT INTO task_participants(task_id,principal_id,role) VALUES($1,$2,$3)",
          [
            task.id,
            item.personId || item.principalId,
            item.role || "collaborator",
          ],
        );
      const rows = await client.query(
          "SELECT x.*,p.display_name,p.kind FROM task_participants x JOIN task_principals p ON p.id=x.principal_id WHERE x.task_id=$1",
          [task.id],
        ),
        event = await addEvent(
          client,
          orgId,
          "task.participants_replaced",
          "task",
          task.id,
          actor.id,
          { count: rows.rowCount },
        );
      return {
        data: { ...serializeTask(task), participants: rows.rows },
        event,
      };
    });
  send(res, 200, result.data, { replayed: Boolean(result.replayed) });
}

async function attachments(req, res, actor, id, attachmentId, input) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    req.method === "GET" ? "guest" : "member",
  );
  if (req.method === "GET") {
    const client = await pool.connect();
    try {
      requireScope(actor, "tasks:read");
      const task = await taskRow(client, id, orgId);
      if (!task) throw apiError("task_not_found", 404);
      await enforceTaskAccess(client, actor, task);
      const rows = await client.query(
        "SELECT id,name,media_type,size_bytes,storage_provider,storage_key,checksum,created_by,created_at FROM task_attachments WHERE task_id=$1 ORDER BY created_at DESC",
        [task.id],
      );
      return send(res, 200, rows.rows);
    } finally {
      client.release();
    }
  }
  requireScope(actor, "tasks:write");
  const result = await mutation(req, actor, orgId, input, async (client) => {
    const task = await taskRow(client, id, orgId);
    if (!task) throw apiError("task_not_found", 404);
    await enforceTaskAccess(client, actor, task);
    if (req.method === "DELETE") {
      const row = (
        await client.query(
          "DELETE FROM task_attachments WHERE id=$1 AND task_id=$2 RETURNING id",
          [attachmentId, task.id],
        )
      ).rows[0];
      if (!row) throw apiError("attachment_not_found", 404);
      const event = await addEvent(
        client,
        orgId,
        "task.attachment_removed",
        "task",
        task.id,
        actor.id,
        { attachmentId },
      );
      return { data: { deleted: true, id: attachmentId }, event };
    }
    const row = (
      await client.query(
        `INSERT INTO task_attachments(id,task_id,name,media_type,size_bytes,storage_provider,storage_key,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,name,media_type,size_bytes,storage_provider,storage_key,checksum,created_by,created_at`,
        [
          uuid(),
          task.id,
          cleanText(input.name, 255, true),
          cleanText(input.mediaType, 255),
          input.sizeBytes == null ? null : Math.max(0, Number(input.sizeBytes)),
          cleanText(input.storageProvider, 80, true),
          cleanText(input.storageKey, 1000, true),
          cleanText(input.checksum, 160),
          actor.id,
        ],
      )
    ).rows[0];
    const event = await addEvent(
      client,
      orgId,
      "task.attachment_added",
      "task",
      task.id,
      actor.id,
      { attachmentId: row.id, name: row.name },
    );
    return { status: 201, data: row, event };
  });
  send(res, result.status || 200, result.data, {
    replayed: Boolean(result.replayed),
  });
}

async function organizations(req, res, actor, input) {
  if (req.method === "GET") {
    if (actor.system) {
      const rows = await pool.query(
        "SELECT * FROM task_organizations ORDER BY name",
      );
      return send(res, 200, rows.rows);
    }
    const rows = await pool.query(
      "SELECT o.*,m.role FROM task_organizations o JOIN task_organization_members m ON m.organization_id=o.id WHERE m.principal_id=$1 ORDER BY o.name",
      [actor.id],
    );
    return send(res, 200, rows.rows);
  }
  requireScope(actor, "organizations:write");
  if (!actor.system) throw apiError("forbidden", 403);
  const row = (
    await pool.query(
      "INSERT INTO task_organizations(id,slug,name,settings) VALUES($1,$2,$3,$4) RETURNING *",
      [
        uuid(),
        cleanText(input.slug, 80, true),
        cleanText(input.name, 160, true),
        JSON.stringify(input.settings || {}),
      ],
    )
  ).rows[0];
  if (actor.id)
    await pool.query(
      "INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
      [row.id, actor.id],
    );
  send(res, 201, row);
}
async function organizationMembers(
  req,
  res,
  actor,
  organizationId,
  input,
  principalId = null,
) {
  const orgId = await orgFor(
    actor,
    organizationId,
    req.method === "GET" ? "guest" : "admin",
  );
  if (req.method === "GET") {
    const rows = await pool.query(
      `SELECT p.id,p.kind,p.display_name,p.email,p.active,m.role,m.created_at,m.updated_at FROM task_organization_members m JOIN task_principals p ON p.id=m.principal_id WHERE m.organization_id=$1 ORDER BY p.display_name`,
      [orgId],
    );
    return send(res, 200, rows.rows);
  }
  const id = principalId || input.principalId;
  if (!id) throw apiError("principal_required", 400);
  if (req.method === "DELETE") {
    const current = (
      await pool.query(
        "SELECT role FROM task_organization_members WHERE organization_id=$1 AND principal_id=$2",
        [orgId, id],
      )
    ).rows[0];
    if (!current) throw apiError("member_not_found", 404);
    if (current.role === "owner") {
      const owners = await pool.query(
        "SELECT count(*) n FROM task_organization_members WHERE organization_id=$1 AND role='owner'",
        [orgId],
      );
      if (Number(owners.rows[0].n) <= 1)
        throw apiError("last_owner_required", 409);
    }
    await pool.query(
      "DELETE FROM task_organization_members WHERE organization_id=$1 AND principal_id=$2",
      [orgId, id],
    );
    return send(res, 200, { deleted: true, principalId: id });
  }
  const role = String(input.role || "member");
  if (!["owner", "admin", "member", "guest"].includes(role))
    throw apiError("invalid_role", 400);
  const exists = (
    await pool.query("SELECT id FROM task_principals WHERE id=$1", [id])
  ).rows[0];
  if (!exists) throw apiError("principal_not_found", 404);
  const row = (
    await pool.query(
      `INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,principal_id) DO UPDATE SET role=excluded.role,updated_at=now() RETURNING *`,
      [orgId, id, role],
    )
  ).rows[0];
  send(res, 200, row);
}
async function invites(req, res, actor, organizationId, input) {
  if (req.method === "POST" && organizationId === "accept") {
    if (!actor.id) throw apiError("authenticated_principal_required", 401);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const token = cleanText(input.token, 500, true),
        row = (
          await client.query(
            "SELECT * FROM task_invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE",
            [sha256(token)],
          )
        ).rows[0];
      if (!row) throw apiError("invite_invalid_or_expired", 410);
      await client.query(
        `INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,principal_id) DO UPDATE SET role=excluded.role,updated_at=now()`,
        [row.organization_id, actor.id, row.role],
      );
      await client.query(
        "UPDATE task_invites SET accepted_at=now(),accepted_by=$1 WHERE id=$2",
        [actor.id, row.id],
      );
      await client.query("COMMIT");
      return send(res, 200, {
        organizationId: row.organization_id,
        role: row.role,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  const orgId = await orgFor(
    actor,
    organizationId || input.organizationId,
    "admin",
  );
  if (req.method === "GET") {
    const rows = await pool.query(
      "SELECT id,email,role,expires_at,accepted_at,created_at FROM task_invites WHERE organization_id=$1 ORDER BY created_at DESC",
      [orgId],
    );
    return send(res, 200, rows.rows);
  }
  const role = String(input.role || "member");
  if (!["admin", "member", "guest"].includes(role))
    throw apiError("invalid_role", 400);
  const token = randomToken("inv_"),
    row = (
      await pool.query(
        "INSERT INTO task_invites(id,organization_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,email,role,expires_at,created_at",
        [
          uuid(),
          orgId,
          cleanText(input.email, 320),
          role,
          sha256(token),
          actor.id,
          iso(input.expiresAt) ||
            new Date(Date.now() + 7 * 86400000).toISOString(),
        ],
      )
    ).rows[0];
  send(
    res,
    201,
    { ...row, token },
    { warning: "The invitation token is shown once." },
  );
}
async function projects(req, res, actor, input, id = null) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    req.method === "GET" ? "guest" : "admin",
  );
  if (req.method === "GET") requireScope(actor, "projects:read");
  if (req.method === "GET" && !id) {
    const values = [orgId],
      where = ["organization_id=$1"];
    if (actor.projectIds?.length) {
      values.push(actor.projectIds);
      where.push(`id=ANY($${values.length}::uuid[])`);
    }
    const rows = await pool.query(
      `SELECT * FROM task_projects WHERE ${where.join(" AND ")} ORDER BY name`,
      values,
    );
    return send(res, 200, rows.rows);
  }
  if (req.method === "GET" && id) {
    enforceProjectIds(actor, [id]);
    const row = (
      await pool.query(
        "SELECT * FROM task_projects WHERE id=$1 AND organization_id=$2",
        [id, orgId],
      )
    ).rows[0];
    if (!row) throw apiError("project_not_found", 404);
    return send(res, 200, row);
  }
  requireScope(actor, "projects:write");
  if (req.method === "PATCH" && id) {
    enforceProjectIds(actor, [id]);
    const fields = [],
      values = [];
    for (const [key, column, fn] of [
      ["name", "name", (v) => cleanText(v, 200, true)],
      ["slug", "slug", (v) => cleanText(v, 100, true)],
      ["description", "description", (v) => cleanText(v, 5000)],
      ["restricted", "restricted", Boolean],
      ["metadata", "metadata", (v) => JSON.stringify(v || {})],
    ])
      if (Object.hasOwn(input, key)) {
        values.push(fn(input[key]));
        fields.push(`${column}=$${values.length}`);
      }
    if (!fields.length) throw apiError("no_changes", 400);
    values.push(id, orgId);
    const row = (
      await pool.query(
        `UPDATE task_projects SET ${fields.join(",")},updated_at=now() WHERE id=$${values.length - 1} AND organization_id=$${values.length} RETURNING *`,
        values,
      )
    ).rows[0];
    if (!row) throw apiError("project_not_found", 404);
    return send(res, 200, row);
  }
  if (req.method === "DELETE" && id) {
    enforceProjectIds(actor, [id]);
    const linked = await pool.query(
      "SELECT count(*) n FROM task_project_links WHERE project_id=$1",
      [id],
    );
    if (Number(linked.rows[0].n))
      throw apiError("project_has_tasks", 409, {
        taskCount: Number(linked.rows[0].n),
      });
    const row = (
      await pool.query(
        "DELETE FROM task_projects WHERE id=$1 AND organization_id=$2 RETURNING id",
        [id, orgId],
      )
    ).rows[0];
    if (!row) throw apiError("project_not_found", 404);
    return send(res, 200, { deleted: true, id });
  }
  const row = (
    await pool.query(
      "INSERT INTO task_projects(id,organization_id,catalog_project_id,name,slug,description,restricted,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        input.id && actor.system ? input.id : uuid(),
        orgId,
        input.catalogProjectId || null,
        cleanText(input.name, 200, true),
        cleanText(input.slug, 100, true),
        cleanText(input.description, 5000),
        Boolean(input.restricted),
        JSON.stringify(input.metadata || {}),
      ],
    )
  ).rows[0];
  send(res, 201, row);
}
async function projectMembers(
  req,
  res,
  actor,
  projectId,
  input,
  principalId = null,
) {
  const project = (
    await pool.query("SELECT * FROM task_projects WHERE id=$1", [projectId])
  ).rows[0];
  if (!project) throw apiError("project_not_found", 404);
  await orgFor(
    actor,
    project.organization_id,
    req.method === "GET" ? "guest" : "admin",
  );
  enforceProjectIds(actor, [projectId]);
  if (req.method === "GET") {
    const rows = await pool.query(
      `SELECT p.id,p.kind,p.display_name,p.email,m.role,m.created_at FROM task_project_members m JOIN task_principals p ON p.id=m.principal_id WHERE m.project_id=$1 ORDER BY p.display_name`,
      [projectId],
    );
    return send(res, 200, rows.rows);
  }
  const id = principalId || input.principalId;
  if (!id) throw apiError("principal_required", 400);
  if (req.method === "DELETE") {
    await pool.query(
      "DELETE FROM task_project_members WHERE project_id=$1 AND principal_id=$2",
      [projectId, id],
    );
    return send(res, 200, { deleted: true });
  }
  const role = String(input.role || "member");
  if (!["admin", "member", "guest"].includes(role))
    throw apiError("invalid_role", 400);
  const row = (
    await pool.query(
      `INSERT INTO task_project_members(project_id,principal_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,principal_id) DO UPDATE SET role=excluded.role RETURNING *`,
      [projectId, id, role],
    )
  ).rows[0];
  send(res, 200, row);
}
async function boards(req, res, actor, input, id = null) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    req.method === "GET" ? "guest" : "member",
  );
  if (req.method === "GET") requireScope(actor, "boards:read");
  if (req.method === "GET" && !id) {
    const values = [orgId],
      where = ["organization_id=$1"];
    if (actor.projectIds?.length) {
      values.push(actor.projectIds);
      where.push(`project_id=ANY($${values.length}::uuid[])`);
    }
    const rows = await pool.query(
      `SELECT b.*,(SELECT count(*) FROM task_board_memberships m WHERE m.board_id=b.id) task_count FROM task_boards b WHERE ${where.join(" AND ")} ORDER BY name`,
      values,
    );
    return send(res, 200, rows.rows);
  }
  if (req.method === "GET" && id) {
    const board = (
      await pool.query(
        "SELECT * FROM task_boards WHERE id=$1 AND organization_id=$2",
        [id, orgId],
      )
    ).rows[0];
    if (!board) throw apiError("board_not_found", 404);
    enforceBoardAccess(actor, board);
    const rows = await pool.query(
      `SELECT m.rank,m.lane_key,m.version membership_version,t.*,COALESCE(array_agg(l.project_id::text) FILTER(WHERE l.project_id IS NOT NULL),'{}') project_ids,max(l.project_id::text) FILTER(WHERE l.is_primary) primary_project_id FROM task_board_memberships m JOIN tasks t ON t.id=m.task_id LEFT JOIN task_project_links l ON l.task_id=t.id WHERE m.board_id=$1 ${actor.projectIds?.length ? "AND EXISTS(SELECT 1 FROM task_project_links scoped WHERE scoped.task_id=t.id AND scoped.project_id=ANY($2::uuid[]))" : ""} GROUP BY m.board_id,m.task_id,m.rank,m.lane_key,m.version,t.id ORDER BY m.lane_key,m.rank`,
      actor.projectIds?.length ? [id, actor.projectIds] : [id],
    );
    return send(res, 200, {
      ...board,
      tasks: rows.rows.map((x) => ({
        ...serializeTask(x),
        board: {
          laneKey: x.lane_key,
          rank: Number(x.rank),
          version: Number(x.membership_version),
        },
      })),
    });
  }
  requireScope(actor, "boards:write");
  if (actor.projectIds?.length && !id && !input.projectId)
    throw apiError("project_scope_required", 400);
  if (input.projectId) enforceProjectIds(actor, [input.projectId]);
  if (req.method === "PATCH" && id) {
    const existing = (
      await pool.query(
        "SELECT * FROM task_boards WHERE id=$1 AND organization_id=$2",
        [id, orgId],
      )
    ).rows[0];
    if (!existing) throw apiError("board_not_found", 404);
    enforceBoardAccess(actor, existing);
    const fields = [],
      values = [];
    for (const [key, column, fn] of [
      ["name", "name", (value) => cleanText(value, 200, true)],
      ["slug", "slug", (value) => cleanText(value, 100, true)],
      ["viewType", "view_type", String],
      ["grouping", "grouping", String],
      ["filters", "filters", (value) => JSON.stringify(value || {})],
      ["columns", "columns", (value) => JSON.stringify(value || [])],
      ["shared", "shared", Boolean],
    ])
      if (Object.hasOwn(input, key)) {
        values.push(fn(input[key]));
        fields.push(`${column}=$${values.length}`);
      }
    if (!fields.length) throw apiError("no_changes", 400);
    values.push(id, orgId);
    const updated = (
      await pool.query(
        `UPDATE task_boards SET ${fields.join(",")},updated_at=now() WHERE id=$${values.length - 1} AND organization_id=$${values.length} RETURNING *`,
        values,
      )
    ).rows[0];
    if (!updated) throw apiError("board_not_found", 404);
    return send(res, 200, updated);
  }
  if (req.method === "DELETE" && id) {
    const existing = (
      await pool.query(
        "SELECT * FROM task_boards WHERE id=$1 AND organization_id=$2",
        [id, orgId],
      )
    ).rows[0];
    if (!existing) throw apiError("board_not_found", 404);
    enforceBoardAccess(actor, existing);
    const removed = (
      await pool.query(
        "DELETE FROM task_boards WHERE id=$1 AND organization_id=$2 RETURNING id",
        [id, orgId],
      )
    ).rows[0];
    if (!removed) throw apiError("board_not_found", 404);
    return send(res, 200, { deleted: true, id });
  }
  const row = (
    await pool.query(
      "INSERT INTO task_boards(id,organization_id,project_id,name,slug,view_type,grouping,filters,columns,shared,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [
        uuid(),
        orgId,
        input.projectId || null,
        cleanText(input.name, 200, true),
        cleanText(input.slug, 100, true),
        input.viewType || "board",
        input.grouping || "status",
        JSON.stringify(input.filters || {}),
        JSON.stringify(input.columns || []),
        input.shared !== false,
        actor.id,
      ],
    )
  ).rows[0];
  send(res, 201, row);
}
async function boardMembership(
  req,
  res,
  actor,
  boardId,
  taskId,
  input,
  remove = false,
) {
  requireScope(actor, "boards:write");
  const orgId = await orgFor(actor, input.organizationId, "member"),
    result = await mutation(req, actor, orgId, input, async (client) => {
      const board = (
          await client.query(
            "SELECT * FROM task_boards WHERE id=$1 AND organization_id=$2",
            [boardId, orgId],
          )
        ).rows[0],
        task = await taskRow(client, taskId, orgId);
      if (!board || !task) throw apiError("board_or_task_not_found", 404);
      enforceBoardAccess(actor, board);
      await enforceTaskAccess(client, actor, task);
      if (remove) {
        await client.query(
          "DELETE FROM task_board_memberships WHERE board_id=$1 AND task_id=$2",
          [boardId, task.id],
        );
        const event = await addEvent(
          client,
          orgId,
          "board.task_removed",
          "board",
          boardId,
          actor.id,
          { taskId: task.id },
        );
        return { data: { removed: true }, event };
      }
      const current = (
        await client.query(
          "SELECT * FROM task_board_memberships WHERE board_id=$1 AND task_id=$2",
          [boardId, task.id],
        )
      ).rows[0];
      if (
        current &&
        input.version &&
        Number(current.version) !== Number(input.version)
      )
        throw apiError("version_conflict", 409, { current });
      const rank = rankBetween(input.beforeRank, input.afterRank);
      const membership = (
          await client.query(
            `INSERT INTO task_board_memberships(board_id,task_id,lane_key,rank) VALUES($1,$2,$3,$4) ON CONFLICT(board_id,task_id) DO UPDATE SET lane_key=excluded.lane_key,rank=excluded.rank,version=task_board_memberships.version+1,updated_at=now() RETURNING *`,
            [boardId, task.id, input.laneKey || null, rank],
          )
        ).rows[0],
        event = await addEvent(
          client,
          orgId,
          current ? "board.task_moved" : "board.task_added",
          "board",
          boardId,
          actor.id,
          {
            taskId: task.id,
            laneKey: membership.lane_key,
            rank: Number(membership.rank),
            version: Number(membership.version),
          },
        );
      return { data: membership, event };
    });
  send(res, remove ? 200 : 201, result.data, {
    replayed: Boolean(result.replayed),
  });
}
async function events(req, res, actor) {
  requireScope(actor, "events:read");
  const params = query(req),
    orgId = await orgFor(actor, params.get("organizationId"), "guest"),
    cursor = Math.max(Number(params.get("cursor") || 0), 0),
    limit = Math.min(Math.max(Number(params.get("limit") || 200), 1), 1000),
    values = [orgId, cursor],
    where = ["e.organization_id=$1", "e.sequence>$2"];
  if (actor.projectIds?.length) {
    values.push(actor.projectIds);
    where.push(
      `((e.aggregate_type='task' AND EXISTS(SELECT 1 FROM task_project_links scoped WHERE scoped.task_id=e.aggregate_id AND scoped.project_id=ANY($${values.length}::uuid[]))) OR (e.aggregate_type='board' AND e.data ? 'taskId' AND EXISTS(SELECT 1 FROM task_project_links scoped WHERE scoped.task_id=(e.data->>'taskId')::uuid AND scoped.project_id=ANY($${values.length}::uuid[]))))`,
    );
  }
  values.push(limit);
  const rows = await pool.query(
    `SELECT e.* FROM task_events e WHERE ${where.join(" AND ")} ORDER BY e.sequence LIMIT $${values.length}`,
    values,
  );
  send(res, 200, rows.rows, { cursor: rows.rows.at(-1)?.sequence || cursor });
}
async function apiKeys(req, res, actor, input, id = null, action = null) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    "admin",
  );
  if (req.method === "GET") {
    const rows = await pool.query(
      "SELECT id,name,key_prefix,scopes,project_ids,field_policy,expires_at,revoked_at,last_used_at,created_at FROM task_api_keys WHERE organization_id=$1 ORDER BY created_at DESC",
      [orgId],
    );
    return send(res, 200, rows.rows);
  }
  if (id && req.method === "DELETE") {
    const row = (
      await pool.query(
        "UPDATE task_api_keys SET revoked_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,revoked_at",
        [id, orgId],
      )
    ).rows[0];
    if (!row) throw apiError("api_key_not_found", 404);
    return send(res, 200, row);
  }
  if (id && action === "rotate" && req.method === "POST") {
    const key = randomToken("tsk_"),
      row = (
        await pool.query(
          "UPDATE task_api_keys SET key_prefix=$1,key_hash=$2,revoked_at=NULL,last_used_at=NULL,expires_at=COALESCE($3,expires_at) WHERE id=$4 AND organization_id=$5 RETURNING id,name,key_prefix,scopes,project_ids,field_policy,expires_at",
          [key.slice(0, 12), sha256(key), iso(input.expiresAt), id, orgId],
        )
      ).rows[0];
    if (!row) throw apiError("api_key_not_found", 404);
    return send(
      res,
      200,
      { ...row, key },
      { warning: "The rotated key is shown once." },
    );
  }
  const key = randomToken("tsk_"),
    principalId = input.principalId || uuid();
  if (!input.principalId)
    await pool.query(
      "INSERT INTO task_principals(id,kind,external_id,display_name) VALUES($1,'agent',$2,$3)",
      [principalId, principalId, cleanText(input.name, 160, true)],
    );
  await pool.query(
    `INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,principal_id) DO NOTHING`,
    [orgId, principalId, input.organizationRole || "member"],
  );
  const projectIds = (input.projectIds || []).map(String);
  enforceProjectIds(actor, projectIds);
  const row = (
    await pool.query(
      "INSERT INTO task_api_keys(id,organization_id,principal_id,name,key_prefix,key_hash,scopes,project_ids,field_policy,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,name,key_prefix,scopes,project_ids,field_policy,expires_at,created_at",
      [
        uuid(),
        orgId,
        principalId,
        cleanText(input.name, 160, true),
        key.slice(0, 12),
        sha256(key),
        input.scopes || ["tasks:read"],
        projectIds,
        JSON.stringify(input.fieldPolicy || {}),
        iso(input.expiresAt),
      ],
    )
  ).rows[0];
  send(res, 201, { ...row, key }, { warning: "The key is shown once." });
}
async function webhooks(req, res, actor, input, id = null, action = null) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    "admin",
  );
  if (req.method === "GET" && !id) {
    const rows = await pool.query(
      "SELECT id,url,event_types,active,created_at,updated_at FROM task_webhooks WHERE organization_id=$1",
      [orgId],
    );
    return send(res, 200, rows.rows);
  }
  if (req.method === "GET" && id && action === "deliveries") {
    const rows = await pool.query(
      `SELECT d.id,d.event_sequence,d.status,d.attempt_count,d.next_attempt_at,d.response_status,d.last_error,d.delivered_at,d.created_at FROM task_webhook_deliveries d JOIN task_webhooks w ON w.id=d.webhook_id WHERE d.webhook_id=$1 AND w.organization_id=$2 ORDER BY d.created_at DESC LIMIT 200`,
      [id, orgId],
    );
    return send(res, 200, rows.rows);
  }
  if (req.method === "DELETE" && id) {
    const row = (
      await pool.query(
        "UPDATE task_webhooks SET active=false,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,active,updated_at",
        [id, orgId],
      )
    ).rows[0];
    if (!row) throw apiError("webhook_not_found", 404);
    return send(res, 200, row);
  }
  if (req.method === "POST" && id && action === "replay") {
    const values = [id, orgId],
      where = ["d.webhook_id=$1", "w.organization_id=$2"];
    if (input.deliveryId) {
      values.push(input.deliveryId);
      where.push(`d.id=$${values.length}`);
    } else if (input.eventSequence) {
      values.push(Number(input.eventSequence));
      where.push(`d.event_sequence=$${values.length}`);
    } else throw apiError("delivery_required", 400);
    const row = (
      await pool.query(
        `UPDATE task_webhook_deliveries d SET status='pending',attempt_count=0,next_attempt_at=now(),last_error=NULL,updated_at=now() FROM task_webhooks w WHERE w.id=d.webhook_id AND ${where.join(" AND ")} RETURNING d.id,d.event_sequence,d.status`,
        values,
      )
    ).rows[0];
    if (!row) throw apiError("delivery_not_found", 404);
    return send(res, 200, row);
  }
  if (!ENCRYPTION_KEY) throw apiError("encryption_unconfigured", 503);
  const secret = randomToken("whsec_"),
    row = (
      await pool.query(
        "INSERT INTO task_webhooks(id,organization_id,url,event_types,secret_ciphertext,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,url,event_types,active,created_at",
        [
          uuid(),
          orgId,
          new URL(input.url).toString(),
          input.eventTypes || ["*"],
          encryptSecret(secret, ENCRYPTION_KEY),
          actor.id,
        ],
      )
    ).rows[0];
  send(
    res,
    201,
    { ...row, secret },
    { warning: "The webhook secret is shown once." },
  );
}

async function people(req, res, actor, input, id = null) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    req.method === "GET" ? "guest" : "admin",
  );
  if (req.method === "GET") {
    requireScope(actor, "people:read");
    const rows = await pool.query(
      actor.projectIds?.length
        ? `SELECT DISTINCT p.id,p.kind,p.display_name,p.email,p.metadata,p.active,pm.role FROM task_principals p JOIN task_project_members pm ON pm.principal_id=p.id WHERE pm.project_id=ANY($2::uuid[]) ORDER BY p.display_name`
        : `SELECT p.id,p.kind,p.display_name,p.email,p.metadata,p.active,m.role FROM task_principals p JOIN task_organization_members m ON m.principal_id=p.id WHERE m.organization_id=$1 ORDER BY p.display_name`,
      actor.projectIds?.length ? [orgId, actor.projectIds] : [orgId],
    );
    return send(res, 200, rows.rows);
  }
  requireScope(actor, "people:write");
  if (req.method === "POST") {
    const principalId = input.id && actor.system ? input.id : uuid(),
      kind = ["user", "agent", "system"].includes(input.kind)
        ? input.kind
        : "user",
      row = (
        await pool.query(
          "INSERT INTO task_principals(id,kind,external_id,display_name,email,metadata) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            principalId,
            kind,
            input.externalId || principalId,
            cleanText(input.displayName || input.name, 200, true),
            cleanText(input.email, 320),
            JSON.stringify(input.metadata || {}),
          ],
        )
      ).rows[0];
    await pool.query(
      "INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,$3)",
      [orgId, principalId, input.organizationRole || "member"],
    );
    return send(res, 201, row);
  }
  const fields = [],
    values = [];
  for (const [key, column] of [
    ["displayName", "display_name"],
    ["email", "email"],
    ["active", "active"],
  ])
    if (Object.hasOwn(input, key)) {
      values.push(input[key]);
      fields.push(`${column}=$${values.length}`);
    }
  if (!fields.length) throw apiError("no_changes", 400);
  values.push(id, orgId);
  const row = (
    await pool.query(
      `UPDATE task_principals p SET ${fields.join(",")},updated_at=now() FROM task_organization_members m WHERE p.id=$${values.length - 1} AND m.principal_id=p.id AND m.organization_id=$${values.length} RETURNING p.*`,
      values,
    )
  ).rows[0];
  if (!row) throw apiError("person_not_found", 404);
  send(res, 200, row);
}
async function milestones(req, res, actor, input, id = null) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    req.method === "GET" ? "guest" : "member",
  );
  if (req.method === "GET") {
    requireScope(actor, "milestones:read");
    const values = [orgId],
      where = ["organization_id=$1"];
    if (actor.projectIds?.length) {
      values.push(actor.projectIds);
      where.push(`project_id=ANY($${values.length}::uuid[])`);
    }
    const rows = await pool.query(
      `SELECT * FROM task_milestones WHERE ${where.join(" AND ")} ORDER BY target_at NULLS LAST,name`,
      values,
    );
    return send(res, 200, rows.rows);
  }
  requireScope(actor, "milestones:write");
  if (input.projectId) enforceProjectIds(actor, [input.projectId]);
  if (id && actor.projectIds?.length) {
    const existing = (
      await pool.query(
        "SELECT project_id FROM task_milestones WHERE id=$1 AND organization_id=$2",
        [id, orgId],
      )
    ).rows[0];
    if (!existing) throw apiError("milestone_not_found", 404);
    enforceProjectIds(actor, [existing.project_id]);
  }
  if (req.method === "POST") {
    const row = (
      await pool.query(
        "INSERT INTO task_milestones(id,organization_id,name,project_id,target_at,status,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          input.id && actor.system ? input.id : uuid(),
          orgId,
          cleanText(input.name, 200, true),
          input.projectId || null,
          iso(input.targetAt),
          input.status || "planned",
          cleanText(input.description, 5000),
        ],
      )
    ).rows[0];
    return send(res, 201, row);
  }
  const fields = [],
    values = [];
  for (const [key, column, fn] of [
    ["name", "name", (v) => cleanText(v, 200, true)],
    ["projectId", "project_id", (v) => v || null],
    ["targetAt", "target_at", iso],
    ["status", "status", String],
    ["description", "description", (v) => cleanText(v, 5000)],
  ])
    if (Object.hasOwn(input, key)) {
      values.push(fn(input[key]));
      fields.push(`${column}=$${values.length}`);
    }
  if (!fields.length) throw apiError("no_changes", 400);
  values.push(id, orgId);
  const row = (
    await pool.query(
      `UPDATE task_milestones SET ${fields.join(",")},updated_at=now() WHERE id=$${values.length - 1} AND organization_id=$${values.length} RETURNING *`,
      values,
    )
  ).rows[0];
  if (!row) throw apiError("milestone_not_found", 404);
  send(res, 200, row);
}
async function views(req, res, actor, input, id = null) {
  const orgId = await orgFor(
    actor,
    input.organizationId || query(req).get("organizationId"),
    "guest",
  );
  if (req.method === "GET") {
    const rows = await pool.query(
      "SELECT id,name,view_type,filters,group_by,sort_by,created_at,updated_at FROM task_saved_views WHERE organization_id=$1 AND (principal_id=$2 OR principal_id IS NULL) ORDER BY name",
      [orgId, actor.id],
    );
    return send(
      res,
      200,
      rows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        viewType: row.view_type,
        filters: row.filters,
        groupBy: row.group_by,
        sortBy: row.sort_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
  }
  if (req.method === "DELETE") {
    await pool.query(
      "DELETE FROM task_saved_views WHERE id=$1 AND organization_id=$2 AND (principal_id=$3 OR $4)",
      [id, orgId, actor.id, actor.system],
    );
    return send(res, 200, { deleted: true });
  }
  const row = (
    await pool.query(
      "INSERT INTO task_saved_views(id,organization_id,principal_id,name,view_type,filters,group_by,sort_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        uuid(),
        orgId,
        actor.id,
        cleanText(input.name, 160, true),
        input.viewType || "list",
        JSON.stringify(input.filters || {}),
        input.groupBy || null,
        input.sortBy || null,
      ],
    )
  ).rows[0];
  send(res, 201, {
    id: row.id,
    name: row.name,
    viewType: row.view_type,
    filters: row.filters,
    groupBy: row.group_by,
    sortBy: row.sort_by,
  });
}

function migrationJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
function migrationUuid(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    text,
  )
    ? text
    : null;
}
async function importD1(req, res, actor, input) {
  if (!actor.system) throw apiError("forbidden", 403);
  const orgId = await orgFor(actor, input.organizationId, "owner"),
    client = await pool.connect(),
    counts = {
      projects: 0,
      people: 0,
      milestones: 0,
      tasks: 0,
      participants: 0,
      dependencies: 0,
      comments: 0,
      events: 0,
      views: 0,
    };
  try {
    await client.query("BEGIN");
    for (const project of input.projects || []) {
      const id = migrationUuid(project.id);
      if (!id) continue;
      await client.query(
        `INSERT INTO task_projects(id,organization_id,catalog_project_id,name,slug,description,metadata,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,metadata=excluded.metadata,updated_at=excluded.updated_at`,
        [
          id,
          orgId,
          String(project.id),
          project.name || project.slug || id,
          project.slug || `imported-${id}`,
          project.description || null,
          JSON.stringify({
            source: "d1",
            sourceRef: project.source_ref || null,
          }),
          project.created_at || new Date().toISOString(),
          project.updated_at || new Date().toISOString(),
        ],
      );
      counts.projects++;
    }
    for (const person of input.people || []) {
      const id = migrationUuid(person.id);
      if (!id) continue;
      const kind = person.kind === "agent" ? "agent" : "user";
      await client.query(
        `INSERT INTO task_principals(id,kind,external_id,display_name,email,metadata,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,email=excluded.email,metadata=excluded.metadata,active=excluded.active,updated_at=excluded.updated_at`,
        [
          id,
          kind,
          person.handle || id,
          person.display_name || id,
          person.email || null,
          JSON.stringify({
            ...migrationJson(person.metadata),
            legacyKind: person.kind,
          }),
          person.active !== 0,
          person.created_at || new Date().toISOString(),
          person.updated_at || new Date().toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,
        [orgId, id],
      );
      counts.people++;
    }
    const referencedPrincipalIds = new Set();
    for (const task of input.tasks || []) {
      if (migrationUuid(task.owner_id))
        referencedPrincipalIds.add(migrationUuid(task.owner_id));
      if (migrationUuid(task.created_by_id))
        referencedPrincipalIds.add(migrationUuid(task.created_by_id));
    }
    for (const entry of input.participants || [])
      if (migrationUuid(entry.person_id))
        referencedPrincipalIds.add(migrationUuid(entry.person_id));
    for (const entry of [...(input.comments || []), ...(input.activity || [])])
      if (migrationUuid(entry.actor_id))
        referencedPrincipalIds.add(migrationUuid(entry.actor_id));
    for (const view of input.views || [])
      if (migrationUuid(view.principal_id))
        referencedPrincipalIds.add(migrationUuid(view.principal_id));
    for (const id of referencedPrincipalIds) {
      await client.query(
        `INSERT INTO task_principals(id,kind,external_id,display_name,metadata) VALUES($1,'user',$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
        [
          id,
          `legacy:${id}`,
          `Legacy principal ${id.slice(0, 8)}`,
          JSON.stringify({ source: "d1", placeholder: true }),
        ],
      );
      await client.query(
        `INSERT INTO task_organization_members(organization_id,principal_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,
        [orgId, id],
      );
    }
    const referencedProjectIds = new Set();
    for (const task of input.tasks || [])
      if (migrationUuid(task.project_id))
        referencedProjectIds.add(migrationUuid(task.project_id));
    for (const milestone of input.milestones || [])
      if (migrationUuid(milestone.project_id))
        referencedProjectIds.add(migrationUuid(milestone.project_id));
    for (const id of referencedProjectIds)
      await client.query(
        `INSERT INTO task_projects(id,organization_id,catalog_project_id,name,slug,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,
        [
          id,
          orgId,
          id,
          `Legacy project ${id.slice(0, 8)}`,
          `legacy-${id}`,
          JSON.stringify({ source: "d1", placeholder: true }),
        ],
      );
    for (const milestone of input.milestones || []) {
      const id = migrationUuid(milestone.id);
      if (!id) continue;
      await client.query(
        `INSERT INTO task_milestones(id,organization_id,name,project_id,target_at,status,description,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,target_at=excluded.target_at,status=excluded.status,description=excluded.description,updated_at=excluded.updated_at`,
        [
          id,
          orgId,
          milestone.name,
          migrationUuid(milestone.project_id),
          milestone.target_at || null,
          milestone.status || "planned",
          milestone.description || null,
          milestone.created_at || new Date().toISOString(),
          milestone.updated_at || new Date().toISOString(),
        ],
      );
      counts.milestones++;
    }
    for (const task of input.tasks || []) {
      const id = migrationUuid(task.id);
      if (!id)
        throw apiError("invalid_migration_task_id", 400, { id: task.id });
      await client.query(
        `INSERT INTO tasks(id,organization_id,identifier,title,description,status,priority,owner_id,milestone_id,start_at,due_at,completed_at,expected_value_minor,currency,value_confidence,strategic_value,delivery_domain,version,created_by,archived_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1,$18,$19,$20,$21) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,status=excluded.status,priority=excluded.priority,owner_id=excluded.owner_id,milestone_id=excluded.milestone_id,start_at=excluded.start_at,due_at=excluded.due_at,completed_at=excluded.completed_at,expected_value_minor=excluded.expected_value_minor,currency=excluded.currency,value_confidence=excluded.value_confidence,strategic_value=excluded.strategic_value,delivery_domain=excluded.delivery_domain,archived_at=excluded.archived_at,updated_at=excluded.updated_at`,
        [
          id,
          orgId,
          task.identifier,
          task.title,
          task.description || null,
          task.status || "backlog",
          Number(task.priority ?? 2),
          migrationUuid(task.owner_id),
          migrationUuid(task.milestone_id),
          task.start_at || null,
          task.due_at || null,
          task.completed_at || null,
          task.expected_value_minor ?? null,
          task.currency || "CNY",
          task.value_confidence ?? null,
          task.strategic_value ?? null,
          task.delivery_domain || null,
          migrationUuid(task.created_by_id),
          task.archived_at || null,
          task.created_at || new Date().toISOString(),
          task.updated_at || new Date().toISOString(),
        ],
      );
      const projectId = migrationUuid(task.project_id);
      if (projectId)
        await client.query(
          `INSERT INTO task_project_links(task_id,project_id,is_primary) VALUES($1,$2,true) ON CONFLICT(task_id,project_id) DO UPDATE SET is_primary=true`,
          [id, projectId],
        );
      counts.tasks++;
    }
    for (const entry of input.participants || []) {
      const taskId = migrationUuid(entry.task_id),
        personId = migrationUuid(entry.person_id);
      if (!taskId || !personId) continue;
      await client.query(
        `INSERT INTO task_participants(task_id,principal_id,role,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [
          taskId,
          personId,
          entry.role || "collaborator",
          entry.created_at || new Date().toISOString(),
        ],
      );
      counts.participants++;
    }
    for (const entry of input.dependencies || []) {
      const taskId = migrationUuid(entry.task_id),
        dependsOn = migrationUuid(entry.depends_on_task_id);
      if (!taskId || !dependsOn) continue;
      await client.query(
        `INSERT INTO task_dependencies(task_id,depends_on_task_id,dependency_type,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [
          taskId,
          dependsOn,
          entry.dependency_type || "blocks",
          entry.created_at || new Date().toISOString(),
        ],
      );
      counts.dependencies++;
    }
    for (const comment of input.comments || []) {
      const id = migrationUuid(comment.id),
        taskId = migrationUuid(comment.task_id);
      if (!id || !taskId) continue;
      await client.query(
        `INSERT INTO task_comments(id,task_id,body,actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`,
        [
          id,
          taskId,
          comment.body,
          migrationUuid(comment.actor_id),
          comment.created_at || new Date().toISOString(),
          comment.updated_at || comment.created_at || new Date().toISOString(),
        ],
      );
      counts.comments++;
    }
    for (const activity of input.activity || []) {
      const taskId = migrationUuid(activity.task_id);
      if (!taskId) continue;
      await client.query(
        `INSERT INTO task_events(id,organization_id,aggregate_type,aggregate_id,event_type,actor_id,data,created_at) VALUES($1,$2,'task',$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
        [
          migrationUuid(activity.id) || uuid(),
          orgId,
          taskId,
          activity.event_type || "task.migrated",
          migrationUuid(activity.actor_id),
          JSON.stringify(migrationJson(activity.changes)),
          activity.created_at || new Date().toISOString(),
        ],
      );
      counts.events++;
    }
    for (const view of input.views || []) {
      const id = migrationUuid(view.id);
      if (!id) continue;
      await client.query(
        `INSERT INTO task_saved_views(id,organization_id,principal_id,name,view_type,filters,group_by,sort_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,view_type=excluded.view_type,filters=excluded.filters,group_by=excluded.group_by,sort_by=excluded.sort_by,updated_at=excluded.updated_at`,
        [
          id,
          orgId,
          migrationUuid(view.created_by),
          view.name,
          view.view_type || "list",
          JSON.stringify(migrationJson(view.filters)),
          view.group_by || null,
          view.sort_by || null,
          view.created_at || new Date().toISOString(),
          view.updated_at || new Date().toISOString(),
        ],
      );
      counts.views++;
    }
    await client.query("COMMIT");
    send(res, 200, {
      organizationId: orgId,
      counts,
      checksum: sha256(JSON.stringify(counts)),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function taskContext(req, res, actor) {
  requireScope(actor, "tasks:read");
  const orgId = await orgFor(actor, query(req).get("organizationId"), "guest"),
    projectFilter = actor.projectIds?.length ? " AND id=ANY($2::uuid[])" : "",
    milestoneFilter = actor.projectIds?.length
      ? " AND project_id=ANY($2::uuid[])"
      : "",
    projectValues = actor.projectIds?.length
      ? [orgId, actor.projectIds]
      : [orgId],
    [projects, people, milestones] = await Promise.all([
      pool.query(
        `SELECT id,name,catalog_project_id source_ref FROM task_projects WHERE organization_id=$1${projectFilter} ORDER BY name`,
        projectValues,
      ),
      pool.query(
        actor.projectIds?.length
          ? `SELECT DISTINCT p.id,p.kind,p.display_name,p.email FROM task_principals p JOIN task_project_members pm ON pm.principal_id=p.id WHERE pm.project_id=ANY($2::uuid[]) AND p.active ORDER BY p.display_name`
          : `SELECT p.id,p.kind,p.display_name,p.email FROM task_principals p JOIN task_organization_members m ON m.principal_id=p.id WHERE m.organization_id=$1 AND p.active ORDER BY p.display_name`,
        projectValues,
      ),
      pool.query(
        `SELECT * FROM task_milestones WHERE organization_id=$1${milestoneFilter} ORDER BY target_at NULLS LAST,name`,
        projectValues,
      ),
    ]);
  send(
    res,
    200,
    {
      projects: projects.rows,
      people: people.rows,
      milestones: milestones.rows,
    },
    { organizationId: orgId },
  );
}

async function handleApi(req, res, actor) {
  const parts = pathParts(req).slice(3),
    [resource, id, action, child] = parts,
    input = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
      ? await body(req, resource === "migration" ? 20_971_520 : 1_048_576)
      : {};
  if (resource === "organizations" && !id)
    return organizations(req, res, actor, input);
  if (resource === "organizations" && id && action === "members")
    return organizationMembers(req, res, actor, id, input, child);
  if (resource === "organizations" && id && action === "invites")
    return invites(req, res, actor, id, input);
  if (resource === "invites" && id === "accept" && req.method === "POST")
    return invites(req, res, actor, "accept", input);
  if (resource === "projects" && action === "members")
    return projectMembers(req, res, actor, id, input, child);
  if (resource === "projects") return projects(req, res, actor, input, id);
  if (resource === "tasks" && !id && req.method === "GET")
    return listTasks(req, res, actor);
  if (resource === "tasks" && !id && req.method === "POST")
    return createTask(req, res, actor, input);
  if (resource === "tasks" && id && !action && req.method === "GET")
    return getTaskHandler(req, res, actor, id);
  if (resource === "tasks" && id && !action && req.method === "PATCH")
    return updateTask(req, res, actor, id, input);
  if (
    resource === "tasks" &&
    id &&
    action === "comments" &&
    req.method === "POST"
  )
    return addComment(req, res, actor, id, input);
  if (
    resource === "tasks" &&
    id &&
    action === "transition" &&
    req.method === "POST"
  )
    return updateTask(req, res, actor, id, {
      ...input,
      changes: { status: input.status },
    });
  if (
    resource === "tasks" &&
    id &&
    action === "project-links" &&
    req.method === "PUT"
  )
    return replaceProjects(req, res, actor, id, input);
  if (resource === "tasks" && id && action === "dependencies")
    return dependencies(req, res, actor, id, child, input);
  if (
    resource === "tasks" &&
    id &&
    action === "participants" &&
    req.method === "PUT"
  )
    return participants(req, res, actor, id, input);
  if (resource === "tasks" && id && action === "attachments")
    return attachments(req, res, actor, id, child, input);
  if (resource === "boards" && !action)
    return boards(req, res, actor, input, id);
  if (resource === "boards" && id && action === "tasks" && child)
    return boardMembership(
      req,
      res,
      actor,
      id,
      child,
      input,
      req.method === "DELETE",
    );
  if (resource === "events" && req.method === "GET")
    return events(req, res, actor);
  if (resource === "api-keys")
    return apiKeys(req, res, actor, input, id, action);
  if (resource === "webhooks")
    return webhooks(req, res, actor, input, id, action);
  if (resource === "people") return people(req, res, actor, input, id);
  if (resource === "milestones") return milestones(req, res, actor, input, id);
  if (resource === "views") return views(req, res, actor, input, id);
  if (resource === "context" && req.method === "GET")
    return taskContext(req, res, actor);
  if (resource === "migration" && id === "d1" && req.method === "POST")
    return importD1(req, res, actor, input);
  throw apiError("not_found", 404);
}

const MCP_TOOLS = [
  "organizations.list",
  "projects.list",
  "tasks.list",
  "tasks.plan",
  "tasks.get",
  "tasks.create",
  "tasks.update",
  "tasks.transition",
  "tasks.comment",
  "tasks.link_project",
  "boards.list",
  "boards.get",
  "boards.add_task",
  "boards.remove_task",
  "boards.move_task",
  "events.list",
].map((name) => ({
  name,
  description: `TableAI task operation: ${name}`,
  inputSchema: {
    type: "object",
    properties: {
      organizationId: { type: "string" },
      id: { type: "string" },
      taskId: { type: "string" },
      boardId: { type: "string" },
      projectId: { type: "string" },
      status: { type: "string" },
      version: { type: "integer" },
      changes: { type: "object" },
      mutationId: { type: "string" },
    },
  },
}));
async function mcp(req, res, actor) {
  const payload = await body(req),
    id = payload.id,
    method = payload.method,
    args = payload.params?.arguments || {},
    name = payload.params?.name;
  if (method === "initialize")
    return rawJson(res, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "tableai-task-core", version: "1.0.0" },
        capabilities: {
          tools: {},
          resources: { subscribe: false, listChanged: false },
        },
      },
    });
  if (method === "tools/list")
    return rawJson(res, 200, {
      jsonrpc: "2.0",
      id,
      result: { tools: MCP_TOOLS },
    });
  if (method === "resources/list")
    return rawJson(res, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        resources: [
          {
            uri: "ops://tasks/snapshot",
            name: "Default organization task snapshot",
            mimeType: "application/json",
          },
          {
            uri: "ops://organizations/{id}/tasks/snapshot",
            name: "Organization task snapshot",
            mimeType: "application/json",
          },
          {
            uri: "ops://boards/{id}/snapshot",
            name: "Board snapshot",
            mimeType: "application/json",
          },
        ],
      },
    });
  try {
    if (method === "resources/read") {
      const uri = String(payload.params?.uri || ""),
        org = uri.match(/^ops:\/\/organizations\/([^/]+)\/tasks\/snapshot$/),
        board = uri.match(/^ops:\/\/boards\/([^/]+)\/snapshot$/);
      let result;
      if (uri === "ops://tasks/snapshot")
        result = await invoke(
          "GET",
          `/api/task/v1/tasks?organizationId=${encodeURIComponent(defaultOrg.id)}&limit=200`,
          actor,
        );
      else if (org)
        result = await invoke(
          "GET",
          `/api/task/v1/tasks?organizationId=${encodeURIComponent(org[1])}&limit=200`,
          actor,
        );
      else if (board)
        result = await invoke(
          "GET",
          `/api/task/v1/boards/${encodeURIComponent(board[1])}`,
          actor,
        );
      else throw apiError("resource_not_found", 404);
      return rawJson(res, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    }
    if (method !== "tools/call") throw apiError("method_not_found", 404);
    const result = await callMcpTool(req, actor, name, args);
    return rawJson(res, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      },
    });
  } catch (error) {
    return rawJson(res, error.status || 400, {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32602,
        message: error.code || error.message,
        data: error.details || null,
      },
    });
  }
}
function rawJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function invoke(method, url, actor, input = {}, headers = {}) {
  const req = {
      method,
      url,
      headers: {
        ...headers,
        "x-task-internal-token": INTERNAL_TOKEN,
        "x-task-actor-id": actor.id || "",
        "x-task-actor-type": actor.kind || "system",
      },
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify(input));
      },
    },
    chunks = [];
  const res = {
    writeHead(status, h) {
      this.status = status;
      this.headers = h;
    },
    end(data) {
      if (data) chunks.push(Buffer.from(data));
    },
  };
  await handleApi(req, res, actor);
  const parsed = JSON.parse(Buffer.concat(chunks).toString());
  if ((res.status || 200) >= 400)
    throw apiError(
      parsed.error?.code || "mcp_error",
      res.status,
      parsed.error?.details,
    );
  return parsed.data;
}
async function callMcpTool(req, actor, name, args) {
  const org = `organizationId=${encodeURIComponent(args.organizationId || actor.organizationId || defaultOrg.id)}`;
  if (name === "organizations.list")
    return invoke("GET", "/api/task/v1/organizations", actor);
  if (name === "projects.list")
    return invoke("GET", `/api/task/v1/projects?${org}`, actor);
  if (name === "tasks.list" || name === "tasks.plan")
    return invoke(
      "GET",
      `/api/task/v1/tasks?${org}${args.status ? `&status=${args.status}` : ""}${args.projectId ? `&projectId=${args.projectId}` : ""}${args.ownerId ? `&ownerId=${args.ownerId}` : ""}${args.q ? `&q=${encodeURIComponent(args.q)}` : ""}`,
      actor,
    );
  if (name === "tasks.get")
    return invoke("GET", `/api/task/v1/tasks/${args.id}?${org}`, actor);
  if (name === "tasks.create")
    return invoke("POST", "/api/task/v1/tasks", actor, args, {
      "idempotency-key": args.mutationId || uuid(),
    });
  if (name === "tasks.update")
    return invoke(
      "PATCH",
      `/api/task/v1/tasks/${args.id}`,
      actor,
      { ...args, changes: args.changes },
      {
        "if-match": String(args.version || args.changes?.version || "").trim(),
        "idempotency-key": args.mutationId || uuid(),
      },
    );
  if (name === "tasks.transition")
    return invoke(
      "POST",
      `/api/task/v1/tasks/${args.id}/transition`,
      actor,
      args,
      {
        "if-match": String(args.version || ""),
        "idempotency-key": args.mutationId || uuid(),
      },
    );
  if (name === "tasks.comment")
    return invoke(
      "POST",
      `/api/task/v1/tasks/${args.id}/comments`,
      actor,
      args,
      { "idempotency-key": args.mutationId || uuid() },
    );
  if (name === "tasks.link_project")
    return invoke(
      "PUT",
      `/api/task/v1/tasks/${args.id}/project-links`,
      actor,
      args,
      { "idempotency-key": args.mutationId || uuid() },
    );
  if (name === "boards.list")
    return invoke("GET", `/api/task/v1/boards?${org}`, actor);
  if (name === "boards.get")
    return invoke("GET", `/api/task/v1/boards/${args.id}?${org}`, actor);
  if (name === "boards.add_task" || name === "boards.move_task")
    return invoke(
      "POST",
      `/api/task/v1/boards/${args.boardId}/tasks/${args.taskId}`,
      actor,
      args,
      { "idempotency-key": args.mutationId || uuid() },
    );
  if (name === "boards.remove_task")
    return invoke(
      "DELETE",
      `/api/task/v1/boards/${args.boardId}/tasks/${args.taskId}`,
      actor,
      args,
      { "idempotency-key": args.mutationId || uuid() },
    );
  if (name === "events.list")
    return invoke(
      "GET",
      `/api/task/v1/events?${org}&cursor=${args.cursor || 0}`,
      actor,
    );
  throw apiError("unknown_tool", 404);
}

async function webhookLoop() {
  if (!ENCRYPTION_KEY) return;
  try {
    const rows = (
      await pool.query(
        `SELECT d.*,w.url,w.secret_ciphertext,e.id event_id,e.organization_id,e.event_type,e.aggregate_type,e.aggregate_id,e.data,e.created_at event_created_at FROM task_webhook_deliveries d JOIN task_webhooks w ON w.id=d.webhook_id JOIN task_events e ON e.sequence=d.event_sequence WHERE d.status IN ('pending','failed') AND d.next_attempt_at<=now() AND d.attempt_count<10 ORDER BY d.next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
      )
    ).rows;
    for (const row of rows) {
      await pool.query(
        "UPDATE task_webhook_deliveries SET status='delivering',attempt_count=attempt_count+1,updated_at=now() WHERE id=$1",
        [row.id],
      );
      const payload = JSON.stringify({
          id: row.event_id,
          sequence: Number(row.event_sequence),
          organizationId: row.organization_id,
          eventType: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          data: row.data,
          createdAt: row.event_created_at,
        }),
        timestamp = Math.floor(Date.now() / 1000),
        signature = createHmac(
          "sha256",
          decryptSecret(row.secret_ciphertext, ENCRYPTION_KEY),
        )
          .update(`${timestamp}.${payload}`)
          .digest("hex");
      try {
        const response = await fetch(row.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tableai-event-id": row.event_id,
            "x-tableai-timestamp": String(timestamp),
            "x-tableai-signature": `v1=${signature}`,
          },
          body: payload,
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await pool.query(
          "UPDATE task_webhook_deliveries SET status='delivered',response_status=$1,delivered_at=now(),updated_at=now() WHERE id=$2",
          [response.status, row.id],
        );
      } catch (error) {
        const delays = [60, 300, 1800, 7200, 43200],
          delay =
            delays[Math.min(Number(row.attempt_count || 0), delays.length - 1)];
        await pool.query(
          "UPDATE task_webhook_deliveries SET status='failed',last_error=$1,next_attempt_at=now()+($2||' seconds')::interval,updated_at=now() WHERE id=$3",
          [String(error.message).slice(0, 1000), String(delay), row.id],
        );
      }
    }
  } catch (error) {
    log("webhook.loop_error", { message: error.message });
  }
}

async function metricsResponse(res) {
  const webhook = (
      await pool.query(
        "SELECT count(*) FILTER(WHERE status='failed') failed,count(*) FILTER(WHERE status IN ('pending','delivering')) pending FROM task_webhook_deliveries",
      )
    ).rows[0],
    connections = [...sockets.values()].reduce((sum, set) => sum + set.size, 0),
    average = metrics.requests
      ? metrics.requestDurationMs / metrics.requests
      : 0,
    lines = [
      "# TYPE tableai_task_requests_total counter",
      `tableai_task_requests_total ${metrics.requests}`,
      "# TYPE tableai_task_request_errors_total counter",
      `tableai_task_request_errors_total ${metrics.errors}`,
      "# TYPE tableai_task_version_conflicts_total counter",
      `tableai_task_version_conflicts_total ${metrics.conflicts}`,
      "# TYPE tableai_task_events_published_total counter",
      `tableai_task_events_published_total ${metrics.events}`,
      "# TYPE tableai_task_request_duration_ms gauge",
      `tableai_task_request_duration_ms ${average.toFixed(3)}`,
      "# TYPE tableai_task_event_broadcast_lag_ms gauge",
      `tableai_task_event_broadcast_lag_ms ${metrics.eventBroadcastLagMs}`,
      "# TYPE tableai_task_websocket_connections gauge",
      `tableai_task_websocket_connections ${connections}`,
      "# TYPE tableai_task_postgres_connections gauge",
      `tableai_task_postgres_connections ${pool.totalCount}`,
      "# TYPE tableai_task_webhook_pending gauge",
      `tableai_task_webhook_pending ${Number(webhook.pending)}`,
      "# TYPE tableai_task_webhook_failed gauge",
      `tableai_task_webhook_failed ${Number(webhook.failed)}`,
    ];
  res.writeHead(200, {
    "content-type": "text/plain; version=0.0.4",
    "cache-control": "no-store",
  });
  res.end(`${lines.join("\n")}\n`);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    if (req.url === "/health")
      return send(res, 200, {
        ok: true,
        service: "task-core",
        postgres: true,
        redis: Boolean(redis),
        websockets: [...sockets.values()].reduce(
          (sum, set) => sum + set.size,
          0,
        ),
        postgresPool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      });
    if (req.url === "/metrics") return metricsResponse(res);
    const actor = await authenticate(req);
    if (
      actor.session &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !validSessionOrigin(req)
    )
      throw apiError("invalid_origin", 403);
    if (req.url.startsWith("/api/task/v1/")) await handleApi(req, res, actor);
    else if (req.url.startsWith("/mcp/task")) await mcp(req, res, actor);
    else throw apiError("not_found", 404);
  } catch (error) {
    fail(res, req, error);
  } finally {
    const durationMs = Date.now() - started;
    metrics.requests++;
    metrics.requestDurationMs += durationMs;
    log("request", {
      requestId: requestId(req),
      method: req.method,
      path: new URL(req.url, "http://task-core").pathname,
      durationMs,
    });
  }
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url, "http://task-core");
    if (url.pathname !== "/api/task/v1/realtime")
      throw apiError("not_found", 404);
    const actor = await authenticate(req),
      orgId = await orgFor(
        actor,
        url.searchParams.get("organizationId"),
        "guest",
      ),
      cursor = Math.max(Number(url.searchParams.get("cursor") || 0), 0);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.actor = actor;
      ws.organizationId = orgId;
      if (!sockets.has(orgId)) sockets.set(orgId, new Set());
      sockets.get(orgId).add(ws);
      ws.on("close", () => sockets.get(orgId)?.delete(ws));
      ws.on("message", async (raw) => {
        try {
          const message = JSON.parse(raw);
          if (message.type === "ping")
            return ws.send(
              JSON.stringify({ type: "pong", at: new Date().toISOString() }),
            );
          if (["presence.viewing", "presence.editing"].includes(message.type)) {
            let projectIds = [];
            if (message.taskId) {
              const task = await taskRow(pool, String(message.taskId), orgId);
              if (!task) throw apiError("task_not_found", 404);
              await enforceTaskAccess(pool, actor, task);
              projectIds = task.project_ids || [];
            } else if (message.boardId) {
              const board = (
                await pool.query(
                  "SELECT * FROM task_boards WHERE id=$1 AND organization_id=$2",
                  [message.boardId, orgId],
                )
              ).rows[0];
              if (!board) throw apiError("board_not_found", 404);
              enforceBoardAccess(actor, board);
              projectIds = board.project_id ? [String(board.project_id)] : [];
            } else if (actor.projectIds?.length) {
              throw apiError("presence_scope_required", 400);
            }
            const payload = {
              type: message.type,
              organizationId: orgId,
              principalId: actor.id,
              taskId: message.taskId || null,
              boardId: message.boardId || null,
              projectIds,
              expiresIn: 30,
            };
            if (redis)
              await redis.set(
                `presence:${orgId}:${actor.id}`,
                JSON.stringify(payload),
                { EX: 30 },
              );
            broadcast(payload);
          }
        } catch {}
      });
      (async () => {
        const values = [orgId, cursor],
          where = ["e.organization_id=$1", "e.sequence>$2"];
        if (actor.projectIds?.length) {
          values.push(actor.projectIds);
          where.push(
            `((e.aggregate_type='task' AND EXISTS(SELECT 1 FROM task_project_links scoped WHERE scoped.task_id=e.aggregate_id AND scoped.project_id=ANY($${values.length}::uuid[]))) OR (e.aggregate_type='board' AND e.data ? 'taskId' AND EXISTS(SELECT 1 FROM task_project_links scoped WHERE scoped.task_id=(e.data->>'taskId')::uuid AND scoped.project_id=ANY($${values.length}::uuid[]))))`,
          );
        }
        const rows = await pool.query(
          `SELECT e.* FROM task_events e WHERE ${where.join(" AND ")} ORDER BY e.sequence LIMIT 1000`,
          values,
        );
        for (const event of rows.rows) {
          const scopedTaskId =
              event.aggregate_type === "task"
                ? event.aggregate_id
                : event.aggregate_type === "board"
                  ? event.data?.taskId
                  : null,
            projectIds = scopedTaskId
              ? (
                  await pool.query(
                    "SELECT project_id::text FROM task_project_links WHERE task_id=$1",
                    [scopedTaskId],
                  )
                ).rows.map((row) => row.project_id)
              : [];
          ws.send(
            JSON.stringify({
              type: "event",
              sequence: Number(event.sequence),
              id: event.id,
              organizationId: orgId,
              eventType: event.event_type,
              aggregateType: event.aggregate_type,
              aggregateId: event.aggregate_id,
              data: event.data,
              projectIds,
              createdAt: event.created_at,
            }),
          );
        }
        ws.send(
          JSON.stringify({
            type: "ready",
            organizationId: orgId,
            cursor: Number(rows.rows.at(-1)?.sequence || cursor),
            heartbeatSeconds: 15,
          }),
        );
      })();
    });
  } catch (error) {
    socket.write(
      `HTTP/1.1 ${error.status || 401} Unauthorized\r\nConnection: close\r\n\r\n`,
    );
    socket.destroy();
  }
});

await migrate();
await bootstrap();
await connectRedis();
setInterval(webhookLoop, 5000).unref();
setInterval(
  () =>
    pool
      .query("DELETE FROM task_idempotency WHERE expires_at<now()")
      .catch(() => {}),
  3600000,
).unref();
server.listen(PORT, "0.0.0.0", () =>
  log("started", { port: PORT, defaultOrganizationId: defaultOrg.id }),
);
process.on("SIGTERM", async () => {
  server.close();
  await Promise.allSettled([pool.end(), redis?.quit(), subscriber?.quit()]);
  process.exit(0);
});
