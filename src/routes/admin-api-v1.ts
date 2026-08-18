import { isValidRequestOrigin, readAdminSession, requireAdminRole, requireRecentAdminAuth } from "../lib/auth";
import { hashKey } from "../lib/apikey";
import { createScanJob, ensureDueScanJobs } from "../lib/scan-jobs";
import { generateScannerKey } from "../lib/scanner-auth";
import { createResourceSnapshot, latestResourceSnapshot } from "../lib/resource-snapshot";
import { getIncident, listIncidents, openIncident, updateIncident } from "../lib/incident-store";
import type { IncidentSeverity } from "../lib/incidents";
import { rankPlacement } from "../lib/placement";
import { getApiProvider, getApiProviderHistory, listApiProviders, queueApiProviderProbe } from "../lib/api-provider-monitor";
import { createAssetMapVersion, deleteAssetMapEdge, getAssetMap, getAssetMapVersion, listAssetMapVersions, restoreAssetMapVersion, upsertAssetMapAnnotation, upsertAssetMapEdge, type AssetMapActor } from "../lib/asset-map";

const SECRET_FIELD = /(secret|token|password|credential|private.?key|api.?key)/i;

export async function handleAdminApiV1(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).slice(3);
  const [resource, id, action] = parts;
  const requiredRole = adminApiRole(request, resource, id, action);
  const auth = requiredRole === "system_admin"
    ? await requireAdminRole(request, env, "system_admin")
    : await requireAdminRole(request, env, requiredRole);
  if (auth) {
    const status = auth.status === 403 ? 403 : 401;
    return v1Error(request, status === 403 ? "forbidden" : "unauthorized", status === 403 ? "This role cannot perform the requested operation." : "Administrator authentication is required.", status);
  }
  if (!["GET", "HEAD"].includes(request.method) && request.headers.has("Cookie") && !isValidRequestOrigin(request)) {
    return v1Error(request, "invalid_origin", "The request origin is not allowed.", 403);
  }
  try {
    if (resource === "openapi.json" && request.method === "GET") return openApi(request);
    if (resource === "asset-map") return assetMapApi(request, env, parts, url);
    if (resource === "overview" && request.method === "GET") return overview(request, env);
    if (resource === "api-providers") {
      if (!id && request.method === "GET") return apiProviders(request, env);
      if (id && action === "history" && request.method === "GET") return apiProviderHistory(request, env, id, url);
      if (id && action === "probe" && request.method === "POST") return createApiProviderProbe(request, env, id);
      if (id && !action && request.method === "GET") return apiProvider(request, env, id);
    }
    if (resource === "repository-audit") {
      if (id === "runs" && request.method === "GET") return repositoryAuditRuns(request, env);
      if (id === "repositories" && request.method === "GET") return repositoryAuditRepositories(request, env, url);
      if (id === "repositories" && action && request.method === "GET") return repositoryAuditRepository(request, env, action);
    }
    if (resource === "deployment-evidence" && request.method === "GET") return deploymentEvidence(request, env);
    if (resource === "server-status" && request.method === "GET") return serverStatus(request, env);
    if (resource === "audit" && id === "export.ndjson" && request.method === "GET") return exportRepositoryAudit(env);
    if (resource === "resource-snapshots") {
      if (id === "current" && request.method === "GET") return currentResourceSnapshot(request, env);
      if (!id && request.method === "POST") return generateResourceSnapshot(request, env, ctx);
    }
    if (resource === "deployment-requirements" && id) {
      if (request.method === "GET") return deploymentRequirements(request, env, id);
      if (request.method === "PATCH") return patchDeploymentRequirements(request, env, id, ctx);
    }
    if (resource === "placement-recommendations" && id && request.method === "GET") return placementRecommendations(request, env, id);
    if (resource === "incidents") {
      if (!id && request.method === "GET") return incidents(request, env, url);
      if (!id && request.method === "POST") return createIncident(request, env, ctx);
      if (id && request.method === "GET") return incidentDetail(request, env, id);
      if (id && request.method === "PATCH") return patchIncident(request, env, id);
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
      if (!["GET", "HEAD"].includes(request.method)) {
        const fresh = await requireRecentAdminAuth(request, env);
        if (fresh) return v1Error(request, "reauthentication_required", "Password verification is required for service-key changes.", 401);
      }
      if (!id && request.method === "POST") return createServiceKey(request, env, ctx);
      if (id && action === "rotate" && request.method === "POST") return rotateServiceKey(request, env, ctx, id);
      if (id && request.method === "DELETE") return revokeServiceKey(request, env, ctx, id);
    }
    return v1Error(request, "not_found", "Administrator API endpoint not found.", 404);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown_error";
    if (message === "connector_not_found_or_disabled") return v1Error(request, message, "Connector not found or disabled.", 404);
    if (["entity_id_required", "invalid_asset_map_edge"].includes(message)) return v1Error(request, message, "The asset-map mutation is invalid.", 400);
    if (message === "asset_map_node_not_found") return v1Error(request, message, "One or more asset-map nodes do not exist.", 404);
    if (message === "incompatible_asset_map_version") return v1Error(request, message, "The selected asset-map version uses an incompatible schema.", 409);
    if (message === "asset_map_restore_too_large") return v1Error(request, message, "The selected manual layer is too large for an atomic restore.", 413);
    console.error(JSON.stringify({ event: "admin_api.error", requestId: requestId(request), path: url.pathname, error: message }));
    return v1Error(request, "internal_error", "The request could not be completed.", 500);
  }
}

