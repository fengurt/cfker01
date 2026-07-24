import { authenticateScanner, scannerCanUse, type ScannerPrincipal } from "../lib/scanner-auth";
import { ensureDueScanJobs } from "../lib/scan-jobs";

const SCHEMA_VERSION = "asset-discovery-v1";
const MAX_BATCH_ASSETS = 200;
const MAX_BATCH_BYTES = 1_000_000;
const LEASE_MS = 45 * 60 * 1000;

export async function handleIngestApiV1(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).slice(3);
  const [resource, id, action, batchIndex] = parts;
  try {
    if (resource === "jobs" && !id && request.method === "GET") {
      const auth = await authenticateScanner(request, env, ctx, "jobs:poll");
      if (auth.response) return auth.response;
      return listJobs(request, env, auth.principal!);
    }
    if (resource === "jobs" && id && action === "claim" && request.method === "POST") {
      const auth = await authenticateScanner(request, env, ctx, "jobs:claim");
      if (auth.response) return auth.response;
      return claimJob(request, env, id, auth.principal!);
    }
    if (resource === "runs" && !id && request.method === "POST") {
      const auth = await authenticateScanner(request, env, ctx, "ingest:write");
      if (auth.response) return auth.response;
      return createRun(request, env, auth.principal!);
    }
    if (resource === "runs" && id && action === "batches" && batchIndex !== undefined && request.method === "PUT") {
      const auth = await authenticateScanner(request, env, ctx, "ingest:write");
      if (auth.response) return auth.response;
      return ingestBatch(request, env, id, batchIndex, auth.principal!);
    }
    if (resource === "runs" && id && action === "complete" && request.method === "POST") {
      const auth = await authenticateScanner(request, env, ctx, "ingest:write");
      if (auth.response) return auth.response;
      return completeRun(request, env, ctx, id, auth.principal!);
    }
    if (resource === "runs" && id && action === "fail" && request.method === "POST") {
      const auth = await authenticateScanner(request, env, ctx, "ingest:write");
      if (auth.response) return auth.response;
      return failRun(request, env, id, auth.principal!);
    }
    return ingestError(request, "not_found", "Scanner API endpoint not found.", 404);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown_error";
    console.error(JSON.stringify({ event: "ingest_api.error", requestId: requestId(request), path: url.pathname, error: message }));
    return ingestError(request, "internal_error", "The scanner request could not be completed.", 500);
  }
}

async function listJobs(request: Request, env: Env, principal: ScannerPrincipal): Promise<Response> {
  await ensureDueScanJobs(env);
  const rows = await env.MGMT_DB.prepare(`
    SELECT j.*,c.provider,c.account_id,c.name connector_name,c.scanner_kind,c.config
    FROM scan_jobs j JOIN source_connectors c ON c.id=j.connector_id
    WHERE j.status='queued' AND c.enabled=1 ORDER BY j.priority DESC,j.queued_at LIMIT 50
  `).all<Record<string, unknown>>();
  const jobs = (rows.results ?? []).filter((row) => scannerCanUse(principal, row)).map((row) => ({ ...row, config: parseJson(row.config, {}) }));
  return ingestData(request, jobs, { pollAfterSeconds: jobs.length ? 5 : 60 });
}

async function claimJob(request: Request, env: Env, id: string, principal: ScannerPrincipal): Promise<Response> {
  const row = await env.MGMT_DB.prepare(`SELECT j.*,c.provider,c.account_id,c.name connector_name,c.config FROM scan_jobs j JOIN source_connectors c ON c.id=j.connector_id WHERE j.id=?1`).bind(id).first<Record<string, unknown>>();
  if (!row) return ingestError(request, "not_found", "Scan job not found.", 404);
  if (!scannerCanUse(principal, row)) return ingestError(request, "source_forbidden", "This key cannot claim the requested source.", 403);
  if (String(row.status) !== "queued") return ingestError(request, "job_not_available", "Scan job is no longer queued.", 409);
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  const result = await env.MGMT_DB.prepare(`
    UPDATE scan_jobs SET status='claimed',lease_owner=?1,lease_until=?2,claimed_at=?3,attempt=attempt+1,updated_at=?3
    WHERE id=?4 AND status='queued' AND cancel_requested=0
  `).bind(principal.id, leaseUntil, now.toISOString(), id).run();
  if (!result.meta?.changes) return ingestError(request, "job_not_available", "Scan job was claimed or cancelled by another request.", 409);
  return ingestData(request, { id, connectorId: row.connector_id, provider: row.provider, accountId: row.account_id, mode: row.mode, config: parseJson(row.config, {}), leaseUntil });
}

