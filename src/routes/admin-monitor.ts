import { isValidRequestOrigin, requireAdminToken } from "../lib/auth";
import { ensurePeriodicResourceSnapshot } from "../lib/resource-snapshot";

type MonitorResult = {
  entityType: "server" | "deployment";
  entityId: string;
  status: "healthy" | "reachable" | "degraded" | "down";
  checkedAt?: string;
  latencyMs?: number | null;
  httpStatus?: number | null;
  errorCode?: string | null;
};

export async function handleAdminMonitor(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.split("/").filter(Boolean)[2] ?? "summary";
  const internal = isInternalMonitor(request, env);
  if (!internal) {
    const auth = await requireAdminToken(request, env);
    if (auth) return auth;
    if (!["GET", "HEAD"].includes(request.method) && request.headers.has("Cookie") && !isValidRequestOrigin(request)) {
      return json({ error: "invalid_origin" }, 403);
    }
  }

  if (action === "targets" && request.method === "GET") return targets(env);
  if (action === "results" && request.method === "POST") {
    if (!internal) return json({ error: "monitor_token_required" }, 403);
    return storeResults(request, env, ctx);
  }
  if (action === "snapshot" && request.method === "POST") {
    if (!internal) return json({ error: "monitor_token_required" }, 403);
    await ensurePeriodicResourceSnapshot(env);
    return json({ ok: true });
  }
  if (action === "events" && request.method === "GET") return events(env, url);
  if ((action === "summary" || !action) && request.method === "GET") return summary(env);
  if (action === "run" && request.method === "POST") return requestRun(env, ctx);
  return json({ error: "method_not_allowed" }, 405);
}

async function targets(env: Env) {
  const [servers, deployments, requested] = await Promise.all([
    env.MGMT_DB.prepare(`SELECT id,name,COALESCE(health_url,public_url) url FROM servers WHERE COALESCE(health_url,public_url) IS NOT NULL AND COALESCE(manual_status,'')!='disabled'`).all<Record<string, unknown>>(),
    env.MGMT_DB.prepare(`SELECT d.id,p.name,d.deployed_url url FROM deployments d JOIN catalog_projects p ON p.id=d.project_id WHERE d.deployed_url IS NOT NULL AND d.status!='disabled'`).all<Record<string, unknown>>(),
    env.MGMT_DB.prepare(`SELECT id FROM monitor_runs WHERE status='requested' ORDER BY started_at LIMIT 1`).first<{ id: string }>(),
  ]);
  return json({
    data: [
      ...(servers.results ?? []).map((item) => ({ entityType: "server", entityId: item.id, name: item.name, url: item.url })),
      ...(deployments.results ?? []).map((item) => ({ entityType: "deployment", entityId: item.id, name: item.name, url: item.url })),
    ],
    requestedRunId: requested?.id ?? null,
  });
}

async function storeResults(request: Request, env: Env, ctx: ExecutionContext) {
  const body = await request.json().catch(() => null) as { runId?: string; startedAt?: string; durationMs?: number; results?: MonitorResult[] } | null;
  if (!body || !Array.isArray(body.results) || body.results.length > 500) return json({ error: "invalid_monitor_results" }, 400);
  const now = new Date().toISOString();
  const runId = String(body.runId || crypto.randomUUID());
  let healthy = 0, degraded = 0, down = 0;
  for (const result of body.results) {
    if (!result || !["server", "deployment"].includes(result.entityType) || !result.entityId || !["healthy", "reachable", "degraded", "down"].includes(result.status)) continue;
    const state = await updateEntity(env, result, now);
    if (state === "healthy" || state === "reachable") healthy += 1;
    else if (state === "down") down += 1;
    else degraded += 1;
  }
  await env.MGMT_DB.prepare(`INSERT INTO monitor_runs(id,status,target_count,healthy_count,degraded_count,down_count,duration_ms,started_at,completed_at,created_at) VALUES(?1,'complete',?2,?3,?4,?5,?6,?7,?8,?7) ON CONFLICT(id) DO UPDATE SET status='complete',target_count=excluded.target_count,healthy_count=excluded.healthy_count,degraded_count=excluded.degraded_count,down_count=excluded.down_count,duration_ms=excluded.duration_ms,completed_at=excluded.completed_at`).bind(runId, body.results.length, healthy, degraded, down, Number(body.durationMs ?? 0), String(body.startedAt || now), now).run();
  ctx.waitUntil(env.MGMT_DB.prepare(`DELETE FROM monitor_runs WHERE started_at < datetime('now','-90 days')`).run());
  return json({ ok: true, runId, healthy, degraded, down });
}

