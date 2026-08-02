import { isValidRequestOrigin, readAdminSession, requireAdminToken } from "../lib/auth";
import { hashKey } from "../lib/apikey";
import { createScanJob, ensureDueScanJobs } from "../lib/scan-jobs";
import { generateScannerKey } from "../lib/scanner-auth";
import { createResourceSnapshot, latestResourceSnapshot } from "../lib/resource-snapshot";

const SECRET_FIELD = /(secret|token|password|credential|private.?key|api.?key)/i;

export async function handleAdminApiV1(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await requireAdminToken(request, env);
  if (auth) return v1Error(request, "unauthorized", "Administrator authentication is required.", 401);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.has("Cookie") && !isValidRequestOrigin(request)) {
    return v1Error(request, "invalid_origin", "The request origin is not allowed.", 403);
  }
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).slice(3);
  const [resource, id, action] = parts;
  try {
    if (resource === "openapi.json" && request.method === "GET") return openApi(request);
    if (resource === "overview" && request.method === "GET") return overview(request, env);
    if (resource === "resource-snapshots") {
      if (id === "current" && request.method === "GET") return currentResourceSnapshot(request, env);
      if (!id && request.method === "POST") return generateResourceSnapshot(request, env, ctx);
    }
    if (resource === "sources") {
      if (!id && request.method === "GET") return sources(request, env);
      if (id && request.method === "PATCH") return patchSource(request, env, id);
    }
    if (resource === "resources") {
      if (!id && request.method === "GET") return resources(request, env, url);
      if (id && request.method === "GET") return resourceDetail(request, env, id);
      if (id && request.method === "PATCH") return patchResource(request, env, ctx, id);
    }
    if (resource === "export" && id === "assets.ndjson" && request.method === "GET") return exportAssets(env);
    if (resource === "scans") {
      if (!id && request.method === "POST") return createScans(request, env, ctx);
      if (id && !action && request.method === "GET") return scanDetail(request, env, id);
      if (id && action === "cancel" && request.method === "POST") return cancelScan(request, env, id);
      if (id && action === "retry" && request.method === "POST") return retryScan(request, env, id);
    }
    if (resource === "resource-links") {
      if (!id && request.method === "GET") return links(request, env, url);
      if (id && request.method === "PATCH") return patchLink(request, env, ctx, id);
    }
    if (resource === "service-keys") {
      if (!id && request.method === "GET") return serviceKeys(request, env);
      if (!id && request.method === "POST") return createServiceKey(request, env, ctx);
      if (id && action === "rotate" && request.method === "POST") return rotateServiceKey(request, env, ctx, id);
      if (id && request.method === "DELETE") return revokeServiceKey(request, env, ctx, id);
    }
    return v1Error(request, "not_found", "Administrator API endpoint not found.", 404);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown_error";
    if (message === "connector_not_found_or_disabled") return v1Error(request, message, "Connector not found or disabled.", 404);
    console.error(JSON.stringify({ event: "admin_api.error", requestId: requestId(request), path: url.pathname, error: message }));
    return v1Error(request, "internal_error", "The request could not be completed.", 500);
  }
}

async function overview(request: Request, env: Env): Promise<Response> {
  await ensureDueScanJobs(env);
  const [connectors, assets, jobs, errors] = await Promise.all([
    env.MGMT_DB.prepare(`SELECT * FROM source_connectors ORDER BY scanner_kind,provider,account_id`).all(),
    env.MGMT_DB.prepare(`SELECT provider,kind,status,COUNT(*) count,MAX(last_seen_at) last_seen_at FROM discovered_assets GROUP BY provider,kind,status ORDER BY provider,kind,status`).all(),
    env.MGMT_DB.prepare(`SELECT status,COUNT(*) count FROM scan_jobs GROUP BY status`).all(),
    env.MGMT_DB.prepare(`SELECT id,connector_id,status,error_code,error_message,updated_at FROM scan_jobs WHERE error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 10`).all(),
  ]);
  return v1Data(request, { connectors: connectors.results ?? [], assets: assets.results ?? [], jobs: jobs.results ?? [], recentErrors: errors.results ?? [] }, { generatedAt: new Date().toISOString() });
}

