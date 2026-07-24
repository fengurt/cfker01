import { readAdminSession, requireAdminToken } from "../lib/auth";
import { processBenchmarkJobs } from "../lib/benchmark-discovery";

export async function handleAdminBenchmarks(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  const auth = await requireAdminToken(request, env);
  if (auth) return auth;
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const candidateId = parts[1] === "benchmarks" ? parts[2] : undefined;

  if (url.pathname === "/admin/benchmarks/run" && request.method === "POST") {
    const results = await processBenchmarkJobs(env, 2);
    return Response.json({ ok: true, results });
  }
  if (candidateId && request.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    const status = String(body.status ?? "");
    if (!["approved", "rejected", "pending"].includes(status)) {
      return Response.json({ error: "invalid_status" }, { status: 400 });
    }
    const session = await readAdminSession(request, env);
    const now = new Date().toISOString();
    await env.MGMT_DB.prepare(
      `UPDATE benchmark_candidates SET status=?1,reviewed_by=?2,reviewed_at=?3,updated_at=?3 WHERE id=?4`,
    )
      .bind(status, session?.userId ?? "system", now, candidateId)
      .run();
    return Response.json({ ok: true, id: candidateId, status });
  }
  if (request.method === "GET") {
    const status = url.searchParams.get("status") ?? "pending";
    const rows = await env.MGMT_DB.prepare(
      `SELECT c.*,j.query FROM benchmark_candidates c JOIN benchmark_discovery_jobs j ON j.id=c.job_id WHERE c.status=?1 ORDER BY c.confidence DESC,c.created_at DESC LIMIT 100`,
    )
      .bind(status)
      .all();
    return Response.json({ data: rows.results ?? [] });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const query = String(body.query ?? "").trim();
  if (!query) return Response.json({ error: "query_required" }, { status: 400 });
  const providers = Array.isArray(body.providers)
    ? body.providers.map(String)
    : ["semantic_scholar", "arxiv", "github", "perplexity", "x", "minimax"];
  const session = await readAdminSession(request, env);
  const jobId = crypto.randomUUID();
  await env.MGMT_DB.prepare(
    `INSERT INTO benchmark_discovery_jobs(id,project_id,query,providers,status,requested_by,created_at) VALUES(?1,?2,?3,?4,'queued',?5,?6)`,
  )
    .bind(
      jobId,
      body.projectId ?? null,
      query,
      JSON.stringify(providers),
      session?.userId ?? "system",
      new Date().toISOString(),
    )
    .run();
  ctx.waitUntil(processBenchmarkJobs(env, 1));
  return Response.json({ ok: true, id: jobId, status: "queued" }, { status: 202 });
}