async function createRun(request: Request, env: Env, principal: ScannerPrincipal): Promise<Response> {
  const body = await readObject(request);
  if (!body?.jobId || body.schemaVersion !== SCHEMA_VERSION) return ingestError(request, "unsupported_schema", `schemaVersion must be ${SCHEMA_VERSION}.`, 400);
  const job = await env.MGMT_DB.prepare(`SELECT j.*,c.provider,c.account_id,c.interval_seconds FROM scan_jobs j JOIN source_connectors c ON c.id=j.connector_id WHERE j.id=?1`).bind(String(body.jobId)).first<Record<string, unknown>>();
  if (!job) return ingestError(request, "job_not_found", "Scan job not found.", 404);
  if (!scannerCanUse(principal, job) || job.lease_owner !== principal.id) return ingestError(request, "lease_forbidden", "The scanner does not own this job lease.", 403);
  if (!["claimed", "running"].includes(String(job.status)) || Number(job.cancel_requested)) return ingestError(request, "job_not_runnable", "The job is not runnable.", 409);
  if (job.lease_until && Date.parse(String(job.lease_until)) <= Date.now()) return ingestError(request, "lease_expired", "The scanner lease expired.", 409);
  if (job.run_id) {
    const existing = await env.MGMT_DB.prepare(`SELECT * FROM asset_discovery_runs WHERE id=?1`).bind(job.run_id).first();
    return ingestData(request, existing, { resumed: true }, 200);
  }
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.MGMT_DB.batch([
    env.MGMT_DB.prepare(`INSERT INTO asset_discovery_runs(id,provider,account_id,mode,status,started_at,created_at,connector_id,job_id,schema_version,fingerprint) VALUES(?1,?2,?3,?4,'running',?5,?5,?6,?7,?8,?9)`).bind(runId, job.provider, job.account_id, String(job.mode), now, job.connector_id, job.id, SCHEMA_VERSION, clean(body.fingerprint, 256)),
    env.MGMT_DB.prepare(`UPDATE scan_jobs SET status='running',run_id=?1,started_at=COALESCE(started_at,?2),updated_at=?2 WHERE id=?3`).bind(runId, now, job.id),
  ]);
  return ingestData(request, { id: runId, jobId: job.id, connectorId: job.connector_id, schemaVersion: SCHEMA_VERSION, startedAt: now }, undefined, 201);
}

