import { jsonResponse } from "../lib/response";
import { lookupKey, requireApiKey } from "../lib/apikey";
import { listSources } from "../collectors/registry";
import {
  addTaskComment,
  createTask,
  getTask,
  serializeTask,
  updateTask,
  type TaskActor,
  type TaskInput,
} from "../lib/tasks";

const SERVER_INFO = {
  name: "cfker01",
  version: "0.2.0",
  protocolVersion: "2024-11-05",
};
const SKILL_REPOSITORY = "fengurt/cfker01";
const SKILL_PATH_PREFIX = "skills";
const SERVER_CARD = {
  ...SERVER_INFO,
  capabilities: { tools: {}, resources: {} },
  auth: {
    type: "apiKey",
    header: "X-Api-Key",
    scopes: ["read", "skills:write", "tasks:read", "tasks:write"],
  },
  endpoints: { tools: "/mcp", resources: "/v1/status" },
};

const TOOLS = [
  {
    name: "get_status",
    description: "Get the latest snapshot for one source or all sources.",
    inputSchema: { type: "object", properties: { source: { type: "string" } } },
  },
  {
    name: "get_history",
    description: "Get recent snapshot history for one source.",
    inputSchema: {
      type: "object",
      required: ["source"],
      properties: {
        source: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
  },
  {
    name: "skills.list",
    description:
      "List staged and published agent skills without returning their bodies.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["validated", "publish_requested", "published", "rejected"],
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
  {
    name: "skills.get",
    description: "Get a skill draft by id or the newest version of a slug.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, slug: { type: "string" } },
    },
  },
  {
    name: "skills.stage",
    description:
      "Create a schema-validated SKILL.md draft. Requires skills:write; does not publish to GitHub.",
    inputSchema: {
      type: "object",
      required: ["slug", "content"],
      properties: {
        slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,62}$" },
        title: { type: "string" },
        description: { type: "string" },
        content: { type: "string", maxLength: 65536 },
      },
    },
  },
  {
    name: "skills.request_publish",
    description:
      "Mark a validated draft for the local GitHub publisher. It creates a branch and PR, never pushes main.",
    inputSchema: {
      type: "object",
      required: ["draftId"],
      properties: { draftId: { type: "string" } },
    },
  },
  {
    name: "skills.record_publish",
    description:
      "Record the PR created by the local GitHub publisher. Requires skills:write.",
    inputSchema: {
      type: "object",
      required: ["draftId", "branch", "pullRequestUrl"],
      properties: {
        draftId: { type: "string" },
        branch: { type: "string" },
        pullRequestUrl: { type: "string" },
        commitSha: { type: "string" },
      },
    },
  },
  {
    name: "tasks.list",
    description: "List private operational tasks. Requires tasks:read.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        projectId: { type: "string" },
        ownerId: { type: "string" },
        participantId: { type: "string" },
        q: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
  {
    name: "tasks.get",
    description:
      "Get one private operational task and its dependencies. Requires tasks:read.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "tasks.create",
    description: "Create an operational task. Requires tasks:write.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", maxLength: 240 },
        description: { type: "string", maxLength: 20000 },
        projectId: { type: "string" },
        ownerId: { type: "string" },
        startAt: { type: "string" },
        dueAt: { type: "string" },
        priority: { type: "integer", minimum: 0, maximum: 4 },
        expectedValue: { type: "number", minimum: 0 },
        currency: { type: "string" },
        valueConfidence: { type: "integer", minimum: 0, maximum: 100 },
        strategicValue: { type: "integer", minimum: 1, maximum: 5 },
        deliveryDomain: { type: "string" },
      },
    },
  },
  {
    name: "tasks.update",
    description:
      "Update non-sensitive task fields. Agents cannot complete, cancel, or reassign tasks. Requires tasks:write.",
    inputSchema: {
      type: "object",
      required: ["id", "changes"],
      properties: { id: { type: "string" }, changes: { type: "object" } },
    },
  },
  {
    name: "tasks.comment",
    description: "Add an attributed comment to a task. Requires tasks:write.",
    inputSchema: {
      type: "object",
      required: ["id", "body"],
      properties: {
        id: { type: "string" },
        body: { type: "string", maxLength: 10000 },
      },
    },
  },
  {
    name: "tasks.plan",
    description:
      "Return scheduled tasks and dependency edges for agent planning. Requires tasks:read.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        ownerId: { type: "string" },
        domain: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
      },
    },
  },
];
const RESOURCES = [
  {
    uri: "status://all",
    name: "All sources (latest)",
    mimeType: "application/json",
  },
  {
    uri: "ops://tasks/snapshot",
    name: "Private task planning snapshot",
    mimeType: "application/json",
  },
];
const WRITE_TOOLS = new Set([
  "skills.stage",
  "skills.request_publish",
  "skills.record_publish",
]);
const TASK_READ_TOOLS = new Set(["tasks.list", "tasks.get", "tasks.plan"]);
const TASK_WRITE_TOOLS = new Set([
  "tasks.create",
  "tasks.update",
  "tasks.comment",
]);

interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}
interface SkillDraftRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  content_hash: string;
  status: string;
  validation: string;
  target_repo: string;
  target_path: string;
  branch: string | null;
  github_pr_url: string | null;
  published_commit_sha: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

function makeError(id: McpRequest["id"] | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function makeResult(id: McpRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function textResult(id: McpRequest["id"], data: unknown) {
  return makeResult(id, {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  });
}
function toolArgs(body: McpRequest) {
  return (body.params ?? {}) as {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}
function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function forwardTaskMcp(
  request: Request,
  body: McpRequest,
  env: Env,
): Promise<Response | null> {
  const typed = env as Env & {
    TASK_CORE_URL?: string;
    TASK_CORE_INTERNAL_TOKEN?: string;
  };
  if (!typed.TASK_CORE_URL || !typed.TASK_CORE_INTERNAL_TOKEN) return null;
  const target = new URL("/mcp/task", typed.TASK_CORE_URL);
  const supplied = request.headers.get("X-Api-Key") ?? "legacy-task-mcp";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(supplied),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const actorId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Task-Internal-Token": typed.TASK_CORE_INTERNAL_TOKEN,
      "X-Task-Actor-Type": "agent",
      "X-Task-Actor-Id": actorId,
    },
    body: JSON.stringify(body),
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value),
    digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function skillValidation(
  slug: string,
  title: string,
  description: string,
  content: string,
) {
  const errors: string[] = [],
    frontmatter = content.match(/^---\r?\n([\s\S]{1,8192}?)\r?\n---\r?\n/);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) errors.push("invalid_slug");
  if (title.trim().length < 3 || title.length > 120)
    errors.push("invalid_title");
  if (description.trim().length < 12 || description.length > 500)
    errors.push("invalid_description");
  if (content.length < 80 || content.length > 65_536)
    errors.push("invalid_content_length");
  if (!frontmatter) errors.push("missing_frontmatter");
  else {
    const name = frontmatter[1].match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
    const frontmatterDescription = frontmatter[1]
      .match(/^description:\s*["']?([^\n"']+)/m)?.[1]
      ?.trim();
    if (name !== slug) errors.push("frontmatter_name_must_match_slug");
    if (!frontmatterDescription || frontmatterDescription.length < 12)
      errors.push("missing_frontmatter_description");
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|cfk_[a-f0-9]{32,}|tais_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})\b/.test(
      content,
    )
  )
    errors.push("secret_like_content_rejected");
  return { valid: errors.length === 0, errors, schemaVersion: "skill-v1" };
}
function publicDraft(row: SkillDraftRow, includeContent = false) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    validation: parseJson(row.validation),
    target: {
      repository: row.target_repo,
      path: row.target_path,
      branch: row.branch,
      pullRequestUrl: row.github_pr_url,
      commitSha: row.published_commit_sha,
    },
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    ...(includeContent ? { content: row.content } : {}),
  };
}

export async function handleMcpCard(): Promise<Response> {
  return jsonResponse(SERVER_CARD);
}