async function currentResourceSnapshot(request: Request, env: Env): Promise<Response> {
  let snapshot = await latestResourceSnapshot(env);
  if (!snapshot) snapshot = await createResourceSnapshot(env, "manual");
  return v1Data(request, snapshot, { generatedAt: snapshot.generatedAt, schemaVersion: snapshot.schemaVersion });
}

async function generateResourceSnapshot(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const snapshot = await createResourceSnapshot(env, "manual");
  ctx.waitUntil(audit(env, "resource_snapshot.generated", { generatedAt: snapshot.generatedAt }, snapshot.generatedAt));
  return v1Data(request, snapshot, { generatedAt: snapshot.generatedAt, schemaVersion: snapshot.schemaVersion }, 201);
}

async function sources(request: Request, env: Env): Promise<Response> {
  const rows = await env.MGMT_DB.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM discovered_assets a WHERE a.provider=c.provider AND a.status!='stale' AND (c.account_id='*' OR a.account_id=c.account_id)) asset_count,
      (SELECT COUNT(*) FROM discovered_assets a WHERE a.provider=c.provider AND (c.account_id='*' OR a.account_id=c.account_id)) total_asset_count,
      (SELECT status FROM scan_jobs j WHERE j.connector_id=c.id ORDER BY j.created_at DESC LIMIT 1) latest_job_status,
      (SELECT id FROM scan_jobs j WHERE j.connector_id=c.id ORDER BY j.created_at DESC LIMIT 1) latest_job_id
    FROM source_connectors c ORDER BY scanner_kind,provider,account_id
  `).all<Record<string, unknown>>();
  return v1Data(request, (rows.results ?? []).map(parseConnector));
}

async function patchSource(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readObject(request);
  if (!body) return v1Error(request, "invalid_json", "A JSON object is required.", 400);
  const current = await env.MGMT_DB.prepare(`SELECT * FROM source_connectors WHERE id=?1`).bind(id).first<Record<string, unknown>>();
  if (!current) return v1Error(request, "not_found", "Source connector not found.", 404);
  const enabled = body.enabled === undefined ? Number(current.enabled) : body.enabled === true ? 1 : body.enabled === false ? 0 : -1;
  const interval = body.intervalSeconds === undefined ? Number(current.interval_seconds) : Number(body.intervalSeconds);
  if (enabled < 0 || !Number.isInteger(interval) || interval < 300 || interval > 86400) return v1Error(request, "invalid_source_config", "enabled and intervalSeconds are invalid.", 400);
  const config = body.config === undefined ? parseJson(current.config, {}) : body.config;
  if (!isPlainObject(config) || containsSecretField(config)) return v1Error(request, "secret_config_rejected", "Secret-like fields cannot be stored in connector config.", 400);
  const now = new Date().toISOString();
  await env.MGMT_DB.prepare(`UPDATE source_connectors SET enabled=?1,interval_seconds=?2,config=?3,updated_at=?4 WHERE id=?5`)
    .bind(enabled, interval, JSON.stringify(config), now, id).run();
  return v1Data(request, { id, enabled: Boolean(enabled), intervalSeconds: interval, config });
}

async function resources(request: Request, env: Env, url: URL): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) return v1Error(request, "invalid_query", "limit must be an integer from 1 to 500.", 400);
  const limit = requestedLimit;
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeCursor(rawCursor);
  if (rawCursor && !cursor) return v1Error(request, "invalid_cursor", "The resource cursor is invalid.", 400);
  const values: unknown[] = [];
  const where: string[] = [];
  for (const [param, column] of [["provider", "a.provider"], ["account", "a.account_id"], ["kind", "a.kind"], ["status", "a.status"], ["server", "a.server_id"]] as const) {
    const value = url.searchParams.get(param)?.trim();
    if (value) { values.push(value); where.push(`${column}=?${values.length}`); }
  }
  const q = url.searchParams.get("q")?.trim();
  if (q) { values.push(`%${q}%`); where.push(`(a.name LIKE ?${values.length} OR a.external_id LIKE ?${values.length} OR a.url LIKE ?${values.length})`); }
  const changed = url.searchParams.get("changed_since");
  if (changed && !Number.isNaN(Date.parse(changed))) { values.push(new Date(changed).toISOString()); where.push(`a.updated_at>=?${values.length}`); }
  const linked = url.searchParams.get("linked");
  if (linked === "true") where.push(`(a.project_id IS NOT NULL OR EXISTS(SELECT 1 FROM resource_links l WHERE l.source_asset_id=a.id AND l.status='confirmed'))`);
  if (linked === "false") where.push(`a.project_id IS NULL AND NOT EXISTS(SELECT 1 FROM resource_links l WHERE l.source_asset_id=a.id AND l.status='confirmed')`);
  if (cursor) { values.push(cursor.updatedAt, cursor.id); where.push(`(a.updated_at<?${values.length - 1} OR (a.updated_at=?${values.length - 1} AND a.id>?${values.length}))`); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.MGMT_DB.prepare(`
    SELECT a.*,n.display_name,n.description,n.tags,n.visibility,n.ignored,n.pinned,n.pin_rank
    FROM discovered_assets a LEFT JOIN asset_annotations n ON n.asset_id=a.id
    ${clause} ORDER BY a.updated_at DESC,a.id ASC LIMIT ?${values.length + 1}
  `).bind(...values, limit + 1).all<Record<string, unknown>>();
  const all = rows.results ?? [];
  const page = all.slice(0, limit).map(serializeAsset);
  const next = all.length > limit && page.length ? encodeCursor({ updatedAt: String(page[page.length - 1].updated_at), id: String(page[page.length - 1].id) }) : null;
  return v1Data(request, page, { limit, nextCursor: next, hasMore: Boolean(next) });
}

async function resourceDetail(request: Request, env: Env, id: string): Promise<Response> {
  const row = await env.MGMT_DB.prepare(`
    SELECT a.*,n.display_name,n.description,n.tags,n.visibility,n.ignored,n.pinned,n.pin_rank,
      p.name project_name,p.slug project_slug,s.name server_name,s.public_url server_url
    FROM discovered_assets a LEFT JOIN asset_annotations n ON n.asset_id=a.id
    LEFT JOIN catalog_projects p ON p.id=a.project_id LEFT JOIN servers s ON s.id=a.server_id WHERE a.id=?1
  `).bind(id).first<Record<string, unknown>>();
  if (!row) return v1Error(request, "not_found", "Resource not found.", 404);
  const [links, history] = await Promise.all([
    env.MGMT_DB.prepare(`SELECT * FROM resource_links WHERE source_asset_id=?1 OR target_asset_id=?1 ORDER BY updated_at DESC`).bind(id).all(),
    env.MGMT_DB.prepare(`SELECT id,status,started_at,completed_at,changed_count,unchanged_count,error_code FROM asset_discovery_runs WHERE id IN (SELECT source_run_id FROM discovered_assets WHERE id=?1) ORDER BY started_at DESC LIMIT 20`).bind(id).all(),
  ]);
  return v1Data(request, { ...serializeAsset(row), links: links.results ?? [], history: history.results ?? [] });
}

async function patchResource(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const body = await readObject(request);
  if (!body) return v1Error(request, "invalid_json", "A JSON object is required.", 400);
  const exists = await env.MGMT_DB.prepare(`SELECT id FROM discovered_assets WHERE id=?1`).bind(id).first();
  if (!exists) return v1Error(request, "not_found", "Resource not found.", 404);
  const tags = body.tags === undefined ? undefined : Array.isArray(body.tags) ? [...new Set(body.tags.map(String).map((v) => v.trim()).filter(Boolean))].slice(0, 50) : null;
  if (tags === null || (body.visibility !== undefined && !["private", "internal", "public"].includes(String(body.visibility)))) return v1Error(request, "invalid_annotation", "Annotation fields are invalid.", 400);
  const current = await env.MGMT_DB.prepare(`SELECT * FROM asset_annotations WHERE asset_id=?1`).bind(id).first<Record<string, unknown>>();
  const now = new Date().toISOString();
  const value = {
    displayName: body.displayName === undefined ? current?.display_name ?? null : cleanText(body.displayName, 200),
    description: body.description === undefined ? current?.description ?? null : cleanText(body.description, 5000),
    tags: tags ?? parseJson(current?.tags, []),
    visibility: body.visibility === undefined ? current?.visibility ?? "private" : String(body.visibility),
    ignored: body.ignored === undefined ? Number(current?.ignored ?? 0) : body.ignored ? 1 : 0,
    pinned: body.pinned === undefined ? Number(current?.pinned ?? 0) : body.pinned ? 1 : 0,
    pinRank: body.pinRank === undefined ? current?.pin_rank ?? null : body.pinRank === null ? null : Number(body.pinRank),
  };
  await env.MGMT_DB.prepare(`
    INSERT INTO asset_annotations(asset_id,display_name,description,tags,visibility,ignored,pinned,pin_rank,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)
    ON CONFLICT(asset_id) DO UPDATE SET display_name=excluded.display_name,description=excluded.description,tags=excluded.tags,
      visibility=excluded.visibility,ignored=excluded.ignored,pinned=excluded.pinned,pin_rank=excluded.pin_rank,updated_at=excluded.updated_at
  `).bind(id, value.displayName, value.description, JSON.stringify(value.tags), value.visibility, value.ignored, value.pinned, value.pinRank, now).run();
  ctx.waitUntil(audit(env, "resource.annotation.updated", { id }, now));
  return v1Data(request, value);
}

async function createScans(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readObject(request) ?? {};
  const requested = Array.isArray(body.sourceIds) ? body.sourceIds.map(String) : body.sourceId ? [String(body.sourceId)] : [];
  const provider = body.provider ? String(body.provider) : null;
  let connectorIds = requested;
  if (!connectorIds.length) {
    const rows = provider
      ? await env.MGMT_DB.prepare(`SELECT id FROM source_connectors WHERE enabled=1 AND provider=?1`).bind(provider).all<{ id: string }>()
      : await env.MGMT_DB.prepare(`SELECT id FROM source_connectors WHERE enabled=1`).all<{ id: string }>();
    connectorIds = (rows.results ?? []).map((row) => row.id);
  }
  if (!connectorIds.length) return v1Error(request, "no_sources", "No enabled source connector matched.", 400);
  const session = await readAdminSession(request, env);
  const jobs = [];
  for (const connectorId of [...new Set(connectorIds)]) jobs.push(await createScanJob(env, connectorId, String(body.mode ?? "incremental"), session?.userId ?? "admin_token", 100));
  ctx.waitUntil(audit(env, "scan.jobs.created", { connectorIds, jobs }, new Date().toISOString()));
  return v1Data(request, jobs, { coalesced: jobs.filter((job) => !job.created).length }, 202);
}

async function scanDetail(request: Request, env: Env, id: string): Promise<Response> {
  const job = await env.MGMT_DB.prepare(`SELECT j.*,c.provider,c.account_id,c.name connector_name FROM scan_jobs j JOIN source_connectors c ON c.id=j.connector_id WHERE j.id=?1`).bind(id).first<Record<string, unknown>>();
  if (!job) return v1Error(request, "not_found", "Scan job not found.", 404);
  const run = job.run_id ? await env.MGMT_DB.prepare(`SELECT * FROM asset_discovery_runs WHERE id=?1`).bind(job.run_id).first() : null;
  return v1Data(request, { ...job, run });
}

async function cancelScan(request: Request, env: Env, id: string): Promise<Response> {
  const now = new Date().toISOString();
  const result = await env.MGMT_DB.prepare(`
    UPDATE scan_jobs SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
      completed_at=CASE WHEN status='queued' THEN ?1 ELSE completed_at END,updated_at=?1
    WHERE id=?2 AND status IN ('queued','claimed','running')
  `).bind(now, id).run();
  if (!result.meta?.changes) return v1Error(request, "not_cancellable", "Scan job was not found or is already terminal.", 409);
  return v1Data(request, { id, cancelRequested: true }, undefined, 202);
}

async function retryScan(request: Request, env: Env, id: string): Promise<Response> {
  const job = await env.MGMT_DB.prepare(`SELECT connector_id,mode,status FROM scan_jobs WHERE id=?1`).bind(id).first<Record<string, unknown>>();
  if (!job) return v1Error(request, "not_found", "Scan job not found.", 404);
  if (!["failed", "partial", "cancelled"].includes(String(job.status))) return v1Error(request, "not_retryable", "Only failed, partial, or cancelled jobs can be retried.", 409);
  const next = await createScanJob(env, String(job.connector_id), String(job.mode), `retry:${id}`, 100);
  return v1Data(request, next, undefined, 202);
}

async function links(request: Request, env: Env, url: URL): Promise<Response> {
  const status = url.searchParams.get("status") ?? "candidate";
  const rows = await env.MGMT_DB.prepare(`SELECT l.*,s.name source_name,t.name target_name,p.name project_name FROM resource_links l JOIN discovered_assets s ON s.id=l.source_asset_id LEFT JOIN discovered_assets t ON t.id=l.target_asset_id LEFT JOIN catalog_projects p ON p.id=l.project_id WHERE l.status=?1 ORDER BY l.confidence DESC,l.updated_at DESC LIMIT 500`).bind(status).all();
  return v1Data(request, rows.results ?? []);
}

async function patchLink(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const body = await readObject(request);
  if (!body || !["candidate", "confirmed", "rejected"].includes(String(body.status))) return v1Error(request, "invalid_status", "Link status is invalid.", 400);
  const now = new Date().toISOString();
  const result = await env.MGMT_DB.prepare(`UPDATE resource_links SET status=?1,updated_at=?2 WHERE id=?3`).bind(body.status, now, id).run();
  if (!result.meta?.changes) return v1Error(request, "not_found", "Resource link not found.", 404);
  ctx.waitUntil(audit(env, "resource_link.reviewed", { id, status: body.status }, now));
  return v1Data(request, { id, status: body.status });
}

async function serviceKeys(request: Request, env: Env): Promise<Response> {
  const rows = await env.MGMT_DB.prepare(`SELECT id,name,key_prefix,scopes,connector_ids,allowed_providers,allowed_accounts,expires_at,last_used_at,revoked_at,created_at,updated_at FROM scanner_service_keys ORDER BY created_at DESC`).all<Record<string, unknown>>();
  return v1Data(request, (rows.results ?? []).map(serializeServiceKey));
}

async function createServiceKey(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.API_KEY_SALT) return v1Error(request, "key_salt_unconfigured", "API_KEY_SALT is not configured.", 503);
  const body = await readObject(request);
  const name = cleanText(body?.name, 100);
  const scopes = normalizeAllowed(body?.scopes, ["jobs:poll", "jobs:claim", "ingest:write"]);
  const connectorIds = normalizeStrings(body?.connectorIds);
  const providers = normalizeStrings(body?.providers);
  const accounts = normalizeStrings(body?.accounts);
  if (!name || !scopes.length || (!connectorIds.length && !providers.length)) return v1Error(request, "invalid_service_key", "name, scopes, and connectorIds or providers are required.", 400);
  if (connectorIds.length) {
    const marks = connectorIds.map((_, index) => `?${index + 1}`).join(",");
    const count = await env.MGMT_DB.prepare(`SELECT COUNT(*) count FROM source_connectors WHERE id IN (${marks})`).bind(...connectorIds).first<{ count: number }>();
    if (Number(count?.count ?? 0) !== connectorIds.length) return v1Error(request, "invalid_connector", "One or more connector IDs do not exist.", 400);
  }
  const expiresAt = body?.expiresAt ? new Date(String(body.expiresAt)).toISOString() : null;
  const generated = generateScannerKey();
  const now = new Date().toISOString();
  await env.MGMT_DB.prepare(`INSERT INTO scanner_service_keys(id,name,key_hash,key_prefix,scopes,connector_ids,allowed_providers,allowed_accounts,expires_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`)
    .bind(generated.id, name, await hashKey(generated.raw, env.API_KEY_SALT), generated.prefix, JSON.stringify(scopes), JSON.stringify(connectorIds), JSON.stringify(providers), JSON.stringify(accounts), expiresAt, now).run();
  ctx.waitUntil(audit(env, "scanner_key.created", { id: generated.id, name, connectorIds, providers }, now));
  return v1Data(request, { id: generated.id, name, key: generated.raw, keyPrefix: generated.prefix, scopes, connectorIds, providers, accounts, expiresAt }, { warning: "The key is shown once and cannot be recovered." }, 201);
}

async function rotateServiceKey(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const row = await env.MGMT_DB.prepare(`SELECT name,scopes,connector_ids,allowed_providers,allowed_accounts,expires_at FROM scanner_service_keys WHERE id=?1 AND revoked_at IS NULL`).bind(id).first<Record<string, unknown>>();
  if (!row) return v1Error(request, "not_found", "Active service key not found.", 404);
  const now = new Date().toISOString();
  await env.MGMT_DB.prepare(`UPDATE scanner_service_keys SET revoked_at=?1,updated_at=?1 WHERE id=?2`).bind(now, id).run();
  const generated = generateScannerKey();
  await env.MGMT_DB.prepare(`INSERT INTO scanner_service_keys(id,name,key_hash,key_prefix,scopes,connector_ids,allowed_providers,allowed_accounts,expires_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`)
    .bind(generated.id, `${String(row.name)} (rotated)`, await hashKey(generated.raw, env.API_KEY_SALT ?? ""), generated.prefix, row.scopes, row.connector_ids, row.allowed_providers, row.allowed_accounts, row.expires_at, now).run();
  ctx.waitUntil(audit(env, "scanner_key.rotated", { oldId: id, newId: generated.id }, now));
  return v1Data(request, { id: generated.id, key: generated.raw, keyPrefix: generated.prefix }, { warning: "The replacement key is shown once." }, 201);
}

async function revokeServiceKey(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const now = new Date().toISOString();
  const result = await env.MGMT_DB.prepare(`UPDATE scanner_service_keys SET revoked_at=?1,updated_at=?1 WHERE id=?2 AND revoked_at IS NULL`).bind(now, id).run();
  if (!result.meta?.changes) return v1Error(request, "not_found", "Active service key not found.", 404);
  ctx.waitUntil(audit(env, "scanner_key.revoked", { id }, now));
  return new Response(null, { status: 204 });
}

function exportAssets(env: Env): Response {
  const encoder = new TextEncoder();
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const rows = await env.MGMT_DB.prepare(`SELECT a.*,n.display_name,n.description,n.tags,n.visibility,n.ignored,n.pinned,n.pin_rank FROM discovered_assets a LEFT JOIN asset_annotations n ON n.asset_id=a.id ORDER BY a.id LIMIT 500 OFFSET ?1`).bind(offset).all<Record<string, unknown>>();
      const values = rows.results ?? [];
      if (!values.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(values.map((row) => JSON.stringify(serializeAsset(row))).join("\n") + "\n"));
      offset += values.length;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": "attachment; filename=tableai-assets.ndjson", "Cache-Control": "no-store" } });
}

function openApi(request: Request): Response {
  const origin = new URL(request.url).origin;
  const paths: Record<string, unknown> = {};
  for (const [path, methods] of Object.entries({
    "/overview": ["get"], "/resource-snapshots/current": ["get"], "/resource-snapshots": ["post"], "/sources": ["get"], "/sources/{id}": ["patch"], "/resources": ["get"], "/resources/{id}": ["get", "patch"],
    "/export/assets.ndjson": ["get"], "/scans": ["post"], "/scans/{id}": ["get"], "/scans/{id}/cancel": ["post"], "/scans/{id}/retry": ["post"],
    "/resource-links": ["get"], "/resource-links/{id}": ["patch"], "/service-keys": ["get", "post"], "/service-keys/{id}": ["delete"], "/service-keys/{id}/rotate": ["post"],
    "/tasks": ["get", "post"], "/tasks/{id}": ["get", "patch"], "/tasks/{id}/transition": ["post"], "/tasks/{id}/comments": ["post"], "/tasks/{id}/dependencies": ["post"], "/tasks/gantt": ["get"],
    "/task-people": ["get", "post"], "/task-people/{id}": ["patch"], "/task-milestones": ["get", "post"], "/task-milestones/{id}": ["patch"], "/task-views": ["get", "post"], "/task-views/{id}": ["delete"],
  })) paths[path] = Object.fromEntries(methods.map((method) => [method, { responses: { "200": { description: "Success" } } }]));
  return Response.json({ openapi: "3.1.0", info: { title: "TableAI Administrator API", version: "1.0.0" }, servers: [{ url: `${origin}/api/admin/v1` }], paths }, { headers: { "Cache-Control": "public, max-age=300" } });
}

function serializeAsset(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, metadata: parseJson(row.metadata, {}), tags: parseJson(row.tags, []), ignored: Boolean(row.ignored), pinned: Boolean(row.pinned) };
}
function parseConnector(row: Record<string, unknown>): Record<string, unknown> { return { ...row, enabled: Boolean(row.enabled), config: parseJson(row.config, {}) }; }
function serializeServiceKey(row: Record<string, unknown>): Record<string, unknown> { return { ...row, scopes: parseJson(row.scopes, []), connector_ids: parseJson(row.connector_ids, []), allowed_providers: parseJson(row.allowed_providers, []), allowed_accounts: parseJson(row.allowed_accounts, []) }; }
function parseJson(value: unknown, fallback: unknown): any { try { return JSON.parse(String(value ?? "")); } catch { return fallback; } }
function isPlainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function containsSecretField(value: Record<string, unknown>): boolean { return Object.entries(value).some(([key, nested]) => SECRET_FIELD.test(key) || (isPlainObject(nested) && containsSecretField(nested))); }
function cleanText(value: unknown, max: number): string | null { if (value === null) return null; const text = String(value ?? "").trim(); return text ? text.slice(0, max) : null; }
function normalizeStrings(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 100) : []; }
function normalizeAllowed(value: unknown, allowed: string[]): string[] { return normalizeStrings(value).filter((item) => allowed.includes(item)); }
async function readObject(request: Request): Promise<Record<string, any> | null> { const body = await request.json().catch(() => null); return isPlainObject(body) ? body : null; }
function requestId(request: Request): string { return request.headers.get("CF-Ray") ?? request.headers.get("X-Request-Id") ?? crypto.randomUUID(); }
function v1Data(request: Request, data: unknown, meta: unknown = {}, status = 200): Response { return Response.json({ data, meta: { ...(isPlainObject(meta) ? meta : {}), requestId: requestId(request) } }, { status, headers: { "Cache-Control": "no-store" } }); }
function v1Error(request: Request, code: string, message: string, status: number, details: unknown = null): Response { return Response.json({ error: { code, message, requestId: requestId(request), details } }, { status, headers: { "Cache-Control": "no-store" } }); }
function encodeCursor(value: { updatedAt: string; id: string }): string { return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function decodeCursor(value: string | null): { updatedAt: string; id: string } | null { if (!value) return null; try { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); const parsed = JSON.parse(atob(padded)); return parsed.updatedAt && !Number.isNaN(Date.parse(parsed.updatedAt)) && typeof parsed.id === "string" && parsed.id ? parsed : null; } catch { return null; } }
function audit(env: Env, event: string, payload: unknown, now: string): Promise<D1Result> { return env.MGMT_DB.prepare(`INSERT INTO audit_events(event_type,payload,created_at) VALUES(?1,?2,?3)`).bind(event, JSON.stringify(payload), now).run(); }