async function ingestBatch(request: Request, env: Env, runId: string, rawIndex: string, principal: ScannerPrincipal): Promise<Response> {
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index > 100_000) return ingestError(request, "invalid_batch_index", "Batch index is invalid.", 400);
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BATCH_BYTES) return ingestError(request, "payload_too_large", "Batch payload exceeds 1 MB.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BATCH_BYTES) return ingestError(request, "payload_too_large", "Batch payload exceeds 1 MB.", 413);
  let body: Record<string, any>;
  try { body = JSON.parse(text); } catch { return ingestError(request, "invalid_json", "A JSON object is required.", 400); }
  const assets = Array.isArray(body.assets) ? body.assets : null;
  if (!assets || assets.length > MAX_BATCH_ASSETS) return ingestError(request, "invalid_batch", `A batch must contain at most ${MAX_BATCH_ASSETS} assets.`, 400);
  const run = await ownedRun(env, runId, principal);
  if (run instanceof Response) return run;
  const payloadHash = await sha256(text);
  const prior = await env.MGMT_DB.prepare(`SELECT payload_hash,asset_count FROM ingest_batches WHERE run_id=?1 AND batch_index=?2`).bind(runId, index).first<Record<string, unknown>>();
  if (prior) {
    if (prior.payload_hash !== payloadHash) return ingestError(request, "batch_conflict", "This batch index was already used with different content.", 409);
    return ingestData(request, { runId, batchIndex: index, assetCount: prior.asset_count }, { idempotentReplay: true });
  }
  const validated: Record<string, any>[] = [];
  for (const input of assets) {
    const asset = normalizeAsset(input, run);
    if (!asset) return ingestError(request, "invalid_asset", "One or more assets are malformed or outside the connector scope.", 400);
    validated.push(asset);
  }
  let newCount = 0, changedCount = 0, unchangedCount = 0;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const asset of validated) {
    asset.contentHash = await contentHash(asset);
    const existing = await env.MGMT_DB.prepare(`SELECT content_hash FROM discovered_assets WHERE provider=?1 AND account_id=?2 AND kind=?3 AND external_id=?4`).bind(asset.provider, asset.accountId, asset.kind, asset.externalId).first<{ content_hash: string | null }>();
    if (!existing) newCount += 1;
    else if (existing.content_hash === asset.contentHash) unchangedCount += 1;
    else changedCount += 1;
    statements.push(env.MGMT_DB.prepare(`
      INSERT INTO discovered_assets(id,provider,account_id,kind,external_id,parent_external_id,name,status,region,url,server_id,project_id,metadata,first_seen_at,last_seen_at,last_verified_at,stale_after,created_at,updated_at,content_hash,source_run_id)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14,?14,?15,?14,?14,?16,?17)
      ON CONFLICT(provider,account_id,kind,external_id) DO UPDATE SET parent_external_id=excluded.parent_external_id,name=excluded.name,status=excluded.status,region=excluded.region,url=excluded.url,
        server_id=COALESCE(excluded.server_id,discovered_assets.server_id),project_id=COALESCE(excluded.project_id,discovered_assets.project_id),metadata=excluded.metadata,last_seen_at=excluded.last_seen_at,
        last_verified_at=excluded.last_verified_at,stale_after=excluded.stale_after,updated_at=CASE WHEN discovered_assets.content_hash=excluded.content_hash THEN discovered_assets.updated_at ELSE excluded.updated_at END,
        content_hash=excluded.content_hash,source_run_id=excluded.source_run_id
    `).bind(asset.id, asset.provider, asset.accountId, asset.kind, asset.externalId, asset.parentExternalId, asset.name, asset.status, asset.region, asset.url, asset.serverId, asset.projectId, JSON.stringify(asset.metadata), now, asset.staleAfter, asset.contentHash, runId));
    if (asset.provider === "tencent" && ["cvm", "lighthouse"].includes(asset.kind)) {
      const publicIp = Array.isArray(asset.metadata?.publicIps) ? asset.metadata.publicIps[0] ?? null : null;
      statements.push(env.MGMT_DB.prepare(`UPDATE servers SET provider_resource_id=?1,cloud_status=?2,cloud_checked_at=?3,cpu=COALESCE(?4,cpu),memory_mb=COALESCE(?5,memory_mb),disk_gb=COALESCE(?6,disk_gb),due_at=COALESCE(?7,due_at),updated_at=?3 WHERE id=?8 OR provider_resource_id=?1 OR (?9 IS NOT NULL AND provider LIKE 'tencent%' AND ip_address=?9)`)
        .bind(asset.externalId, asset.status, now, asset.metadata?.cpu != null ? `${asset.metadata.cpu} vCPU` : null, asset.metadata?.memoryMb ?? null, asset.metadata?.diskGb ?? null, asset.metadata?.expiredAt ?? null, asset.serverId, publicIp));
    }
    if (asset.provider === "tencent" && asset.kind === "tat_agent") {
      const healthy = asset.status === "online" ? "healthy" : "offline";
      statements.push(env.MGMT_DB.prepare(`UPDATE servers SET health_status=?1,last_checked_at=?2,last_healthy_at=CASE WHEN ?1='healthy' THEN ?2 ELSE last_healthy_at END,consecutive_successes=CASE WHEN ?1='healthy' THEN consecutive_successes+1 ELSE 0 END,consecutive_failures=CASE WHEN ?1='healthy' THEN 0 ELSE consecutive_failures+1 END,updated_at=?2 WHERE id=?3 OR provider_resource_id=?4`)
        .bind(healthy, now, asset.serverId, asset.externalId));
    }
  }
  for (let i = 0; i < statements.length; i += 50) await env.MGMT_DB.batch(statements.slice(i, i + 50));
  await env.MGMT_DB.batch([
    env.MGMT_DB.prepare(`INSERT INTO ingest_batches(run_id,batch_index,payload_hash,asset_count,received_at) VALUES(?1,?2,?3,?4,?5)`).bind(runId, index, payloadHash, validated.length, now),
    env.MGMT_DB.prepare(`UPDATE asset_discovery_runs SET received_count=received_count+?1,new_count=new_count+?2,changed_count=changed_count+?3,unchanged_count=unchanged_count+?4,discovered_count=discovered_count+?1 WHERE id=?5`).bind(validated.length, newCount, changedCount, unchangedCount, runId),
  ]);
  return ingestData(request, { runId, batchIndex: index, assetCount: validated.length, newCount, changedCount, unchangedCount }, undefined, 201);
}