export async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method === "GET")
    return jsonResponse({
      hint: "POST JSON-RPC requests here. See /.well-known/mcp.",
    });
  let body: McpRequest;
  try {
    body = (await request.json()) as McpRequest;
  } catch {
    return jsonResponse(makeError(null, -32700, "parse_error"), 400);
  }
  const params = toolArgs(body),
    name = params.name ?? "";
  const taskResource =
    body.method === "resources/read" &&
    body.params?.uri === "ops://tasks/snapshot";
  const scope =
    (body.method === "tools/call" && TASK_READ_TOOLS.has(name)) || taskResource
      ? "tasks:read"
      : body.method === "tools/call" && TASK_WRITE_TOOLS.has(name)
        ? "tasks:write"
        : "read";
  const auth = await requireApiKey(request, env, ctx, scope);
  if (auth) return auth;
  if (body.method === "tools/call" && WRITE_TOOLS.has(name)) {
    const writeAuth = await requireApiKey(request, env, ctx, "skills:write");
    if (writeAuth) return writeAuth;
  }
  if (
    (body.method === "tools/call" &&
      (TASK_READ_TOOLS.has(name) || TASK_WRITE_TOOLS.has(name))) ||
    taskResource
  ) {
    const forwarded = await forwardTaskMcp(request, body, env);
    if (forwarded) return forwarded;
  }

  switch (body.method) {
    case "initialize":
      return jsonResponse(
        makeResult(body.id, {
          ...SERVER_INFO,
          capabilities: SERVER_CARD.capabilities,
        }),
      );
    case "tools/list":
      return jsonResponse(makeResult(body.id, { tools: TOOLS }));
    case "resources/list":
      return jsonResponse(makeResult(body.id, { resources: RESOURCES }));
    case "resources/read":
      return handleResourceRead(body, env);
    case "tools/call":
      return handleToolCall(request, body, env, ctx);
    default:
      return jsonResponse(makeError(body.id, -32601, "unknown_method"), 400);
  }
}

async function handleResourceRead(
  body: McpRequest,
  env: Env,
): Promise<Response> {
  const uri = String(body.params?.uri ?? "");
  if (uri === "status://all") {
    const snapshot: Record<string, unknown> = {};
    for (const source of listSources()) {
      const raw = await env.MGMT_KV.get(`status:latest:${source.id}`);
      snapshot[source.id] = raw ? JSON.parse(raw) : null;
    }
    return jsonResponse(
      makeResult(body.id, {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(snapshot, null, 2),
          },
        ],
      }),
    );
  }
  if (uri === "ops://tasks/snapshot") {
    const rows = await env.MGMT_DB.prepare(
      `SELECT t.*,p.name project_name,m.name milestone_name,o.display_name owner_name,o.kind owner_kind FROM tasks t LEFT JOIN catalog_projects p ON p.id=t.project_id LEFT JOIN task_milestones m ON m.id=t.milestone_id LEFT JOIN task_people o ON o.id=t.owner_id WHERE t.archived_at IS NULL AND t.status NOT IN ('done','cancelled') ORDER BY t.priority,COALESCE(t.due_at,t.created_at) LIMIT 200`,
    ).all<Record<string, unknown>>();
    const tasks = (rows.results ?? []).map(serializeTask),
      taskIds = tasks.map((task) => String(task.id));
    let dependencies: unknown[] = [];
    if (taskIds.length) {
      const result = await env.MGMT_DB.prepare(
        `SELECT task_id,depends_on_task_id,dependency_type FROM task_dependencies WHERE task_id IN (${taskIds.map((_, index) => `?${index + 1}`).join(",")})`,
      )
        .bind(...taskIds)
        .all();
      dependencies = result.results ?? [];
    }
    const snapshot = {
      generatedAt: new Date().toISOString(),
      tasks,
      dependencies,
    };
    return jsonResponse(
      makeResult(body.id, {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(snapshot, null, 2),
          },
        ],
      }),
    );
  }
  return jsonResponse(makeError(body.id, -32602, "resource_not_found"), 404);
}