async function updateEntity(env: Env, result: MonitorResult, fallbackTime: string) {
  const table = result.entityType === "server" ? "servers" : "deployments";
  const checkedAt = result.checkedAt || fallbackTime;
  const current = await env.MGMT_DB.prepare(`SELECT health_status,consecutive_failures,consecutive_successes FROM ${table} WHERE id=?1`).bind(result.entityId).first<{ health_status: string | null; consecutive_failures: number; consecutive_successes: number }>();
  if (!current) return "missing";
  const success = result.status === "healthy" || result.status === "reachable";
  const failures = success ? 0 : Number(current.consecutive_failures || 0) + 1;
  const successes = success ? Number(current.consecutive_successes || 0) + 1 : 0;
  let state: string = result.status;
  if (!success && failures < 3) state = "degraded";
  if (success && current.health_status === "down" && successes < 2) state = "recovering";
  const lastHealthy = success ? checkedAt : null;
  await env.MGMT_DB.prepare(`UPDATE ${table} SET health_status=?1,consecutive_failures=?2,consecutive_successes=?3,last_checked_at=?4,last_latency_ms=?5,last_error=?6,last_healthy_at=COALESCE(?7,last_healthy_at),updated_at=?4 WHERE id=?8`).bind(state, failures, successes, checkedAt, result.latencyMs ?? null, result.errorCode ?? null, lastHealthy, result.entityId).run();
  if (state === "down" && current.health_status !== "down") {
    await env.MGMT_DB.prepare(`INSERT INTO availability_events(id,entity_type,entity_id,status,previous_status,error_code,http_status,latency_ms,started_at,created_at,updated_at) VALUES(?1,?2,?3,'down',?4,?5,?6,?7,?8,?8,?8)`).bind(crypto.randomUUID(), result.entityType, result.entityId, current.health_status, result.errorCode ?? null, result.httpStatus ?? null, result.latencyMs ?? null, checkedAt).run();
  }
  if ((state === "healthy" || state === "reachable") && current.health_status === "down") {
    await env.MGMT_DB.prepare(`UPDATE availability_events SET resolved_at=?1,updated_at=?1 WHERE entity_type=?2 AND entity_id=?3 AND resolved_at IS NULL`).bind(checkedAt, result.entityType, result.entityId).run();
  }
  return state;
}

async function summary(env: Env) {
  const [servers, deployments, openEvents, run] = await Promise.all([
    env.MGMT_DB.prepare(`SELECT COALESCE(health_status,'unverified') status,COUNT(*) count FROM servers GROUP BY COALESCE(health_status,'unverified')`).all(),
    env.MGMT_DB.prepare(`SELECT COALESCE(health_status,'unverified') status,COUNT(*) count FROM deployments GROUP BY COALESCE(health_status,'unverified')`).all(),
    env.MGMT_DB.prepare(`SELECT COUNT(*) count FROM availability_events WHERE resolved_at IS NULL`).first<{ count: number }>(),
    env.MGMT_DB.prepare(`SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT 1`).first(),
  ]);
  return json({ data: { servers: servers.results ?? [], deployments: deployments.results ?? [], openEvents: Number(openEvents?.count ?? 0), latestRun: run ?? null } });
}

async function events(env: Env, url: URL) {
  const open = url.searchParams.get("open");
  const where = open === "true" ? "WHERE e.resolved_at IS NULL" : "";
  const rows = await env.MGMT_DB.prepare(`SELECT e.*,COALESCE(s.name,p.name,e.entity_id) entity_name FROM availability_events e LEFT JOIN servers s ON e.entity_type='server' AND s.id=e.entity_id LEFT JOIN deployments d ON e.entity_type='deployment' AND d.id=e.entity_id LEFT JOIN catalog_projects p ON p.id=d.project_id ${where} ORDER BY e.created_at DESC LIMIT 100`).all();
  return json({ data: rows.results ?? [] });
}

async function requestRun(env: Env, ctx: ExecutionContext) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.MGMT_DB.prepare(`INSERT INTO monitor_runs(id,status,started_at,created_at) VALUES(?1,'requested',?2,?2)`).bind(id, now).run();
  ctx.waitUntil(env.MGMT_DB.prepare(`INSERT INTO audit_events(event_type,payload,created_at) VALUES('monitor.requested',?1,?2)`).bind(JSON.stringify({ id }), now).run());
  return json({ ok: true, id, status: "requested" }, 202);
}

function isInternalMonitor(request: Request, env: Env) {
  if (!env.INTERNAL_MONITOR_TOKEN) return false;
  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${env.INTERNAL_MONITOR_TOKEN}`;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
