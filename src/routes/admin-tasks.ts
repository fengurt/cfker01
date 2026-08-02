import {
  isValidRequestOrigin,
  readAdminSession,
  requireAdminToken,
} from "../lib/auth";
import {
  addDependency,
  addTaskComment,
  createTask,
  getTask,
  serializeTask,
  taskError,
  updateTask,
  type TaskActor,
  type TaskInput,
} from "../lib/tasks";
import { proxyLegacyAdminTasks } from "./task-core-proxy";

const PERSON_KINDS = new Set(["person", "agent", "contact"]);
const MILESTONE_STATUSES = new Set([
  "planned",
  "active",
  "completed",
  "cancelled",
]);
const VIEW_TYPES = new Set(["list", "board", "gantt"]);
const PERSON_ROLES = new Set([
  "collaborator",
  "agent",
  "counterpart",
  "reviewer",
]);

export async function handleAdminTasksV1(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const proxied = await proxyLegacyAdminTasks(request, env);
  if (proxied) return proxied;
  const auth = await requireAdminToken(request, env);
  if (auth)
    return error(
      request,
      "unauthorized",
      "Administrator authentication is required.",
      401,
    );
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.has("Cookie") &&
    !isValidRequestOrigin(request)
  )
    return error(
      request,
      "invalid_origin",
      "The request origin is not allowed.",
      403,
    );
  const session = await readAdminSession(request, env);
  const actor: TaskActor = {
    type: "admin",
    id: session?.userId ?? "admin_token",
  };
  const url = new URL(request.url),
    parts = url.pathname.split("/").filter(Boolean).slice(3);
  const [resource, id, action, childId] = parts;
  try {
    if (resource === "tasks") {
      if (!id && request.method === "GET")
        return await listTasks(request, env, url);
      if (!id && request.method === "POST")
        return await createTaskRoute(request, env, actor);
      if (id === "gantt" && request.method === "GET")
        return await gantt(request, env, url);
      if (id && !action && request.method === "GET")
        return await taskDetail(request, env, id);
      if (id && !action && request.method === "PATCH")
        return await patchTaskRoute(request, env, id, actor);
      if (id && action === "transition" && request.method === "POST")
        return await transitionTask(request, env, id, actor);
      if (id && action === "comments" && request.method === "POST")
        return await commentTask(request, env, id, actor);
      if (id && action === "dependencies" && request.method === "POST")
        return await createDependency(request, env, id, actor);
      if (
        id &&
        action === "dependencies" &&
        childId &&
        request.method === "DELETE"
      )
        return await deleteDependency(request, env, id, childId, actor);
      if (id && action === "participants" && request.method === "PUT")
        return await putParticipants(request, env, id, actor);
    }
    if (resource === "task-people") {
      if (!id && request.method === "GET")
        return await listPeople(request, env, url);
      if (!id && request.method === "POST")
        return await createPerson(request, env, actor);
      if (id && request.method === "PATCH")
        return await patchPerson(request, env, id, actor);
    }
    if (resource === "task-milestones") {
      if (!id && request.method === "GET")
        return await listMilestones(request, env, url);
      if (!id && request.method === "POST")
        return await createMilestone(request, env, actor);
      if (id && request.method === "PATCH")
        return await patchMilestone(request, env, id, actor);
    }
    if (resource === "task-views") {
      if (!id && request.method === "GET") return await listViews(request, env);
      if (!id && request.method === "POST")
        return await createView(request, env, actor);
      if (id && request.method === "DELETE")
        return await deleteView(request, env, id, actor);
    }
    if (resource === "task-context" && request.method === "GET")
      return await context(request, env, url);
    return error(request, "not_found", "Task API endpoint not found.", 404);
  } catch (cause) {
    const typed = cause as Error & { code?: string; status?: number };
    const code = typed.code ?? typed.message ?? "internal_error",
      status = typed.status ?? mapDatabaseStatus(code);
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "task_api.error",
          requestId: requestId(request),
          path: url.pathname,
          error: code,
        }),
      );
    return error(
      request,
      status >= 500 ? "internal_error" : code,
      status >= 500
        ? "The task request could not be completed."
        : humanMessage(code),
      status,
    );
  }
}