async function handleToolCall(
  request: Request,
  body: McpRequest,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const params = toolArgs(body),
    name = params.name,
    args = params.arguments ?? {};
  if (name === "get_status") {
    const source = typeof args.source === "string" ? args.source : null;
    if (source) {
      const raw = await env.MGMT_KV.get(`status:latest:${source}`);
      return jsonResponse(
        makeResult(body.id, {
          content: [
            {
              type: "text",
              text: raw ?? JSON.stringify({ error: "no_snapshot", source }),
            },
          ],
        }),
      );
    }
    const out: Record<string, unknown> = {};
    for (const src of listSources()) {
      const raw = await env.MGMT_KV.get(`status:latest:${src.id}`);
      out[src.id] = raw ? JSON.parse(raw) : null;
    }
    return jsonResponse(textResult(body.id, out));
  }
  if (name === "get_history") {
    const source = typeof args.source === "string" ? args.source : "",
      limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
    if (!source)
      return jsonResponse(makeError(body.id, -32602, "source_required"), 400);
    const rows = await env.MGMT_DB.prepare(
      "SELECT id,fetched_at,ok,duration_ms,payload,error FROM snapshots WHERE source_id=?1 ORDER BY id DESC LIMIT ?2",
    )
      .bind(source, limit)
      .all();
    return jsonResponse(textResult(body.id, rows.results ?? []));
  }
  if (name === "skills.list") return listSkills(body.id, env, args);
  if (name === "skills.get") return getSkill(body.id, env, args);
  if (name === "skills.stage") return stageSkill(body, env, ctx, args);
  if (name === "skills.request_publish")
    return requestPublish(body.id, env, args);
  if (name === "skills.record_publish")
    return recordPublish(body.id, env, args);
  if (name === "tasks.list") return listTasks(body.id, env, args);
  if (name === "tasks.get") return getTaskTool(body.id, env, args);
  if (name === "tasks.create")
    return createTaskTool(request, body.id, env, args);
  if (name === "tasks.update")
    return updateTaskTool(request, body.id, env, args);
  if (name === "tasks.comment")
    return commentTaskTool(request, body.id, env, args);
  if (name === "tasks.plan") return planTasks(body.id, env, args);
  return jsonResponse(makeError(body.id, -32601, `unknown_tool: ${name}`), 400);
}

async function mcpActor(request: Request, env: Env): Promise<TaskActor> {
  const raw = request.headers.get("X-Api-Key") ?? "";
  const record = raw ? await lookupKey(env, raw) : null;
  return { type: "agent", id: record?.id ?? "mcp" };
}

async function listTasks(
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 100),
    values: unknown[] = [],
    where = ["t.archived_at IS NULL"];
  for (const [key, column] of [
    ["status", "t.status"],
    ["projectId", "t.project_id"],
    ["ownerId", "t.owner_id"],
  ] as const) {
    if (args[key]) {
      values.push(String(args[key]));
      where.push(`${column}=?${values.length}`);
    }
  }
  if (args.participantId) {
    values.push(String(args.participantId));
    where.push(
      `EXISTS (SELECT 1 FROM task_participants tf WHERE tf.task_id=t.id AND tf.person_id=?${values.length})`,
    );
  }
  if (args.q) {
    values.push(`%${String(args.q).trim()}%`);
    where.push(
      `(t.title LIKE ?${values.length} OR t.description LIKE ?${values.length} OR t.identifier LIKE ?${values.length})`,
    );
  }
  const rows = await env.MGMT_DB.prepare(
    `SELECT t.*,p.name project_name,m.name milestone_name,o.display_name owner_name,o.kind owner_kind,(SELECT COUNT(*) FROM task_dependencies d WHERE d.task_id=t.id) dependency_count FROM tasks t LEFT JOIN catalog_projects p ON p.id=t.project_id LEFT JOIN task_milestones m ON m.id=t.milestone_id LEFT JOIN task_people o ON o.id=t.owner_id WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC LIMIT ?${values.length + 1}`,
  )
    .bind(...values, limit)
    .all<Record<string, unknown>>();
  return jsonResponse(
    textResult(id, { tasks: (rows.results ?? []).map(serializeTask), limit }),
  );
}

async function getTaskTool(
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  const task = await getTask(env, String(args.id ?? ""));
  if (!task) return jsonResponse(makeError(id, -32602, "task_not_found"), 404);
  const dependencies = await env.MGMT_DB.prepare(
    `SELECT d.dependency_type,t.id,t.identifier,t.title,t.status,t.due_at FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_task_id WHERE d.task_id=?1`,
  )
    .bind(task.id)
    .all();
  return jsonResponse(
    textResult(id, { ...task, dependencies: dependencies.results ?? [] }),
  );
}

async function createTaskTool(
  request: Request,
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  try {
    const actor = await mcpActor(request, env);
    const task = await createTask(env, args as TaskInput, actor);
    return jsonResponse(textResult(id, task));
  } catch (cause) {
    return taskToolError(id, cause);
  }
}

async function updateTaskTool(
  request: Request,
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  try {
    const actor = await mcpActor(request, env),
      changes =
        args.changes &&
        typeof args.changes === "object" &&
        !Array.isArray(args.changes)
          ? (args.changes as TaskInput)
          : {};
    const task = await updateTask(
      env,
      String(args.id ?? ""),
      changes,
      actor,
      true,
    );
    return jsonResponse(textResult(id, task));
  } catch (cause) {
    return taskToolError(id, cause);
  }
}