async function completeRun(request: Request, env: Env, ctx: ExecutionContext, runId: string, principal: ScannerPrincipal): Promise<Response> {
  const run = await ownedRun(env, runId, principal);
  if (run instanceof Response) return run;
  const body = await readObject(request) ?? {};
  const errors = Array.isArray(body.errors) ? body.errors.slice(0, 100) : [];
  const authoritative = body.authoritative === true;
  const job = await env.MGMT_DB.prepare(`SELECT * FROM scan_jobs WHERE id=?1`).bind(run.job_id).first<Record<string, unknown>>();
  if (Number(job?.cancel_requested)) {
    const now = new Date().toISOString();
    await env.MGMT_DB.batch([
      env.MGMT_DB.prepare(`UPDATE asset_discovery_runs SET status='cancelled',completed_at=?1 WHERE id=?2`).bind(now, runId),
      env.MGMT_DB.prepare(`UPDATE scan_jobs SET status='cancelled',completed_at=?1,updated_at=?1 WHERE id=?2`).bind(now, run.job_id),
    ]);
    return ingestError(request, "scan_cancelled", "The scan was cancelled; received data was retained without staling.", 409);
  }
  const status = errors.length ? "partial" : "completed";
  const now = new Date();
  let staleCount = 0;
  if (authoritative && !errors.length) {
    const scope = run.account_id === "*" ? `provider=?2` : `provider=?2 AND account_id=?3`;
    const binding = run.account_id === "*" ? [now.toISOString(), run.provider, runId] : [now.toISOString(), run.provider, run.account_id, runId];
    const runPlaceholder = run.account_id === "*" ? "?3" : "?4";
    const result = await env.MGMT_DB.prepare(`UPDATE discovered_assets SET status='stale',updated_at=?1 WHERE ${scope} AND (source_run_id IS NULL OR source_run_id!=${runPlaceholder}) AND status!='stale'`).bind(...binding).run();
    staleCount = Number(result.meta?.changes ?? 0);
  }
  const errorCode = errors[0]?.code ? String(errors[0].code).slice(0, 100) : null;
  const errorMessage = errors.map((item) => String(item.message ?? item.code ?? "scan_error")).join("; ").slice(0, 1000) || null;
  const interval = Number(run.interval_seconds ?? 14400);
  const nextDue = new Date(now.getTime() + interval * 1000).toISOString();
  const credentialStatus = errorCode === "not_configured" ? "unconfigured" : errors.length ? "error" : "configured";
  await env.MGMT_DB.batch([
    env.MGMT_DB.prepare(`UPDATE asset_discovery_runs SET status=?1,stale_count=?2,error_code=?3,error_message=?4,duration_ms=?5,completed_at=?6 WHERE id=?7`).bind(status === "completed" ? "complete" : status, staleCount, errorCode, errorMessage, numberOrNull(body.durationMs), now.toISOString(), runId),
    env.MGMT_DB.prepare(`UPDATE scan_jobs SET status=?1,error_code=?2,error_message=?3,completed_at=?4,updated_at=?4,lease_until=NULL WHERE id=?5`).bind(status, errorCode, errorMessage, now.toISOString(), run.job_id),
    env.MGMT_DB.prepare(`UPDATE source_connectors SET credential_status=?1,last_success_at=CASE WHEN ?2='completed' THEN ?3 ELSE last_success_at END,next_due_at=?4,last_error_code=?5,last_error_message=?6,updated_at=?3 WHERE id=?7`).bind(credentialStatus, status, now.toISOString(), nextDue, errorCode, errorMessage, run.connector_id),
  ]);
  if (Array.isArray(body.links)) await ingestLinks(env, body.links, now.toISOString());
  ctx.waitUntil(audit(env, "scan.completed", { runId, jobId: run.job_id, status, staleCount }, now.toISOString()));
  const counts = await env.MGMT_DB.prepare(`SELECT discovered_count,new_count,changed_count,unchanged_count,stale_count FROM asset_discovery_runs WHERE id=?1`).bind(runId).first();
  return ingestData(request, { id: runId, jobId: run.job_id, status, authoritative: authoritative && !errors.length, ...counts });
}