function adminApiRole(request: Request, resource: string | undefined, _id: string | undefined, _action: string | undefined): "viewer" | "operator" | "system_admin" {
  if (resource === "service-keys") return "system_admin";
  if (request.method === "GET" || request.method === "HEAD") return "viewer";
  if (resource === "openapi.json") return "viewer";
  // Operational mutations are intentionally operator-only. Editors can still
  // use read APIs and the existing editor-facing task workspace.
  return "operator";
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

async function assetMapApi(request: Request, env: Env, parts: string[], url: URL): Promise<Response> {
  const [, section, value, operation] = parts;
  if (!section && request.method === "GET") {
    const map = await getAssetMap(env);
    const kind = cleanText(url.searchParams.get("kind"), 40);
    const status = cleanText(url.searchParams.get("status"), 80);
    const q = cleanText(url.searchParams.get("q"), 200)?.toLocaleLowerCase();
    const nodes = map.nodes.filter((node) => (!kind || node.kind === kind) && (!status || node.status === status) && (!q || `${node.label} ${JSON.stringify(node.metadata)} ${node.annotation?.notes ?? ""}`.toLocaleLowerCase().includes(q)));
    const ids = new Set(nodes.map((node) => node.id));
    return v1Data(request, { ...map, nodes, edges: map.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) }, { totalNodes: map.nodes.length, filteredNodes: nodes.length, totalEdges: map.edges.length });
  }
  if (section === "versions" && !value && request.method === "GET") return v1Data(request, await listAssetMapVersions(env, Number(url.searchParams.get("limit") ?? 50)));
  if (section === "versions" && !value && request.method === "POST") {
    const body = await readObject(request) ?? {};
    return v1Data(request, await createAssetMapVersion(env, await assetMapActor(request, env), "manual", cleanText(body.summary, 500), true), {}, 201);
  }
  if (section === "versions" && value && !operation && request.method === "GET") {
    const version = await getAssetMapVersion(env, value);
    if (!version) return v1Error(request, "not_found", "Asset-map version not found.", 404);
    if (url.searchParams.get("download") === "1") return Response.json(version, { headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename=asset-map-${String(version.version)}.json` } });
    return v1Data(request, version);
  }
  if (section === "versions" && value && operation === "restore" && request.method === "POST") {
    const restored = await restoreAssetMapVersion(env, value, await assetMapActor(request, env));
    return restored ? v1Data(request, restored, {}, 201) : v1Error(request, "not_found", "Asset-map version not found.", 404);
  }
  if (section === "annotations" && !value && request.method === "PUT") {
    const body = await readObject(request);
    if (!body) return v1Error(request, "invalid_json", "A JSON object is required.", 400);
    return v1Data(request, await upsertAssetMapAnnotation(env, body, await assetMapActor(request, env)));
  }
  if (section === "edges" && !value && request.method === "PUT") {
    const body = await readObject(request);
    if (!body) return v1Error(request, "invalid_json", "A JSON object is required.", 400);
    return v1Data(request, await upsertAssetMapEdge(env, body, await assetMapActor(request, env)));
  }
  if (section === "edges" && value && request.method === "DELETE") {
    return await deleteAssetMapEdge(env, value, await assetMapActor(request, env)) ? new Response(null, { status: 204 }) : v1Error(request, "not_found", "Manual asset-map relation not found.", 404);
  }
  return v1Error(request, "not_found", "Asset-map API endpoint not found.", 404);
}

async function assetMapActor(request: Request, env: Env): Promise<AssetMapActor> {
  const session = await readAdminSession(request, env);
  return { type: "admin", id: session?.userId ?? "admin_token" };
}

async function apiProviders(request: Request, env: Env): Promise<Response> {
  const providers = await listApiProviders(env);
  return v1Data(request, providers, { count: providers.length, generatedAt: new Date().toISOString() });
}

async function apiProvider(request: Request, env: Env, id: string): Promise<Response> {
  const provider = await getApiProvider(env, id);
  return provider ? v1Data(request, provider) : v1Error(request, "not_found", "API provider connector not found.", 404);
}

async function apiProviderHistory(request: Request, env: Env, id: string, url: URL): Promise<Response> {
  if (!(await getApiProvider(env, id))) return v1Error(request, "not_found", "API provider connector not found.", 404);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
  return v1Data(request, await getApiProviderHistory(env, id, limit), { limit });
}

async function createApiProviderProbe(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readObject(request) ?? {};
  const mode = body.mode === "inference" ? "inference" : "standard";
  if (mode === "inference") {
    const fresh = await requireRecentAdminAuth(request, env);
    if (fresh) return v1Error(request, "reauthentication_required", "Password verification is required for paid inference probes.", 401);
  }
  const session = await readAdminSession(request, env);
  const job = await queueApiProviderProbe(env, id, mode, cleanText(request.headers.get("Idempotency-Key"), 200), session?.userId ?? "admin_token");
  return job ? v1Data(request, job, undefined, 202) : v1Error(request, "not_found", "API provider connector not found or disabled.", 404);
}

async function repositoryAuditRuns(request: Request, env: Env): Promise<Response> {
  const rows = await env.MGMT_DB.prepare(`SELECT * FROM repository_scan_runs ORDER BY started_at DESC LIMIT 100`).all<Record<string, unknown>>();
  return v1Data(request, rows.results ?? [], { count: rows.results?.length ?? 0 });
}

async function repositoryAuditRepositories(request: Request, env: Env, url: URL): Promise<Response> {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) return v1Error(request, "invalid_query", "limit and offset must be integers.", 400);
  const values: unknown[] = [], where: string[] = [];
  for (const [key, column] of [["sync_status", "sync_status"], ["deployment_status", "deployment_status"]] as const) {
    const value = cleanText(url.searchParams.get(key), 80); if (value) { values.push(value); where.push(`${column}=?${values.length}`); }
  }
  const q = cleanText(url.searchParams.get("q"), 200); if (q) { values.push(`%${q}%`); where.push(`canonical_key LIKE ?${values.length}`); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.MGMT_DB.prepare(`SELECT id,project_id,canonical_key,github_owner,github_repo,repository_url,local_paths,head_sha,branch,dirty,ahead,behind,default_branch,pushed_at,visibility,archived,fork,ci_status,release_name,topics,sync_status,hygiene,deployment_status,deployment_evidence,last_scanned_at,updated_at FROM repository_snapshots ${clause} ORDER BY updated_at DESC,canonical_key LIMIT ?${values.length + 1} OFFSET ?${values.length + 2}`).bind(...values, limit, offset).all<Record<string, unknown>>();
  const total = await env.MGMT_DB.prepare(`SELECT COUNT(*) count FROM repository_snapshots ${clause}`).bind(...values).first<{ count: number }>();
  return v1Data(request, (rows.results ?? []).map(serializeRepositorySnapshot), { limit, offset, total: Number(total?.count ?? 0), hasMore: offset + (rows.results?.length ?? 0) < Number(total?.count ?? 0) });
}

async function repositoryAuditRepository(request: Request, env: Env, id: string): Promise<Response> {
  const snapshot = await env.MGMT_DB.prepare(`SELECT * FROM repository_snapshots WHERE id=?1 OR canonical_key=?1`).bind(id).first<Record<string, unknown>>();
  if (!snapshot) return v1Error(request, "not_found", "Repository audit record not found.", 404);
  const [reviews, candidates] = await Promise.all([
    env.MGMT_DB.prepare(`SELECT * FROM repository_reviews WHERE snapshot_id=?1 ORDER BY reviewed_at DESC LIMIT 20`).bind(snapshot.id).all(),
    env.MGMT_DB.prepare(`SELECT * FROM repository_review_candidates WHERE snapshot_id=?1 AND status='pending' ORDER BY created_at DESC`).bind(snapshot.id).all(),
  ]);
  return v1Data(request, { snapshot: serializeRepositorySnapshot(snapshot), reviews: reviews.results ?? [], candidates: candidates.results ?? [] });
}

async function deploymentEvidence(request: Request, env: Env): Promise<Response> {
  const rows = await env.MGMT_DB.prepare(`SELECT r.id,r.canonical_key,r.repository_url,r.head_sha,r.sync_status,r.deployment_status,r.deployment_evidence,r.last_scanned_at,r.project_id,p.name project_name,d.id deployment_id,d.environment,d.deployed_url,d.version,d.status deployment_runtime_status,d.deployed_at,d.last_checked_at,d.last_latency_ms,d.last_error,s.name server_name,s.status server_status,s.health_status server_health_status FROM repository_snapshots r LEFT JOIN catalog_projects p ON p.id=r.project_id LEFT JOIN deployments d ON d.project_id=r.project_id LEFT JOIN servers s ON s.id=d.server_id ORDER BY r.updated_at DESC`).all<Record<string, unknown>>();
  return v1Data(request, (rows.results ?? []).map((row) => ({ ...row, deploymentEvidence: parseJson(row.deployment_evidence, []) })));
}

async function serverStatus(request: Request, env: Env): Promise<Response> {
  const rows = await env.MGMT_DB.prepare(`SELECT s.*, (SELECT COUNT(*) FROM deployments d WHERE d.server_id=s.id) deployment_count, (SELECT COUNT(*) FROM discovered_assets a WHERE a.server_id=s.id AND a.kind IN ('runtime_container','container') AND a.status!='stale') container_count, (SELECT COUNT(*) FROM discovered_assets a WHERE a.server_id=s.id AND a.kind IN ('runtime_service','compose_project') AND a.status!='stale') service_count, (SELECT MAX(last_seen_at) FROM discovered_assets a WHERE a.server_id=s.id AND a.kind='server_runtime') runtime_seen_at FROM servers s ORDER BY deployment_count ASC,s.name`).all<Record<string, unknown>>();
  const now = Date.now();
  return v1Data(request, (rows.results ?? []).map((row) => {
    const runtimeSeen = row.runtime_seen_at ? Date.parse(String(row.runtime_seen_at)) : NaN;
    const runtimeFresh = Number.isFinite(runtimeSeen) && now - runtimeSeen <= 15 * 60 * 1000;
    return { ...row, runtimeFresh, availability: row.health_status === "healthy" && runtimeFresh ? "healthy" : row.health_status === "down" ? "down" : runtimeFresh ? "degraded" : "stale" };
  }), { generatedAt: new Date().toISOString(), freshnessMinutes: 15 });
}

function exportRepositoryAudit(env: Env): Response {
  const encoder = new TextEncoder(); let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
    const rows = await env.MGMT_DB.prepare(`SELECT * FROM repository_snapshots ORDER BY canonical_key LIMIT 200 OFFSET ?1`).bind(offset).all<Record<string, unknown>>();
    const values = rows.results ?? []; if (!values.length) { controller.close(); return; }
    controller.enqueue(encoder.encode(values.map((row) => JSON.stringify(serializeRepositorySnapshot(row))).join("\n") + "\n")); offset += values.length;
  }});
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": "attachment; filename=repository-audit.ndjson", "Cache-Control": "no-store" } });
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

async function deploymentRequirements(request: Request, env: Env, projectId: string): Promise<Response> {
  const project = await env.MGMT_DB.prepare(`SELECT id,name,lifecycle FROM catalog_projects WHERE id=?1`).bind(projectId).first<Record<string, unknown>>();
  if (!project) return v1Error(request, "not_found", "Project not found.", 404);
  const row = await env.MGMT_DB.prepare(`SELECT * FROM project_deployment_requirements WHERE project_id=?1`).bind(projectId).first<Record<string, unknown>>();
  return v1Data(request, { project, requirements: row ? serializeRequirements(row) : null });
}

async function patchDeploymentRequirements(request: Request, env: Env, projectId: string, ctx: ExecutionContext): Promise<Response> {
  const body = await readObject(request);
  if (!body) return v1Error(request, "invalid_json", "A JSON object is required.", 400);
  const project = await env.MGMT_DB.prepare(`SELECT id FROM catalog_projects WHERE id=?1`).bind(projectId).first();
  if (!project) return v1Error(request, "not_found", "Project not found.", 404);
  const current = await env.MGMT_DB.prepare(`SELECT * FROM project_deployment_requirements WHERE project_id=?1`).bind(projectId).first<Record<string, unknown>>();
  const numberField = (key: string) => body[key] === undefined ? (current?.[key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)] ?? null) : body[key] == null ? null : Number(body[key]);
  const architecture = body.architecture === undefined ? current?.architecture ?? null : cleanText(body.architecture, 40);
  const runtime = body.runtime === undefined ? current?.runtime ?? null : cleanText(body.runtime, 80);
  const minCpu = numberField("minCpu");
  const minMemoryMb = numberField("minMemoryMb");
  const minDiskGb = numberField("minDiskGb");
  if ([minCpu, minMemoryMb, minDiskGb].some((value) => value != null && (!Number.isFinite(Number(value)) || Number(value) < 0))) return v1Error(request, "invalid_requirements", "Capacity requirements must be non-negative numbers.", 400);
  const now = new Date().toISOString();
  const values = [architecture, runtime, minCpu, minMemoryMb, minDiskGb, body.stateful === undefined ? Number(current?.stateful ?? 0) : body.stateful ? 1 : 0, body.requiredRegion === undefined ? current?.required_region ?? null : cleanText(body.requiredRegion, 100), JSON.stringify(normalizeStrings(body.networkRequirements ?? parseJson(current?.network_requirements, []))), JSON.stringify(normalizeStrings(body.storageRequirements ?? parseJson(current?.storage_requirements, []))), body.maxDowntimeMinutes === undefined ? current?.max_downtime_minutes ?? null : body.maxDowntimeMinutes == null ? null : Number(body.maxDowntimeMinutes), body.healthCheckUrl === undefined ? current?.health_check_url ?? null : cleanText(body.healthCheckUrl, 500), body.rollbackStrategy === undefined ? current?.rollback_strategy ?? null : cleanText(body.rollbackStrategy, 500), body.backupPolicy === undefined ? current?.backup_policy ?? null : cleanText(body.backupPolicy, 500), body.criticality === undefined ? current?.criticality ?? "normal" : cleanText(body.criticality, 40), "admin", now];
  if (current) {
    await env.MGMT_DB.prepare(`UPDATE project_deployment_requirements SET architecture=?1,runtime=?2,min_cpu=?3,min_memory_mb=?4,min_disk_gb=?5,stateful=?6,required_region=?7,network_requirements=?8,storage_requirements=?9,max_downtime_minutes=?10,health_check_url=?11,rollback_strategy=?12,backup_policy=?13,criticality=?14,confirmed_by=?15,confirmed_at=?16,source='admin',version=version+1,updated_at=?16 WHERE project_id=?17`).bind(...values, projectId).run();
  } else {
    await env.MGMT_DB.prepare(`INSERT INTO project_deployment_requirements(project_id,architecture,runtime,min_cpu,min_memory_mb,min_disk_gb,stateful,required_region,network_requirements,storage_requirements,max_downtime_minutes,health_check_url,rollback_strategy,backup_policy,criticality,confirmed_by,confirmed_at,source,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,'admin',?17,?17)`).bind(projectId, ...values).run();
  }
  ctx.waitUntil(audit(env, "deployment_requirements.updated", { projectId }, now));
  return deploymentRequirements(request, env, projectId);
}

async function placementRecommendations(request: Request, env: Env, projectId: string): Promise<Response> {
  const requirementRow = await env.MGMT_DB.prepare(`SELECT * FROM project_deployment_requirements WHERE project_id=?1`).bind(projectId).first<Record<string, unknown>>();
  if (!requirementRow) return v1Data(request, { projectId, status: "insufficient_data", candidates: [], excluded: [{ id: projectId, reasons: ["deployment_requirements_missing"] }] });
  const snapshot = await latestResourceSnapshot(env);
  const candidates = (snapshot?.serverPlacement ?? []).map((server) => {
    const capacity = (server.capacity ?? {}) as Record<string, unknown>;
    const runtime = (server.runtime ?? {}) as Record<string, unknown>;
    const placement = (server.placement ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(placement.reasons) ? placement.reasons.map(String) : [];
    return { id: String(server.id), name: String(server.name), status: String(server.status), manualStatus: null, runtimeFresh: Boolean(placement.eligible) || reasons.includes("healthy_recent_runtime_sample"), architecture: server.architecture == null ? null : String(server.architecture), region: server.region == null ? null : String(server.region), vcpu: capacity.vcpu == null ? null : Number(capacity.vcpu), memoryMb: capacity.memoryGiB == null ? null : Number(capacity.memoryGiB) * 1024, diskGb: capacity.diskGiB == null ? null : Number(capacity.diskGiB), pressure: placement.pressure == null ? null : Number(placement.pressure), runtime: runtime.collectedAt == null ? null : String(runtime.collectedAt) };
  });
  const result = rankPlacement(serializeRequirements(requirementRow), candidates);
  return v1Data(request, { projectId, generatedAt: snapshot?.generatedAt ?? null, ...result });
}

async function incidents(request: Request, env: Env, url: URL): Promise<Response> {
  const severity = url.searchParams.get("severity");
  if (severity && !["p0", "p1", "p2", "p3"].includes(severity)) return v1Error(request, "invalid_query", "severity is invalid.", 400);
  const rows = await listIncidents(env, {
    status: url.searchParams.get("status"),
    severity: severity as IncidentSeverity | null,
    projectId: url.searchParams.get("projectId"),
    ownerUserId: url.searchParams.get("ownerUserId"),
    limit: Number(url.searchParams.get("limit") ?? 100),
  });
  return v1Data(request, rows.map(serializeIncident), { count: rows.length });
}

async function createIncident(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readObject(request);
  if (!body || !body.entityType || !body.entityId || !body.check || !body.rootCause || !body.title || !body.summary) return v1Error(request, "invalid_incident", "entityType, entityId, check, rootCause, title, and summary are required.", 400);
  const incident = await openIncident(env, {
    entityType: String(body.entityType),
    entityId: String(body.entityId),
    check: String(body.check),
    rootCause: String(body.rootCause),
    title: String(body.title),
    summary: String(body.summary),
    evidence: normalizeStrings(body.evidence),
    projectId: body.projectId ? String(body.projectId) : null,
    affectedProductionProjects: Number(body.affectedProductionProjects ?? 0),
    productionImpact: Boolean(body.productionImpact),
    dataLoss: Boolean(body.dataLoss),
    security: Boolean(body.security),
    coreConsoleDown: Boolean(body.coreConsoleDown),
    criticalProjectDown: Boolean(body.criticalProjectDown),
    diskExhaustion: Boolean(body.diskExhaustion),
    backupFailure: Boolean(body.backupFailure),
    expiryHours: body.expiryHours == null ? null : Number(body.expiryHours),
    degraded: Boolean(body.degraded),
    versionDrift: Boolean(body.versionDrift),
    stale: Boolean(body.stale),
    missingDescription: Boolean(body.missingDescription),
    lowConfidence: Boolean(body.lowConfidence),
  });
  ctx.waitUntil(audit(env, "incident.opened", { id: incident.id, severity: incident.severity }, new Date().toISOString()));
  return v1Data(request, serializeIncident(incident), undefined, 201);
}

async function incidentDetail(request: Request, env: Env, id: string): Promise<Response> {
  const incident = await getIncident(env, id);
  if (!incident) return v1Error(request, "not_found", "Incident not found.", 404);
  return v1Data(request, serializeIncident(incident));
}

async function patchIncident(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readObject(request);
  const version = Number(body?.version);
  if (!body || !Number.isInteger(version) || version < 1) return v1Error(request, "invalid_version", "version is required for Incident updates.", 400);
  try {
    const incident = await updateIncident(env, id, {
      version,
      status: body.status === undefined ? undefined : String(body.status),
      ownerUserId: body.ownerUserId === undefined ? undefined : body.ownerUserId === null ? null : String(body.ownerUserId),
      severity: body.severity === undefined ? undefined : String(body.severity) as IncidentSeverity,
    });
    if (!incident) return v1Error(request, "not_found", "Incident not found.", 404);
    return v1Data(request, serializeIncident(incident));
  } catch (error) {
    if (error instanceof Error && error.message === "incident_version_conflict") return v1Error(request, "version_conflict", "Incident changed since it was loaded.", 409);
    if (error instanceof Error && error.message === "invalid_incident_status") return v1Error(request, "invalid_status", "Incident status is invalid.", 400);
    if (error instanceof Error && error.message === "invalid_incident_severity") return v1Error(request, "invalid_severity", "Incident severity is invalid.", 400);
    throw error;
  }
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
  const scopes = normalizeAllowed(body?.scopes, ["jobs:poll", "jobs:claim", "ingest:write", "api-probes:write"]);
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
    "/overview": ["get"], "/resource-snapshots/current": ["get"], "/resource-snapshots": ["post"], "/deployment-requirements/{projectId}": ["get", "patch"], "/placement-recommendations/{projectId}": ["get"], "/sources": ["get"], "/sources/{id}": ["patch"], "/resources": ["get"], "/resources/{id}": ["get", "patch"],
    "/export/assets.ndjson": ["get"], "/audit/export.ndjson": ["get"], "/repository-audit/runs": ["get"], "/repository-audit/repositories": ["get"], "/repository-audit/repositories/{id}": ["get"], "/deployment-evidence": ["get"], "/server-status": ["get"], "/scans": ["post"], "/scans/{id}": ["get"], "/scans/{id}/cancel": ["post"], "/scans/{id}/retry": ["post"],
    "/resource-links": ["get"], "/resource-links/{id}": ["patch"], "/incidents": ["get", "post"], "/incidents/{id}": ["get", "patch"], "/service-keys": ["get", "post"], "/service-keys/{id}": ["delete"], "/service-keys/{id}/rotate": ["post"],
    "/api-providers": ["get"], "/api-providers/{id}": ["get"], "/api-providers/{id}/history": ["get"], "/api-providers/{id}/probe": ["post"],
    "/asset-map": ["get"], "/asset-map/versions": ["get", "post"], "/asset-map/versions/{id}": ["get"], "/asset-map/versions/{id}/restore": ["post"], "/asset-map/annotations": ["put"], "/asset-map/edges": ["put"], "/asset-map/edges/{id}": ["delete"],
    "/tasks": ["get", "post"], "/tasks/{id}": ["get", "patch"], "/tasks/{id}/transition": ["post"], "/tasks/{id}/comments": ["post"], "/tasks/{id}/dependencies": ["post"], "/tasks/gantt": ["get"],
    "/task-people": ["get", "post"], "/task-people/{id}": ["patch"], "/task-milestones": ["get", "post"], "/task-milestones/{id}": ["patch"], "/task-views": ["get", "post"], "/task-views/{id}": ["delete"],
  })) paths[path] = Object.fromEntries(methods.map((method) => [method, { responses: { "200": { description: "Success" } } }]));
  return Response.json({ openapi: "3.1.0", info: { title: "TableAI Administrator API", version: "1.0.0" }, servers: [{ url: `${origin}/api/admin/v1` }], paths }, { headers: { "Cache-Control": "public, max-age=300" } });
}

function serializeAsset(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, metadata: parseJson(row.metadata, {}), tags: parseJson(row.tags, []), ignored: Boolean(row.ignored), pinned: Boolean(row.pinned) };
}
function serializeRepositorySnapshot(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, local_paths: parseJson(row.local_paths, []), topics: parseJson(row.topics, []), github_metadata: parseJson(row.github_metadata, {}), scan_evidence: parseJson(row.scan_evidence, []), hygiene: parseJson(row.hygiene, {}), deployment_evidence: parseJson(row.deployment_evidence, []), dirty: Boolean(row.dirty), archived: Boolean(row.archived), fork: Boolean(row.fork) };
}
function parseConnector(row: Record<string, unknown>): Record<string, unknown> { return { ...row, enabled: Boolean(row.enabled), config: parseJson(row.config, {}) }; }
function serializeServiceKey(row: Record<string, unknown>): Record<string, unknown> { return { ...row, scopes: parseJson(row.scopes, []), connector_ids: parseJson(row.connector_ids, []), allowed_providers: parseJson(row.allowed_providers, []), allowed_accounts: parseJson(row.allowed_accounts, []) }; }
function serializeIncident(row: Record<string, unknown>): Record<string, unknown> { return { ...row, evidence: parseJson(row.evidence, []), recurrence_count: Number(row.recurrence_count ?? 0), version: Number(row.version ?? 0) }; }
function serializeRequirements(row: Record<string, unknown>): Record<string, unknown> { return { ...row, stateful: Boolean(row.stateful), networkRequirements: parseJson(row.network_requirements, []), storageRequirements: parseJson(row.storage_requirements, []), minCpu: row.min_cpu == null ? null : Number(row.min_cpu), minMemoryMb: row.min_memory_mb == null ? null : Number(row.min_memory_mb), minDiskGb: row.min_disk_gb == null ? null : Number(row.min_disk_gb), requiredRegion: row.required_region ?? null, maxDowntimeMinutes: row.max_downtime_minutes == null ? null : Number(row.max_downtime_minutes), healthCheckUrl: row.health_check_url ?? null, rollbackStrategy: row.rollback_strategy ?? null, backupPolicy: row.backup_policy ?? null, confirmedBy: row.confirmed_by ?? null, confirmedAt: row.confirmed_at ?? null }; }
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