async function commentTaskTool(
  request: Request,
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  try {
    const actor = await mcpActor(request, env),
      comment = await addTaskComment(
        env,
        String(args.id ?? ""),
        args.body,
        actor,
      );
    return jsonResponse(textResult(id, comment));
  } catch (cause) {
    return taskToolError(id, cause);
  }
}

async function planTasks(
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  const limit = Math.min(Math.max(Number(args.limit ?? 100), 1), 200),
    values: unknown[] = [],
    where = ["t.archived_at IS NULL", "t.status NOT IN ('done','cancelled')"];
  for (const [key, column] of [
    ["projectId", "t.project_id"],
    ["ownerId", "t.owner_id"],
    ["domain", "t.delivery_domain"],
  ] as const)
    if (args[key]) {
      values.push(String(args[key]));
      where.push(`${column}=?${values.length}`);
    }
  const rows = await env.MGMT_DB.prepare(
    `SELECT t.*,p.name project_name,m.name milestone_name,o.display_name owner_name,o.kind owner_kind FROM tasks t LEFT JOIN catalog_projects p ON p.id=t.project_id LEFT JOIN task_milestones m ON m.id=t.milestone_id LEFT JOIN task_people o ON o.id=t.owner_id WHERE ${where.join(" AND ")} ORDER BY COALESCE(t.start_at,t.created_at),COALESCE(t.due_at,t.start_at,t.created_at) LIMIT ?${values.length + 1}`,
  )
    .bind(...values, limit)
    .all<Record<string, unknown>>();
  const taskIds = (rows.results ?? []).map((row) => String(row.id));
  let edges: unknown[] = [];
  if (taskIds.length) {
    const result = await env.MGMT_DB.prepare(
      `SELECT task_id,depends_on_task_id,dependency_type FROM task_dependencies WHERE task_id IN (${taskIds.map((_, index) => `?${index + 1}`).join(",")})`,
    )
      .bind(...taskIds)
      .all();
    edges = result.results ?? [];
  }
  return jsonResponse(
    textResult(id, {
      generatedAt: new Date().toISOString(),
      tasks: (rows.results ?? []).map(serializeTask),
      dependencies: edges,
    }),
  );
}

function taskToolError(id: McpRequest["id"], cause: unknown) {
  const typed = cause as Error & { code?: string; status?: number };
  return jsonResponse(
    makeError(id, -32602, typed.code ?? typed.message ?? "task_error"),
    typed.status ?? 400,
  );
}

