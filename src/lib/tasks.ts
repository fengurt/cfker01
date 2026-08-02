export type TaskActor = { type: "admin" | "agent" | "system"; id: string | null };

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "blocked", "in_review", "done", "cancelled"] as const;
const TERMINAL_STATUSES = new Set(["done", "cancelled"]);
const TRANSITIONS: Record<string, Set<string>> = {
  backlog: new Set(["todo", "cancelled"]),
  todo: new Set(["backlog", "in_progress", "blocked", "cancelled"]),
  in_progress: new Set(["todo", "blocked", "in_review", "done", "cancelled"]),
  blocked: new Set(["todo", "in_progress", "cancelled"]),
  in_review: new Set(["in_progress", "done", "cancelled"]),
  done: new Set(["in_progress"]),
  cancelled: new Set(["backlog"]),
};

export interface TaskInput {
  title?: unknown; description?: unknown; status?: unknown; priority?: unknown;
  projectId?: unknown; milestoneId?: unknown; ownerId?: unknown;
  startAt?: unknown; dueAt?: unknown; expectedValue?: unknown; currency?: unknown;
  valueConfidence?: unknown; strategicValue?: unknown; deliveryDomain?: unknown;
}

export function taskError(code: string, status = 400): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status });
}

function text(value: unknown, max: number, nullable = true): string | null {
  if (value === null && nullable) return null;
  const out = String(value ?? "").trim();
  if (!out) return nullable ? null : "";
  if (out.length > max) throw taskError("field_too_long");
  return out;
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw taskError("invalid_date");
  return date.toISOString();
}

function optionalInteger(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw taskError("invalid_number");
  return number;
}

function expectedValueMinor(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100_000_000_000) throw taskError("invalid_expected_value");
  return Math.round(number * 100);
}

export function normalizeTaskInput(input: TaskInput, partial = false): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const has = (key: keyof TaskInput) => Object.prototype.hasOwnProperty.call(input, key);
  if (!partial || has("title")) {
    const title = text(input.title, 240, false);
    if (!title || title.length < 2) throw taskError("invalid_title");
    result.title = title;
  }
  if (!partial || has("description")) result.description = text(input.description, 20_000);
  if (!partial || has("status")) {
    const status = String(input.status ?? "backlog");
    if (!TASK_STATUSES.includes(status as typeof TASK_STATUSES[number])) throw taskError("invalid_status");
    result.status = status;
  }
  if (!partial || has("priority")) {
    const priority = Number(input.priority ?? 2);
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw taskError("invalid_priority");
    result.priority = priority;
  }
  for (const [inputKey, outputKey] of [["projectId", "project_id"], ["milestoneId", "milestone_id"], ["ownerId", "owner_id"]] as const) {
    if (!partial || has(inputKey)) result[outputKey] = text(input[inputKey], 100);
  }
  if (!partial || has("startAt")) result.start_at = optionalDate(input.startAt);
  if (!partial || has("dueAt")) result.due_at = optionalDate(input.dueAt);
  if (!partial || has("expectedValue")) result.expected_value_minor = expectedValueMinor(input.expectedValue);
  if (!partial || has("currency")) {
    const currency = String(input.currency ?? "CNY").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw taskError("invalid_currency");
    result.currency = currency;
  }
  if (!partial || has("valueConfidence")) result.value_confidence = optionalInteger(input.valueConfidence, 0, 100);
  if (!partial || has("strategicValue")) result.strategic_value = optionalInteger(input.strategicValue, 1, 5);
  if (!partial || has("deliveryDomain")) result.delivery_domain = text(input.deliveryDomain, 120);
  if (result.start_at && result.due_at && String(result.start_at) > String(result.due_at)) throw taskError("start_after_due");
  return result;
}

export function serializeTask(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id, identifier: row.identifier, title: row.title, description: row.description,
    status: row.status, priority: row.priority, projectId: row.project_id, projectName: row.project_name,
    milestoneId: row.milestone_id, milestoneName: row.milestone_name, ownerId: row.owner_id,
    ownerName: row.owner_name, ownerKind: row.owner_kind, startAt: row.start_at, dueAt: row.due_at,
    completedAt: row.completed_at, expectedValue: row.expected_value_minor == null ? null : Number(row.expected_value_minor) / 100,
    currency: row.currency, valueConfidence: row.value_confidence, strategicValue: row.strategic_value,
    deliveryDomain: row.delivery_domain, archivedAt: row.archived_at, createdAt: row.created_at,
    updatedAt: row.updated_at, participantCount: Number(row.participant_count ?? 0),
    dependencyCount: Number(row.dependency_count ?? 0), blockedByCount: Number(row.blocked_by_count ?? 0),
  };
}

export async function getTask(env: Env, id: string): Promise<Record<string, unknown> | null> {
  const row = await env.MGMT_DB.prepare(`
    SELECT t.*,p.name project_name,m.name milestone_name,o.display_name owner_name,o.kind owner_kind,
      (SELECT COUNT(*) FROM task_participants tp WHERE tp.task_id=t.id) participant_count,
      (SELECT COUNT(*) FROM task_dependencies td WHERE td.task_id=t.id) dependency_count,
      (SELECT COUNT(*) FROM task_dependencies td JOIN tasks parent ON parent.id=td.depends_on_task_id WHERE td.task_id=t.id AND parent.status!='done') blocked_by_count
    FROM tasks t LEFT JOIN catalog_projects p ON p.id=t.project_id
    LEFT JOIN task_milestones m ON m.id=t.milestone_id LEFT JOIN task_people o ON o.id=t.owner_id
    WHERE t.id=?1 OR t.identifier=?1
  `).bind(id).first<Record<string, unknown>>();
  return row ? serializeTask(row) : null;
}

