import {
  isValidRequestOrigin,
  readAdminSession,
  requireAdminToken,
} from "../lib/auth";

type TaskCoreEnv = Env & {
  TASK_CORE_URL?: string;
  TASK_CORE_INTERNAL_TOKEN?: string;
  PUBLIC_ORIGIN?: string;
};

export function taskCoreConfigured(env: Env): boolean {
  const typed = env as TaskCoreEnv;
  return Boolean(typed.TASK_CORE_URL && typed.TASK_CORE_INTERNAL_TOKEN);
}

function upstreamUrl(request: Request, env: TaskCoreEnv, path?: string): URL {
  const incoming = new URL(request.url);
  const target = new URL(
    path ?? `${incoming.pathname}${incoming.search}`,
    env.TASK_CORE_URL,
  );
  if (path && incoming.search && !target.search)
    target.search = incoming.search;
  return target;
}

async function forward(
  request: Request,
  env: TaskCoreEnv,
  path?: string,
  trusted = false,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("Host");
  if (trusted) {
    const session = await readAdminSession(request, env);
    headers.delete("Cookie");
    headers.delete("Origin");
    headers.set("X-Task-Internal-Token", env.TASK_CORE_INTERNAL_TOKEN ?? "");
    headers.set("X-Task-Actor-Type", session ? "user" : "system");
    if (session?.userId) headers.set("X-Task-Actor-Id", session.userId);
  }
  return fetch(upstreamUrl(request, env, path), {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
}

export async function proxyTaskApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const typed = env as TaskCoreEnv;
  if (!taskCoreConfigured(env))
    return Response.json(
      {
        error: {
          code: "task_core_unconfigured",
          message: "Task collaboration core is not configured.",
        },
      },
      { status: 503 },
    );
  const session = await readAdminSession(request, env);
  if (session) {
    if (
      !["GET", "HEAD"].includes(request.method) &&
      request.headers.has("Cookie") &&
      !isValidRequestOrigin(request, typed.PUBLIC_ORIGIN)
    )
      return Response.json(
        {
          error: {
            code: "invalid_origin",
            message: "The request origin is not allowed.",
          },
        },
        { status: 403 },
      );
    return forward(request, typed, undefined, true);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer tsk_")) return forward(request, typed);
  const adminAuth = await requireAdminToken(request, env);
  if (adminAuth) return adminAuth;
  return forward(request, typed, undefined, true);
}

function legacyPath(request: Request): string {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path === "/api/admin/v1/task-context") path = "/api/task/v1/context";
  else if (path.startsWith("/api/admin/v1/task-people"))
    path = path.replace("/api/admin/v1/task-people", "/api/task/v1/people");
  else if (path.startsWith("/api/admin/v1/task-milestones"))
    path = path.replace(
      "/api/admin/v1/task-milestones",
      "/api/task/v1/milestones",
    );
  else if (path.startsWith("/api/admin/v1/task-views"))
    path = path.replace("/api/admin/v1/task-views", "/api/task/v1/views");
  else path = path.replace("/api/admin/v1/tasks", "/api/task/v1/tasks");
  const params = new URLSearchParams(url.search);
  for (const [legacy, current] of [
    ["project", "projectId"],
    ["owner", "ownerId"],
  ] as const)
    if (params.has(legacy)) {
      params.set(current, params.get(legacy) ?? "");
      params.delete(legacy);
    }
  return `${path}${params.size ? `?${params}` : ""}`;
}

export async function proxyLegacyAdminTasks(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!taskCoreConfigured(env)) return null;
  const auth = await requireAdminToken(request, env);
  if (auth) return auth;
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.has("Cookie") &&
    !isValidRequestOrigin(request, (env as TaskCoreEnv).PUBLIC_ORIGIN)
  )
    return Response.json(
      {
        error: {
          code: "invalid_origin",
          message: "The request origin is not allowed.",
        },
      },
      { status: 403 },
    );
  return forward(request, env as TaskCoreEnv, legacyPath(request), true);
}