async function listSkills(
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 100),
    status = typeof args.status === "string" ? args.status : null;
  const query = status
    ? env.MGMT_DB.prepare(
        "SELECT * FROM mcp_skill_drafts WHERE status=?1 ORDER BY updated_at DESC LIMIT ?2",
      ).bind(status, limit)
    : env.MGMT_DB.prepare(
        "SELECT * FROM mcp_skill_drafts ORDER BY updated_at DESC LIMIT ?1",
      ).bind(limit);
  const rows = await query.all<SkillDraftRow>();
  return jsonResponse(
    textResult(id, {
      skills: (rows.results ?? []).map((row) => publicDraft(row)),
    }),
  );
}
async function getSkill(
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  const row =
    typeof args.id === "string"
      ? await env.MGMT_DB.prepare("SELECT * FROM mcp_skill_drafts WHERE id=?1")
          .bind(args.id)
          .first<SkillDraftRow>()
      : typeof args.slug === "string"
        ? await env.MGMT_DB.prepare(
            "SELECT * FROM mcp_skill_drafts WHERE slug=?1 ORDER BY updated_at DESC LIMIT 1",
          )
            .bind(args.slug)
            .first<SkillDraftRow>()
        : null;
  if (!row) return jsonResponse(makeError(id, -32602, "skill_not_found"), 404);
  return jsonResponse(textResult(id, publicDraft(row, true)));
}
async function stageSkill(
  body: McpRequest,
  env: Env,
  ctx: ExecutionContext,
  args: Record<string, unknown>,
) {
  const slug = String(args.slug ?? "").trim(),
    content = String(args.content ?? ""),
    frontmatter = content.match(/^---\r?\n([\s\S]{1,8192}?)\r?\n---\r?\n/),
    title = String(
      args.title ?? frontmatter?.[1].match(/^name:\s*([^\n]+)/m)?.[1] ?? slug,
    ).trim(),
    description = String(
      args.description ??
        frontmatter?.[1].match(/^description:\s*["']?([^\n"']+)/m)?.[1] ??
        "",
    ).trim(),
    validation = skillValidation(slug, title, description, content),
    now = new Date().toISOString();
  const row: SkillDraftRow = {
    id: crypto.randomUUID(),
    slug,
    title,
    description,
    content,
    content_hash: await sha256(content),
    status: validation.valid ? "validated" : "rejected",
    validation: JSON.stringify(validation),
    target_repo: SKILL_REPOSITORY,
    target_path: `${SKILL_PATH_PREFIX}/${slug}/SKILL.md`,
    branch: null,
    github_pr_url: null,
    published_commit_sha: null,
    created_at: now,
    updated_at: now,
    published_at: null,
  };
  await env.MGMT_DB.prepare(
    "INSERT INTO mcp_skill_drafts(id,slug,title,description,content,content_hash,status,validation,target_repo,target_path,created_by_key_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,?11,?11)",
  )
    .bind(
      row.id,
      row.slug,
      row.title,
      row.description,
      row.content,
      row.content_hash,
      row.status,
      row.validation,
      row.target_repo,
      row.target_path,
      now,
    )
    .run();
  ctx.waitUntil(
    env.MGMT_DB.prepare(
      "INSERT INTO audit_events(event_type,payload,created_at) VALUES(?1,?2,?3)",
    )
      .bind(
        "mcp.skill_staged",
        JSON.stringify({
          draftId: row.id,
          slug,
          status: row.status,
          contentHash: row.content_hash,
          validation,
        }),
        now,
      )
      .run(),
  );
  return jsonResponse(textResult(body.id, publicDraft(row, true)));
}
async function requestPublish(
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  const draftId = String(args.draftId ?? ""),
    row = await env.MGMT_DB.prepare(
      "SELECT * FROM mcp_skill_drafts WHERE id=?1",
    )
      .bind(draftId)
      .first<SkillDraftRow>();
  if (!row) return jsonResponse(makeError(id, -32602, "skill_not_found"), 404);
  if (row.status !== "validated" && row.status !== "publish_requested")
    return jsonResponse(makeError(id, -32602, "skill_must_be_validated"), 400);
  const now = new Date().toISOString();
  await env.MGMT_DB.prepare(
    "UPDATE mcp_skill_drafts SET status='publish_requested',updated_at=?1 WHERE id=?2",
  )
    .bind(now, row.id)
    .run();
  return jsonResponse(
    textResult(id, {
      ...publicDraft({ ...row, status: "publish_requested", updated_at: now }),
      publisher: {
        command: `npm run skills:publish -- ${row.id}`,
        repository: SKILL_REPOSITORY,
        policy: "Creates a branch and pull request; never pushes main.",
      },
    }),
  );
}
async function recordPublish(
  id: McpRequest["id"],
  env: Env,
  args: Record<string, unknown>,
) {
  const draftId = String(args.draftId ?? ""),
    branch = String(args.branch ?? ""),
    pullRequestUrl = String(args.pullRequestUrl ?? ""),
    commitSha = typeof args.commitSha === "string" ? args.commitSha : null;
  if (
    !branch.startsWith("mcp/skill-") ||
    !new RegExp(`^https://github\\.com/${SKILL_REPOSITORY}/pull/\\d+$`).test(
      pullRequestUrl,
    )
  )
    return jsonResponse(makeError(id, -32602, "invalid_publish_target"), 400);
  const row = await env.MGMT_DB.prepare(
    "SELECT * FROM mcp_skill_drafts WHERE id=?1",
  )
    .bind(draftId)
    .first<SkillDraftRow>();
  if (!row) return jsonResponse(makeError(id, -32602, "skill_not_found"), 404);
  const now = new Date().toISOString();
  await env.MGMT_DB.prepare(
    "UPDATE mcp_skill_drafts SET status='published',branch=?1,github_pr_url=?2,published_commit_sha=?3,published_at=?4,updated_at=?4 WHERE id=?5",
  )
    .bind(branch, pullRequestUrl, commitSha, now, row.id)
    .run();
  return jsonResponse(
    textResult(
      id,
      publicDraft({
        ...row,
        status: "published",
        branch,
        github_pr_url: pullRequestUrl,
        published_commit_sha: commitSha,
        published_at: now,
        updated_at: now,
      }),
    ),
  );
}