async function listTasks(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const limit = integerParam(url, "limit", 100, 1, 200),
    values: unknown[] = [],
    where = ["t.archived_at IS NULL"];
  for (const [param, column] of [
    ["project", "t.project_id"],
    ["milestone", "t.milestone_id"],
    ["owner", "t.owner_id"],
    ["domain", "t.delivery_domain"],
  ] as const) {
    const value = url.searchParams.get(param)?.trim();
    if (value) {
      values.push(value);
      where.push(`${column}=?${values.length}`);
    }
  }
  const participant = url.searchParams.get("participant")?.trim();
  if (participant) {
    values.push(participant);
    where.push(
      `EXISTS (SELECT 1 FROM task_participants tf WHERE tf.task_id=t.id AND tf.person_id=?${values.length})`,
    );
  }
  const statuses = url.searchParams
    .getAll("status")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (statuses.length) {
    values.push(...statuses);
    where.push(
      `t.status IN (${statuses.map((_, index) => `?${values.length - statuses.length + index + 1}`).join(",")})`,
    );
  }
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    values.push(`%${q}%`);
    where.push(
      `(t.title LIKE ?${values.length} OR t.identifier LIKE ?${values.length} OR t.description LIKE ?${values.length})`,
    );
  }
  const dueBefore = isoParam(url, "due_before"),
    dueAfter = isoParam(url, "due_after");
  if (dueBefore) {
    values.push(dueBefore);
    where.push(`t.due_at<=?${values.length}`);
  }
  if (dueAfter) {
    values.push(dueAfter);
    where.push(`t.due_at>=?${values.length}`);
  }
  const minimumValue = url.searchParams.get("value_min");
  if (minimumValue) {
    const number = Number(minimumValue);
    if (!Number.isFinite(number) || number < 0)
      throw taskError("invalid_value_filter");
    values.push(Math.round(number * 100));
    where.push(`t.expected_value_minor>=?${values.length}`);
  }
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.has("cursor") && !cursor)
    throw taskError("invalid_cursor");
  if (cursor) {
    values.push(cursor.updatedAt, cursor.id);
    where.push(
      `(t.updated_at<?${values.length - 1} OR (t.updated_at=?${values.length - 1} AND t.id>?${values.length}))`,
    );
  }
  const sort = url.searchParams.get("sort") ?? "updated";
  const order =
    sort === "due"
      ? "CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,t.due_at ASC,t.updated_at DESC"
      : sort === "priority"
        ? "t.priority ASC,t.due_at ASC,t.updated_at DESC"
        : sort === "value"
          ? "t.expected_value_minor DESC,t.updated_at DESC"
          : sort === "updated"
            ? "t.updated_at DESC,t.id ASC"
            : (() => {
                throw taskError("invalid_sort");
              })();
  const rows = await env.MGMT_DB.prepare(
    `${taskSelect()} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?${values.length + 1}`,
  )
    .bind(...values, limit + 1)
    .all<Record<string, unknown>>();
  const all = rows.results ?? [],
    page = all.slice(0, limit).map(serializeTask),
    tail = page.at(-1);
  const nextCursor =
    all.length > limit && tail
      ? encodeCursor({ updatedAt: String(tail.updatedAt), id: String(tail.id) })
      : null;
  const now = new Date(),
    dueSoon = new Date(now.getTime() + 7 * 86_400_000);
  const summary = await env.MGMT_DB.prepare(
    `SELECT COUNT(*) total,SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) open_count,SUM(CASE WHEN status NOT IN ('done','cancelled') AND due_at<?1 THEN 1 ELSE 0 END) overdue_count,SUM(CASE WHEN status NOT IN ('done','cancelled') AND due_at>=?1 AND due_at<=?2 THEN 1 ELSE 0 END) due_soon_count,SUM(CASE WHEN status NOT IN ('done','cancelled') AND owner_id IS NULL THEN 1 ELSE 0 END) unassigned_count,SUM(CASE WHEN status NOT IN ('done','cancelled') THEN COALESCE(expected_value_minor,0) ELSE 0 END) open_value_minor FROM tasks WHERE archived_at IS NULL`,
  )
    .bind(now.toISOString(), dueSoon.toISOString())
    .first<Record<string, unknown>>();
  return data(request, page, {
    limit,
    nextCursor,
    hasMore: Boolean(nextCursor),
    summary: {
      total: Number(summary?.total ?? 0),
      open: Number(summary?.open_count ?? 0),
      overdue: Number(summary?.overdue_count ?? 0),
      dueSoon: Number(summary?.due_soon_count ?? 0),
      unassigned: Number(summary?.unassigned_count ?? 0),
      openExpectedValue: Number(summary?.open_value_minor ?? 0) / 100,
    },
  });
}