async function failRun(request: Request, env: Env, runId: string, principal: ScannerPrincipal): Promise<Response> {
  const run = await ownedRun(env, runId, principal);
  if (run instanceof Response) return run;
  const body = await readObject(request) ?? {};
  const code = clean(body.code, 100) ?? "scan_failed";
  const message = clean(body.message, 1000) ?? "Scanner reported failure.";
  const now = new Date();
  const nextDue = new Date(now.getTime() + Math.min(1800, Number(run.interval_seconds ?? 14400)) * 1000).toISOString();
  await env.MGMT_DB.batch([
    env.MGMT_DB.prepare(`UPDATE asset_discovery_runs SET status='failed',error_code=?1,error_message=?2,completed_at=?3 WHERE id=?4`).bind(code, message, now.toISOString(), runId),
    env.MGMT_DB.prepare(`UPDATE scan_jobs SET status='failed',error_code=?1,error_message=?2,completed_at=?3,updated_at=?3,lease_until=NULL WHERE id=?4`).bind(code, message, now.toISOString(), run.job_id),
    env.MGMT_DB.prepare(`UPDATE source_connectors SET credential_status='error',next_due_at=?1,last_error_code=?2,last_error_message=?3,updated_at=?4 WHERE id=?5`).bind(nextDue, code, message, now.toISOString(), run.connector_id),
  ]);
  return ingestData(request, { id: runId, jobId: run.job_id, status: "failed" });
}

async function ownedRun(env: Env, id: string, principal: ScannerPrincipal): Promise<Record<string, any> | Response> {
  const row = await env.MGMT_DB.prepare(`SELECT r.*,j.lease_owner,j.lease_until,j.cancel_requested,c.interval_seconds,c.id connector_id,c.provider connector_provider,c.account_id connector_account FROM asset_discovery_runs r JOIN scan_jobs j ON j.id=r.job_id JOIN source_connectors c ON c.id=r.connector_id WHERE r.id=?1`).bind(id).first<Record<string, any>>();
  if (!row) return Response.json({ error: { code: "run_not_found", message: "Scan run not found.", requestId: crypto.randomUUID(), details: null } }, { status: 404 });
  if (row.lease_owner !== principal.id || !scannerCanUse(principal, { id: row.connector_id, provider: row.connector_provider, account_id: row.connector_account })) return Response.json({ error: { code: "lease_forbidden", message: "The scanner does not own this run.", requestId: crypto.randomUUID(), details: null } }, { status: 403 });
  return row;
}

function normalizeAsset(input: unknown, run: Record<string, any>): Record<string, any> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, any>;
  const provider = clean(value.provider, 50), accountId = clean(value.accountId, 200), kind = clean(value.kind, 100), externalId = clean(value.externalId, 500), name = clean(value.name, 500);
  if (!provider || !accountId || !kind || !externalId || !name || provider !== String(run.provider)) return null;
  if (run.account_id !== "*" && accountId !== String(run.account_id)) return null;
  const id = clean(value.id, 200) ?? stableId(provider, accountId, kind, externalId);
  const staleAfterMs = provider === "docker" ? 3_600_000 : 172_800_000;
  return { id, provider, accountId, kind, externalId, parentExternalId: clean(value.parentExternalId, 500), name, status: clean(value.status, 100) ?? "unknown", region: clean(value.region, 100), url: validUrl(value.url), serverId: clean(value.serverId, 200), projectId: clean(value.projectId, 200), metadata: sanitizeMetadata(value.metadata), staleAfter: new Date(Date.now() + staleAfterMs).toISOString() };
}

