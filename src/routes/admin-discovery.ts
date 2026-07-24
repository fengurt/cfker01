import { isValidRequestOrigin, requireAdminToken } from "../lib/auth";
import { createScanJob } from "../lib/scan-jobs";

export async function handleAdminDiscovery(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await requireAdminToken(request, env);
  if (auth) return auth;
  if (!["GET", "HEAD"].includes(request.method) && request.headers.has("Cookie") && !isValidRequestOrigin(request)) return json({ error: "invalid_origin" }, 403);
  const url = new URL(request.url), parts = url.pathname.split("/").filter(Boolean), id = parts[2];
  if (request.method === "GET") {
    if (id) {
      const job = await env.MGMT_DB.prepare(`SELECT j.*,r.status run_status,r.discovered_count,r.new_count,r.changed_count,r.unchanged_count,r.stale_count FROM scan_jobs j LEFT JOIN asset_discovery_runs r ON r.id=j.run_id WHERE j.id=?1`).bind(id).first();
      if (job) return json({ data: job });
      const run = await env.MGMT_DB.prepare(`SELECT * FROM asset_discovery_runs WHERE id=?1`).bind(id).first();
      return run ? json({ data: run }) : json({ error: "not_found" }, 404);
    }
    const rows = await env.MGMT_DB.prepare(`SELECT r.*,j.status job_status,j.connector_id FROM asset_discovery_runs r LEFT JOIN scan_jobs j ON j.id=r.job_id ORDER BY r.started_at DESC LIMIT 100`).all();
    return json({ data: rows.results ?? [] });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await request.json().catch(() => ({})) as any;
  const providers: string[] = Array.isArray(body.providers) ? body.providers.map(String) : body.provider && body.provider !== "all" ? [String(body.provider)] : [];
  const account = body.accountId ? String(body.accountId) : null;
  const values: unknown[] = [];
  const where = ["enabled=1"];
  if (providers.length) { values.push(...providers); where.push(`provider IN (${providers.map((_, index) => `?${index + 1}`).join(",")})`); }
  if (account) { values.push(account); where.push(`(account_id='*' OR account_id=?${values.length})`); }
  const connectors = await env.MGMT_DB.prepare(`SELECT id FROM source_connectors WHERE ${where.join(" AND ")}`).bind(...values).all<{ id: string }>();
  const jobs = [];
  for (const connector of connectors.results ?? []) jobs.push(await createScanJob(env, connector.id, body.mode === "full" ? "full" : "incremental", "legacy_admin", 100));
  const now = new Date().toISOString();
  ctx.waitUntil(env.MGMT_DB.prepare(`INSERT INTO audit_events(event_type,payload,created_at) VALUES('asset.discovery_requested',?1,?2)`).bind(JSON.stringify({ jobs, providers }), now).run());
  return json({ ok: true, ids: jobs.map((job) => job.id), jobs, status: "queued", deprecated: { use: "/api/admin/v1/scans" } }, 202);
}

function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