async function createTaskRoute(
  request: Request,
  env: Env,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request),
    task = await createTask(env, body as TaskInput, actor);
  if (Array.isArray(body.participants))
    await replaceParticipants(env, String(task.id), body.participants, actor);
  if (Array.isArray(body.dependencies))
    for (const id of body.dependencies.map(String))
      await addDependency(env, String(task.id), id, actor);
  return data(request, await getTask(env, String(task.id)), {}, 201);
}

async function patchTaskRoute(
  request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request),
    task = await updateTask(env, id, body as TaskInput, actor);
  return data(request, task);
}

async function transitionTask(
  request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request);
  return data(
    request,
    await updateTask(env, id, { status: body.status }, actor),
  );
}

async function commentTask(
  request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request);
  return data(
    request,
    await addTaskComment(env, id, body.body, actor),
    {},
    201,
  );
}

async function taskDetail(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const task = await getTask(env, id);
  if (!task) return error(request, "task_not_found", "Task not found.", 404);
  const [participants, dependencies, comments, activity] = await Promise.all([
    env.MGMT_DB.prepare(
      `SELECT tp.role,p.id,p.kind,p.display_name,p.handle,p.email FROM task_participants tp JOIN task_people p ON p.id=tp.person_id WHERE tp.task_id=?1 ORDER BY tp.role,p.display_name`,
    )
      .bind(task.id)
      .all(),
    env.MGMT_DB.prepare(
      `SELECT d.dependency_type,t.id,t.identifier,t.title,t.status,t.due_at FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_task_id WHERE d.task_id=?1 ORDER BY t.due_at,t.identifier`,
    )
      .bind(task.id)
      .all(),
    env.MGMT_DB.prepare(
      `SELECT id,body,actor_type,actor_id,created_at,updated_at FROM task_comments WHERE task_id=?1 ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(task.id)
      .all(),
    env.MGMT_DB.prepare(
      `SELECT id,event_type,actor_type,actor_id,changes,created_at FROM task_activity WHERE task_id=?1 ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(task.id)
      .all(),
  ]);
  return data(request, {
    ...task,
    participants: participants.results ?? [],
    dependencies: dependencies.results ?? [],
    comments: comments.results ?? [],
    activity: (activity.results ?? []).map((row) => ({
      ...row,
      changes: parseJson((row as Record<string, unknown>).changes, {}),
    })),
  });
}

async function createDependency(
  request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request);
  await addDependency(env, id, String(body.dependsOnTaskId ?? ""), actor);
  return data(request, await getTask(env, id), {}, 201);
}

async function deleteDependency(
  _request: Request,
  env: Env,
  id: string,
  childId: string,
  actor: TaskActor,
): Promise<Response> {
  const task = await getTask(env, id),
    parent = await getTask(env, childId);
  if (!task || !parent) throw taskError("task_not_found", 404);
  await env.MGMT_DB.prepare(
    `DELETE FROM task_dependencies WHERE task_id=?1 AND depends_on_task_id=?2`,
  )
    .bind(task.id, parent.id)
    .run();
  await audit(
    env,
    "task.dependency_removed",
    { taskId: task.id, dependsOnTaskId: parent.id, actor },
    new Date().toISOString(),
  );
  return new Response(null, { status: 204 });
}