async function recordActivity(env: Env, taskId: string, eventType: string, actor: TaskActor, changes: unknown, now: string) {
  const fields = changes && typeof changes === "object" && !Array.isArray(changes) ? Object.keys(changes as Record<string, unknown>) : [];
  await env.MGMT_DB.batch([
    env.MGMT_DB.prepare(`INSERT INTO task_activity(id,task_id,event_type,actor_type,actor_id,changes,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(crypto.randomUUID(), taskId, eventType, actor.type, actor.id, JSON.stringify(changes), now),
    env.MGMT_DB.prepare(`INSERT INTO audit_events(event_type,payload,created_at) VALUES(?1,?2,?3)`).bind(eventType, JSON.stringify({ taskId, actorType: actor.type, actorId: actor.id, fields }), now),
  ]);
}

export async function createTask(env: Env, input: TaskInput, actor: TaskActor): Promise<Record<string, unknown>> {
  const values = normalizeTaskInput(input), id = crypto.randomUUID(), identifier = `T-${id.slice(0, 8).toUpperCase()}`, now = new Date().toISOString();
  await env.MGMT_DB.prepare(`INSERT INTO tasks(id,identifier,title,description,status,priority,project_id,milestone_id,owner_id,start_at,due_at,expected_value_minor,currency,value_confidence,strategic_value,delivery_domain,created_by_type,created_by_id,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19)`)
    .bind(id, identifier, values.title, values.description, values.status, values.priority, values.project_id, values.milestone_id, values.owner_id, values.start_at, values.due_at, values.expected_value_minor, values.currency, values.value_confidence, values.strategic_value, values.delivery_domain, actor.type, actor.id, now).run();
  await recordActivity(env, id, "task.created", actor, values, now);
  return (await getTask(env, id))!;
}

export async function updateTask(env: Env, id: string, input: TaskInput, actor: TaskActor, agentRestricted = false): Promise<Record<string, unknown>> {
  const existing = await getTask(env, id);
  if (!existing) throw taskError("task_not_found", 404);
  const values = normalizeTaskInput(input, true);
  if (!Object.keys(values).length) throw taskError("no_changes");
  if (agentRestricted) {
    if (Object.prototype.hasOwnProperty.call(values, "owner_id")) throw taskError("agent_reassignment_requires_admin", 403);
    if (values.status && TERMINAL_STATUSES.has(String(values.status))) throw taskError("agent_terminal_transition_requires_admin", 403);
  }
  if (values.status && values.status !== existing.status && !TRANSITIONS[String(existing.status)]?.has(String(values.status))) throw taskError("invalid_transition", 409);
  const startAt = Object.prototype.hasOwnProperty.call(values, "start_at") ? values.start_at : existing.startAt;
  const dueAt = Object.prototype.hasOwnProperty.call(values, "due_at") ? values.due_at : existing.dueAt;
  if (startAt && dueAt && String(startAt) > String(dueAt)) throw taskError("start_after_due");
  if (values.status === "done") values.completed_at = new Date().toISOString();
  else if (values.status && existing.status === "done") values.completed_at = null;
  const columns = Object.keys(values), now = new Date().toISOString(), bindings = columns.map((key) => values[key]);
  await env.MGMT_DB.prepare(`UPDATE tasks SET ${columns.map((key, index) => `${key}=?${index + 1}`).join(",")},updated_at=?${columns.length + 1} WHERE id=?${columns.length + 2} OR identifier=?${columns.length + 2}`)
    .bind(...bindings, now, id).run();
  await recordActivity(env, String(existing.id), "task.updated", actor, values, now);
  return (await getTask(env, String(existing.id)))!;
}

export async function addTaskComment(env: Env, id: string, body: unknown, actor: TaskActor): Promise<Record<string, unknown>> {
  const task = await getTask(env, id);
  if (!task) throw taskError("task_not_found", 404);
  const content = text(body, 10_000, false);
  if (!content) throw taskError("invalid_comment");
  const commentId = crypto.randomUUID(), now = new Date().toISOString();
  await env.MGMT_DB.prepare(`INSERT INTO task_comments(id,task_id,body,actor_type,actor_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)`)
    .bind(commentId, task.id, content, actor.type, actor.id, now).run();
  await recordActivity(env, String(task.id), "task.commented", actor, { commentId }, now);
  return { id: commentId, taskId: task.id, body: content, actorType: actor.type, actorId: actor.id, createdAt: now };
}

export async function addDependency(env: Env, taskId: string, dependsOnTaskId: string, actor: TaskActor): Promise<void> {
  const [task, parent] = await Promise.all([getTask(env, taskId), getTask(env, dependsOnTaskId)]);
  if (!task || !parent) throw taskError("task_not_found", 404);
  if (task.id === parent.id) throw taskError("self_dependency");
  const cycle = await env.MGMT_DB.prepare(`WITH RECURSIVE chain(id) AS (SELECT depends_on_task_id FROM task_dependencies WHERE task_id=?1 UNION SELECT d.depends_on_task_id FROM task_dependencies d JOIN chain c ON d.task_id=c.id) SELECT id FROM chain WHERE id=?2 LIMIT 1`)
    .bind(parent.id, task.id).first();
  if (cycle) throw taskError("dependency_cycle", 409);
  const now = new Date().toISOString();
  await env.MGMT_DB.prepare(`INSERT OR IGNORE INTO task_dependencies(task_id,depends_on_task_id,dependency_type,created_at) VALUES(?1,?2,'blocks',?3)`).bind(task.id, parent.id, now).run();
  await recordActivity(env, String(task.id), "task.dependency_added", actor, { dependsOnTaskId: parent.id }, now);
}