async function contentHash(asset: Record<string, any>): Promise<string> {
  return sha256(JSON.stringify(sortObject({ provider: asset.provider, accountId: asset.accountId, kind: asset.kind, externalId: asset.externalId, parentExternalId: asset.parentExternalId, name: asset.name, status: asset.status, region: asset.region, url: asset.url, serverId: asset.serverId, projectId: asset.projectId, metadata: asset.metadata })));
}
function sortObject(value: any): any { if (Array.isArray(value)) return value.map(sortObject); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])])); return value; }
function sanitizeMetadata(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; const text = JSON.stringify(value); if (new TextEncoder().encode(text).byteLength > 200_000) return { truncated: true }; return JSON.parse(text); }
function validUrl(value: unknown): string | null { if (!value) return null; try { const url = new URL(String(value)); return ["http:", "https:", "ssh:", "git:"].includes(url.protocol) ? url.toString().slice(0, 2000) : null; } catch { return null; } }
function stableId(...parts: string[]): string { let hash = 2166136261; for (const char of parts.join("\0")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `asset-${(hash >>> 0).toString(16).padStart(8, "0")}`; }
async function sha256(value: string): Promise<string> { const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function ingestLinks(env: Env, links: unknown[], now: string): Promise<void> { for (const input of links.slice(0, 2000)) { if (!input || typeof input !== "object") continue; const link = input as Record<string, any>; const source = clean(link.sourceAssetId, 200), relationship = clean(link.relationship, 100); if (!source || !relationship) continue; const target = clean(link.targetAssetId, 200), project = clean(link.projectId, 200), id = stableId("link", source, target ?? project ?? "", relationship); await env.MGMT_DB.prepare(`INSERT INTO resource_links(id,source_asset_id,target_asset_id,project_id,relationship,confidence,status,evidence,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9) ON CONFLICT(source_asset_id,target_asset_id,project_id,relationship) DO UPDATE SET confidence=excluded.confidence,status=excluded.status,evidence=excluded.evidence,updated_at=excluded.updated_at`).bind(id, source, target, project, relationship, Math.max(0, Math.min(1, Number(link.confidence ?? 0))), ["candidate", "confirmed", "rejected"].includes(link.status) ? link.status : "candidate", JSON.stringify(Array.isArray(link.evidence) ? link.evidence.slice(0, 20) : []), now).run(); } }
function clean(value: unknown, max: number): string | null { const text = String(value ?? "").trim(); return text ? text.slice(0, max) : null; }
function numberOrNull(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function parseJson(value: unknown, fallback: unknown): any { try { return JSON.parse(String(value)); } catch { return fallback; } }
async function readObject(request: Request): Promise<Record<string, any> | null> { const body = await request.json().catch(() => null); return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, any> : null; }
function requestId(request: Request): string { return request.headers.get("CF-Ray") ?? request.headers.get("X-Request-Id") ?? crypto.randomUUID(); }
function ingestData(request: Request, data: unknown, meta: unknown = {}, status = 200): Response { return Response.json({ data, meta: { ...(meta && typeof meta === "object" ? meta : {}), requestId: requestId(request) } }, { status, headers: { "Cache-Control": "no-store" } }); }
function ingestError(request: Request, code: string, message: string, status: number, details: unknown = null): Response { return Response.json({ error: { code, message, requestId: requestId(request), details } }, { status, headers: { "Cache-Control": "no-store" } }); }
function audit(env: Env, event: string, payload: unknown, now: string): Promise<D1Result> { return env.MGMT_DB.prepare(`INSERT INTO audit_events(event_type,payload,created_at) VALUES(?1,?2,?3)`).bind(event, JSON.stringify(payload), now).run(); }