async function putParticipants(
  request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request);
  if (!Array.isArray(body.participants))
    throw taskError("invalid_participants");
  await replaceParticipants(env, id, body.participants, actor);
  return taskDetail(request, env, id);
}

async function replaceParticipants(
  env: Env,
  taskId: string,
  input: unknown[],
  actor: TaskActor,
) {
  const task = await getTask(env, taskId);
  if (!task) throw taskError("task_not_found", 404);
  const normalized = input.slice(0, 50).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw taskError("invalid_participants");
    const personId = String((item as Record<string, unknown>).personId ?? ""),
      role = String((item as Record<string, unknown>).role ?? "collaborator");
    if (!personId || !PERSON_ROLES.has(role))
      throw taskError("invalid_participants");
    return { personId, role };
  });
  await env.MGMT_DB.prepare(`DELETE FROM task_participants WHERE task_id=?1`)
    .bind(task.id)
    .run();
  if (normalized.length)
    await env.MGMT_DB.batch(
      normalized.map((item) =>
        env.MGMT_DB.prepare(
          `INSERT INTO task_participants(task_id,person_id,role,created_at) VALUES(?1,?2,?3,?4)`,
        ).bind(task.id, item.personId, item.role, new Date().toISOString()),
      ),
    );
  await audit(
    env,
    "task.participants_replaced",
    { taskId: task.id, count: normalized.length, actor },
    new Date().toISOString(),
  );
}

async function gantt(request: Request, env: Env, url: URL): Promise<Response> {
  const values: unknown[] = [],
    where = ["t.archived_at IS NULL", "t.status!='cancelled'"];
  for (const [param, column] of [
    ["project", "t.project_id"],
    ["owner", "t.owner_id"],
    ["milestone", "t.milestone_id"],
    ["domain", "t.delivery_domain"],
  ] as const) {
    const value = url.searchParams.get(param)?.trim();
    if (value) {
      values.push(value);
      where.push(`${column}=?${values.length}`);
    }
  }
  const participant = url.searchParams.get("participant")?.trim();
  if (participant) {
    values.push(participant);
    where.push(
      `EXISTS (SELECT 1 FROM task_participants tf WHERE tf.task_id=t.id AND tf.person_id=?${values.length})`,
    );
  }
  const rows = await env.MGMT_DB.prepare(
    `${taskSelect()} WHERE ${where.join(" AND ")} ORDER BY COALESCE(t.start_at,t.created_at),COALESCE(t.due_at,t.start_at,t.created_at) LIMIT 500`,
  )
    .bind(...values)
    .all<Record<string, unknown>>();
  const ids = (rows.results ?? []).map((row) => String(row.id));
  let dependencies: unknown[] = [];
  if (ids.length) {
    const result = await env.MGMT_DB.prepare(
      `SELECT task_id,depends_on_task_id,dependency_type FROM task_dependencies WHERE task_id IN (${ids.map((_, index) => `?${index + 1}`).join(",")})`,
    )
      .bind(...ids)
      .all();
    dependencies = result.results ?? [];
  }
  return data(
    request,
    { tasks: (rows.results ?? []).map(serializeTask), dependencies },
    { count: rows.results?.length ?? 0 },
  );
}

