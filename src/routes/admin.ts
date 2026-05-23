import { jsonResponse } from "../lib/response";
import { requireAdminToken } from "../lib/auth";

export async function handleAdmin(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authError = requireAdminToken(request, env);
  if (authError) {
    return authError;
  }

  const url = new URL(request.url);

  if (url.pathname === "/admin/heartbeat" && request.method === "GET") {
    const raw = await env.MGMT_KV.get(`heartbeat:${env.ENVIRONMENT}`);
    return jsonResponse({ heartbeat: raw ? JSON.parse(raw) : null });
  }

  if (url.pathname === "/admin/audit" && request.method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);
    const result = await env.MGMT_DB.prepare(
      "SELECT id, event_type, payload, created_at FROM audit_events ORDER BY id DESC LIMIT ?1",
    )
      .bind(limit)
      .all<{ id: number; event_type: string; payload: string; created_at: string }>();

    return jsonResponse({ events: result.results ?? [] });
  }

  if (url.pathname === "/admin/audit" && request.method === "POST") {
    const body = (await request.json()) as { eventType?: string; payload?: unknown };
    if (!body.eventType) {
      return jsonResponse({ error: "eventType required" }, 400);
    }

    const createdAt = new Date().toISOString();
    const insert = env.MGMT_DB.prepare(
      "INSERT INTO audit_events (event_type, payload, created_at) VALUES (?1, ?2, ?3)",
    ).bind(body.eventType, JSON.stringify(body.payload ?? {}), createdAt);

    ctx.waitUntil(insert.run());

    return jsonResponse({ ok: true, createdAt }, 202);
  }

  return jsonResponse({ error: "not_found" }, 404);
}
