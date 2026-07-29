import { processBenchmarkJobs } from "./benchmark-discovery";

export async function runResourceOperations(env: Env) {
  const [servers, backups, jobs, assets] = await Promise.all([
    checkServers(env),
    verifyBackups(env),
    processBenchmarkJobs(env, 2),
    maintainAssetDiscovery(env),
  ]);
  return { servers, backups, jobs, assets };
}

async function maintainAssetDiscovery(env:Env){
  const now=new Date(),iso=now.toISOString();
  const stale=await env.MGMT_DB.prepare(`UPDATE discovered_assets SET status='stale',updated_at=?1 WHERE stale_after IS NOT NULL AND stale_after<?1 AND status!='stale'`).bind(iso).run();
  const requests:Array<{provider:string;mode:string}>=[];
  for(const [provider,interval] of [["docker",15*60_000],["tencent",24*60*60_000],["github",24*60*60_000],["local",24*60*60_000],["cloudflare",24*60*60_000],["godaddy",24*60*60_000],["ens",24*60*60_000],["solana",24*60*60_000]] as const){const latest=await env.MGMT_DB.prepare(`SELECT started_at,status FROM asset_discovery_runs WHERE provider=?1 ORDER BY started_at DESC LIMIT 1`).bind(provider).first<{started_at:string;status:string}>();if(!latest||Date.parse(latest.started_at)<now.getTime()-interval){const id=crypto.randomUUID();await env.MGMT_DB.prepare(`INSERT INTO asset_discovery_runs(id,provider,account_id,mode,status,started_at,created_at) VALUES(?1,?2,'default','incremental','awaiting_cli',?3,?3)`).bind(id,provider,iso).run();requests.push({provider,mode:"incremental"});}}
  return{stale:Number(stale.meta?.changes??0),requests};
}

async function checkServers(env: Env) {
  const rows = await env.MGMT_DB.prepare(
    `SELECT id, health_url, due_at, manual_status FROM servers`,
  ).all<{
    id: string;
    health_url: string | null;
    due_at: string | null;
    manual_status: string | null;
  }>();
  const results: Array<{ id: string; status: string }> = [];
  for (const server of rows.results ?? []) {
    const now = new Date();
    let status: string = server.manual_status ?? "unknown";
    let latency: number | null = null;
    let error: string | null = null;
    if (!server.manual_status && server.due_at && Date.parse(server.due_at) < now.getTime()) {
      status = "expired";
    }
    if (!server.manual_status && server.health_url) {
      const started = Date.now();
      try {
        const response = await fetch(server.health_url, {
          method: "GET",
          signal: AbortSignal.timeout(8000),
          redirect: "follow",
        });
        latency = Date.now() - started;
        status = response.ok ? "healthy" : "degraded";
        if (!response.ok) error = `http_${response.status}`;
      } catch (cause) {
        status = "offline";
        error = cause instanceof Error ? cause.message : "fetch_failed";
      }
    }
    await env.MGMT_DB.prepare(
      `UPDATE servers SET status=?1,last_checked_at=?2,last_latency_ms=?3,last_error=?4,updated_at=?2 WHERE id=?5`,
    )
      .bind(status, now.toISOString(), latency, error, server.id)
      .run();
    results.push({ id: server.id, status });
  }
  return results;
}

async function verifyBackups(env: Env) {
  const rows = await env.MGMT_DB.prepare(
    `SELECT id, repository_url FROM backup_repositories`,
  ).all<{ id: string; repository_url: string }>();
  const results: Array<{ id: string; status: string }> = [];
  for (const backup of rows.results ?? []) {
    let status = "unknown";
    let error: string | null = null;
    try {
      const response = await fetch(backup.repository_url, {
        method: "HEAD",
        headers: { "User-Agent": "TableAI-Catalog" },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      status = response.ok ? "reachable" : "unreachable";
      if (!response.ok) error = `http_${response.status}`;
    } catch (cause) {
      status = "unreachable";
      error = cause instanceof Error ? cause.message : "fetch_failed";
    }
    const now = new Date().toISOString();
    await env.MGMT_DB.prepare(
      `UPDATE backup_repositories SET status=?1,last_verified_at=?2,last_error=?3,updated_at=?2 WHERE id=?4`,
    )
      .bind(status, now, error, backup.id)
      .run();
    results.push({ id: backup.id, status });
  }
  return results;
}