async function listPeople(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const q = url.searchParams.get("q")?.trim(),
    kind = url.searchParams.get("kind")?.trim(),
    values: unknown[] = [],
    where = ["active=1"];
  if (kind) {
    if (!PERSON_KINDS.has(kind)) throw taskError("invalid_person_kind");
    values.push(kind);
    where.push(`kind=?${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(
      `(display_name LIKE ?${values.length} OR handle LIKE ?${values.length} OR email LIKE ?${values.length})`,
    );
  }
  const rows = await env.MGMT_DB.prepare(
    `SELECT * FROM task_people WHERE ${where.join(" AND ")} ORDER BY kind,display_name LIMIT 500`,
  )
    .bind(...values)
    .all<Record<string, unknown>>();
  return data(request, (rows.results ?? []).map(serializePerson));
}

async function createPerson(
  request: Request,
  env: Env,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request),
    kind = String(body.kind ?? "person"),
    name = requiredText(body.displayName, 160, "invalid_person_name");
  if (!PERSON_KINDS.has(kind)) throw taskError("invalid_person_kind");
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    handle = nullableText(body.handle, 160),
    email = nullableText(body.email, 320);
  await env.MGMT_DB.prepare(
    `INSERT INTO task_people(id,kind,display_name,handle,email,metadata,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'{}',?6,?6)`,
  )
    .bind(id, kind, name, handle, email, now)
    .run();
  await audit(env, "task.person_created", { id, kind, actor }, now);
  return data(
    request,
    { id, kind, displayName: name, handle, email, active: true },
    {},
    201,
  );
}

async function patchPerson(
  request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request),
    columns: string[] = [],
    values: unknown[] = [];
  if (body.displayName !== undefined) {
    columns.push("display_name");
    values.push(requiredText(body.displayName, 160, "invalid_person_name"));
  }
  if (body.handle !== undefined) {
    columns.push("handle");
    values.push(nullableText(body.handle, 160));
  }
  if (body.email !== undefined) {
    columns.push("email");
    values.push(nullableText(body.email, 320));
  }
  if (body.kind !== undefined) {
    const kind = String(body.kind);
    if (!PERSON_KINDS.has(kind)) throw taskError("invalid_person_kind");
    columns.push("kind");
    values.push(kind);
  }
  if (body.active !== undefined) {
    columns.push("active");
    values.push(body.active ? 1 : 0);
  }
  if (!columns.length) throw taskError("no_changes");
  const now = new Date().toISOString();
  const result = await env.MGMT_DB.prepare(
    `UPDATE task_people SET ${columns.map((column, index) => `${column}=?${index + 1}`).join(",")},updated_at=?${columns.length + 1} WHERE id=?${columns.length + 2}`,
  )
    .bind(...values, now, id)
    .run();
  if (!result.meta?.changes) throw taskError("person_not_found", 404);
  await audit(env, "task.person_updated", { id, actor, fields: columns }, now);
  return data(request, { id, updatedAt: now });
}

async function listMilestones(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const project = url.searchParams.get("project"),
    values: unknown[] = [];
  const clause = project ? (values.push(project), "WHERE m.project_id=?1") : "";
  const rows = await env.MGMT_DB.prepare(
    `SELECT m.*,p.name project_name,(SELECT COUNT(*) FROM tasks t WHERE t.milestone_id=m.id AND t.archived_at IS NULL) task_count FROM task_milestones m LEFT JOIN catalog_projects p ON p.id=m.project_id ${clause} ORDER BY CASE WHEN m.target_at IS NULL THEN 1 ELSE 0 END,m.target_at,m.name LIMIT 500`,
  )
    .bind(...values)
    .all<Record<string, unknown>>();
  return data(request, (rows.results ?? []).map(serializeMilestone));
}

async function createMilestone(
  request: Request,
  env: Env,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request),
    name = requiredText(body.name, 180, "invalid_milestone_name"),
    status = String(body.status ?? "planned");
  if (!MILESTONE_STATUSES.has(status))
    throw taskError("invalid_milestone_status");
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    projectId = nullableText(body.projectId, 100),
    targetAt = optionalIso(body.targetAt, "invalid_milestone_target"),
    description = nullableText(body.description, 5000);
  await env.MGMT_DB.prepare(
    `INSERT INTO task_milestones(id,name,project_id,target_at,status,description,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)`,
  )
    .bind(id, name, projectId, targetAt, status, description, now)
    .run();
  await audit(env, "task.milestone_created", { id, actor }, now);
  return data(
    request,
    { id, name, projectId, targetAt, status, description },
    {},
    201,
  );
}

async function patchMilestone(
  request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request),
    columns: string[] = [],
    values: unknown[] = [];
  for (const [inputKey, column, max] of [
    ["name", "name", 180],
    ["projectId", "project_id", 100],
    ["description", "description", 5000],
  ] as const)
    if (body[inputKey] !== undefined) {
      columns.push(column);
      values.push(
        inputKey === "name"
          ? requiredText(body[inputKey], max, "invalid_milestone_name")
          : nullableText(body[inputKey], max),
      );
    }
  if (body.targetAt !== undefined) {
    columns.push("target_at");
    values.push(optionalIso(body.targetAt, "invalid_milestone_target"));
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!MILESTONE_STATUSES.has(status))
      throw taskError("invalid_milestone_status");
    columns.push("status");
    values.push(status);
  }
  if (!columns.length) throw taskError("no_changes");
  const now = new Date().toISOString();
  const result = await env.MGMT_DB.prepare(
    `UPDATE task_milestones SET ${columns.map((column, index) => `${column}=?${index + 1}`).join(",")},updated_at=?${columns.length + 1} WHERE id=?${columns.length + 2}`,
  )
    .bind(...values, now, id)
    .run();
  if (!result.meta?.changes) throw taskError("milestone_not_found", 404);
  await audit(
    env,
    "task.milestone_updated",
    { id, actor, fields: columns },
    now,
  );
  return data(request, { id, updatedAt: now });
}

async function listViews(request: Request, env: Env): Promise<Response> {
  const rows = await env.MGMT_DB.prepare(
    `SELECT * FROM task_saved_views ORDER BY name`,
  ).all<Record<string, unknown>>();
  return data(request, (rows.results ?? []).map(serializeView));
}
async function createView(
  request: Request,
  env: Env,
  actor: TaskActor,
): Promise<Response> {
  const body = await objectBody(request),
    name = requiredText(body.name, 120, "invalid_view_name"),
    viewType = String(body.viewType ?? "list");
  if (!VIEW_TYPES.has(viewType)) throw taskError("invalid_view_type");
  const filters = isObject(body.filters) ? body.filters : {},
    groupBy = nullableText(body.groupBy, 40),
    sortBy = nullableText(body.sortBy, 40),
    id = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.MGMT_DB.prepare(
    `INSERT INTO task_saved_views(id,name,view_type,filters,group_by,sort_by,created_by,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)`,
  )
    .bind(
      id,
      name,
      viewType,
      JSON.stringify(filters),
      groupBy,
      sortBy,
      actor.id,
      now,
    )
    .run();
  return data(
    request,
    { id, name, viewType, filters, groupBy, sortBy },
    {},
    201,
  );
}
async function deleteView(
  _request: Request,
  env: Env,
  id: string,
  actor: TaskActor,
): Promise<Response> {
  const result = await env.MGMT_DB.prepare(
    `DELETE FROM task_saved_views WHERE id=?1`,
  )
    .bind(id)
    .run();
  if (!result.meta?.changes) throw taskError("view_not_found", 404);
  await audit(
    env,
    "task.view_deleted",
    { id, actor },
    new Date().toISOString(),
  );
  return new Response(null, { status: 204 });
}

async function context(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const q = url.searchParams.get("q")?.trim(),
    pattern = q ? `%${q}%` : "%";
  const [projects, people, milestones] = await Promise.all([
    env.MGMT_DB.prepare(
      `SELECT id,name,source_ref FROM catalog_projects WHERE name LIKE ?1 OR source_ref LIKE ?1 ORDER BY updated_at DESC LIMIT 250`,
    )
      .bind(pattern)
      .all(),
    env.MGMT_DB.prepare(
      `SELECT id,kind,display_name,handle FROM task_people WHERE active=1 AND (display_name LIKE ?1 OR handle LIKE ?1) ORDER BY kind,display_name LIMIT 250`,
    )
      .bind(pattern)
      .all(),
    env.MGMT_DB.prepare(
      `SELECT id,name,project_id,target_at,status FROM task_milestones WHERE name LIKE ?1 ORDER BY target_at,name LIMIT 250`,
    )
      .bind(pattern)
      .all(),
  ]);
  return data(request, {
    projects: projects.results ?? [],
    people: people.results ?? [],
    milestones: milestones.results ?? [],
  });
}

function taskSelect() {
  return `SELECT t.*,p.name project_name,m.name milestone_name,o.display_name owner_name,o.kind owner_kind,(SELECT COUNT(*) FROM task_participants tp WHERE tp.task_id=t.id) participant_count,(SELECT COUNT(*) FROM task_dependencies td WHERE td.task_id=t.id) dependency_count,(SELECT COUNT(*) FROM task_dependencies td JOIN tasks parent ON parent.id=td.depends_on_task_id WHERE td.task_id=t.id AND parent.status!='done') blocked_by_count FROM tasks t LEFT JOIN catalog_projects p ON p.id=t.project_id LEFT JOIN task_milestones m ON m.id=t.milestone_id LEFT JOIN task_people o ON o.id=t.owner_id`;
}
function serializePerson(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    handle: row.handle,
    email: row.email,
    active: Boolean(row.active),
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function serializeMilestone(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    projectName: row.project_name,
    targetAt: row.target_at,
    status: row.status,
    description: row.description,
    taskCount: Number(row.task_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function serializeView(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    viewType: row.view_type,
    filters: parseJson(row.filters, {}),
    groupBy: row.group_by,
    sortBy: row.sort_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function encodeCursor(value: { updatedAt: string; id: string }) {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function decodeCursor(
  value: string | null,
): { updatedAt: string; id: string } | null {
  if (!value) return null;
  try {
    const padded =
        value.replaceAll("-", "+").replaceAll("_", "/") +
        "===".slice((value.length + 3) % 4),
      parsed = JSON.parse(atob(padded));
    return parsed.updatedAt && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}
function integerParam(
  url: URL,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = url.searchParams.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw taskError(`invalid_${name}`);
  return value;
}
function isoParam(url: URL, name: string) {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw taskError(`invalid_${name}`);
  return date.toISOString();
}
async function objectBody(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!isObject(value)) throw taskError("invalid_json");
  return value;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function requiredText(value: unknown, max: number, code: string) {
  const output = String(value ?? "").trim();
  if (!output || output.length > max) throw taskError(code);
  return output;
}
function nullableText(value: unknown, max: number) {
  if (value === null || value === undefined) return null;
  const output = String(value).trim();
  if (output.length > max) throw taskError("field_too_long");
  return output || null;
}
function optionalIso(value: unknown, code: string) {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw taskError(code);
  return date.toISOString();
}
function parseJson(value: unknown, fallback: unknown): any {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
}
function requestId(request: Request) {
  return (
    request.headers.get("CF-Ray") ??
    request.headers.get("X-Request-Id") ??
    crypto.randomUUID()
  );
}
function data(
  request: Request,
  value: unknown,
  meta: Record<string, unknown> = {},
  status = 200,
) {
  return Response.json(
    { data: value, meta: { ...meta, requestId: requestId(request) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
function error(
  request: Request,
  code: string,
  message: string,
  status: number,
  details: unknown = null,
) {
  return Response.json(
    { error: { code, message, requestId: requestId(request), details } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
function humanMessage(code: string) {
  return code.replaceAll("_", " ");
}
function mapDatabaseStatus(code: string) {
  return /UNIQUE constraint/i.test(code)
    ? 409
    : /FOREIGN KEY|constraint/i.test(code)
      ? 400
      : 500;
}
function audit(env: Env, event: string, payload: unknown, now: string) {
  return env.MGMT_DB.prepare(
    `INSERT INTO audit_events(event_type,payload,created_at) VALUES(?1,?2,?3)`,
  )
    .bind(event, JSON.stringify(payload), now)
    .run();
}
