export const API_PROVIDER_IDS = [
  "doubao-ark",
  "minimax-api",
  "minimax-coding-plan",
  "openai",
  "perplexity",
  "moonshot",
  "gemini",
] as const;

type ApiProviderId = (typeof API_PROVIDER_IDS)[number];

export const API_PROVIDER_OFFICIAL_LINKS: Record<ApiProviderId, { subscriptionUrl: string; documentationUrl: string }> = {
  "doubao-ark": {
    subscriptionUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/model",
    documentationUrl: "https://www.volcengine.com/docs/82379/1795150?lang=zh",
  },
  "minimax-api": {
    subscriptionUrl: "https://platform.minimaxi.com/console/recharge-records",
    documentationUrl: "https://platform.minimaxi.com/docs/api-reference/api-overview",
  },
  "minimax-coding-plan": {
    subscriptionUrl: "https://platform.minimaxi.com/console/plan",
    documentationUrl: "https://platform.minimaxi.com/docs/token-plan/quickstart",
  },
  openai: {
    subscriptionUrl: "https://platform.openai.com/settings/organization/billing/overview",
    documentationUrl: "https://developers.openai.com/api/docs/quickstart",
  },
  perplexity: {
    subscriptionUrl: "https://console.perplexity.ai/",
    documentationUrl: "https://docs.perplexity.ai/docs/getting-started/quickstart",
  },
  moonshot: {
    subscriptionUrl: "https://platform.moonshot.cn/console",
    documentationUrl: "https://platform.moonshot.cn/docs/intro",
  },
  gemini: {
    subscriptionUrl: "https://aistudio.google.com/app/billing",
    documentationUrl: "https://ai.google.dev/gemini-api/docs/get-started",
  },
};

export type ApiProviderStatus = "healthy" | "degraded" | "down" | "stale" | "unconfigured" | "unknown";
const STATUS_VALUES = new Set<ApiProviderStatus>(["healthy", "degraded", "down", "stale", "unconfigured", "unknown"]);
const CHECK_KINDS = new Set(["auth", "models", "quota", "inference"]);
const SECRET_FIELD = /(secret|token|password|private.?key|api.?key|authorization|^credential$)/i;

export function containsSecretShapedField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretShapedField);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => SECRET_FIELD.test(key) || containsSecretShapedField(nested));
}

export async function listApiProviders(env: Env): Promise<Record<string, unknown>[]> {
  const result = await env.MGMT_DB.prepare(`
    SELECT c.*,
      (SELECT latency_ms FROM api_provider_probe_events e WHERE e.connector_id=c.id ORDER BY e.observed_at DESC LIMIT 1) latency_ms,
      (SELECT model FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.model IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) model,
      (SELECT model_count FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='models' AND e.model_count IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) model_count,
      (SELECT model_catalog_json FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.model_catalog_json IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) model_catalog_json,
      (SELECT quota_summary FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.quota_summary IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) quota_summary,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='auth' ORDER BY e.observed_at DESC LIMIT 1) auth_status,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='models' ORDER BY e.observed_at DESC LIMIT 1) models_status,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='quota' ORDER BY e.observed_at DESC LIMIT 1) quota_status,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='inference' ORDER BY e.observed_at DESC LIMIT 1) inference_status,
      (SELECT observed_at FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='inference' ORDER BY e.observed_at DESC LIMIT 1) inference_observed_at
    FROM api_provider_connectors c ORDER BY c.provider,c.credential_kind,c.id
  `).all<Record<string, unknown>>();
  return (result.results ?? []).map(serializeConnector);
}

export async function getApiProvider(env: Env, id: string): Promise<Record<string, unknown> | null> {
  const row = await env.MGMT_DB.prepare(`
    SELECT c.*,
      (SELECT latency_ms FROM api_provider_probe_events e WHERE e.connector_id=c.id ORDER BY e.observed_at DESC LIMIT 1) latency_ms,
      (SELECT model FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.model IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) model,
      (SELECT model_count FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='models' AND e.model_count IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) model_count,
      (SELECT model_catalog_json FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.model_catalog_json IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) model_catalog_json,
      (SELECT quota_summary FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.quota_summary IS NOT NULL ORDER BY e.observed_at DESC LIMIT 1) quota_summary,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='auth' ORDER BY e.observed_at DESC LIMIT 1) auth_status,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='models' ORDER BY e.observed_at DESC LIMIT 1) models_status,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='quota' ORDER BY e.observed_at DESC LIMIT 1) quota_status,
      (SELECT status FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='inference' ORDER BY e.observed_at DESC LIMIT 1) inference_status,
      (SELECT observed_at FROM api_provider_probe_events e WHERE e.connector_id=c.id AND e.probe_kind='inference' ORDER BY e.observed_at DESC LIMIT 1) inference_observed_at
    FROM api_provider_connectors c WHERE c.id=?1
  `).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const events = await env.MGMT_DB.prepare(`
    SELECT probe_kind,status,http_status,latency_ms,model,model_count,model_catalog_json,quota_summary,error_code,observed_at
    FROM api_provider_probe_events e
    WHERE connector_id=?1 AND observed_at=(
      SELECT MAX(e2.observed_at) FROM api_provider_probe_events e2
      WHERE e2.connector_id=e.connector_id AND e2.probe_kind=e.probe_kind
    )
    ORDER BY observed_at DESC
  `).bind(id).all<Record<string, unknown>>();
  const checks: Record<string, unknown> = {};
  for (const event of events.results ?? []) if (!(String(event.probe_kind) in checks)) checks[String(event.probe_kind)] = serializeEvent(event);
  return { ...serializeConnector(row), checks };
}

export async function getApiProviderHistory(env: Env, id: string, limit = 100): Promise<Record<string, unknown>[]> {
  const events = await env.MGMT_DB.prepare(`SELECT probe_kind,status,http_status,latency_ms,model,model_count,model_catalog_json,quota_summary,error_code,observed_at FROM api_provider_probe_events WHERE connector_id=?1 ORDER BY observed_at DESC LIMIT ?2`).bind(id, Math.min(500, Math.max(1, limit))).all<Record<string, unknown>>();
  return (events.results ?? []).map(serializeEvent);
}

export async function queueApiProviderProbe(env: Env, connectorId: string, mode: "standard" | "inference", idempotencyKey: string | null, requestedBy: string): Promise<Record<string, unknown> | null> {
  const connector = await env.MGMT_DB.prepare(`SELECT id FROM api_provider_connectors WHERE id=?1 AND enabled=1`).bind(connectorId).first();
  if (!connector) return null;
  if (idempotencyKey) {
    const existing = await env.MGMT_DB.prepare(`SELECT id,connector_id,mode,status,queued_at FROM api_provider_probe_jobs WHERE connector_id=?1 AND idempotency_key=?2`).bind(connectorId, idempotencyKey).first<Record<string, unknown>>();
    if (existing) return existing;
  }
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.MGMT_DB.prepare(`INSERT INTO api_provider_probe_jobs(id,connector_id,mode,status,idempotency_key,requested_by,queued_at,created_at,updated_at) VALUES(?1,?2,?3,'queued',?4,?5,?6,?6,?6)`).bind(id, connectorId, mode, idempotencyKey, requestedBy, now).run();
  return { id, connector_id: connectorId, mode, status: "queued", queued_at: now };
}

export async function ingestApiProviderProbe(env: Env, input: Record<string, unknown>, requestId: string): Promise<{ data?: Record<string, unknown>; replay?: boolean; error?: string }> {
  if (containsSecretShapedField(input)) return { error: "secret_field_rejected" };
  const runId = clean(input.runId, 200), connectorId = clean(input.connectorId, 100), observedAt = clean(input.observedAt, 50);
  if (!runId || !connectorId || !observedAt || Number.isNaN(Date.parse(observedAt))) return { error: "invalid_probe" };
  const connector = await env.MGMT_DB.prepare(`SELECT id,consecutive_failures FROM api_provider_connectors WHERE id=?1`).bind(connectorId).first<{ id: string; consecutive_failures: number }>();
  if (!connector) return { error: "unknown_connector" };
  const existing = await env.MGMT_DB.prepare(`SELECT id FROM api_provider_probe_runs WHERE connector_id=?1 AND run_id=?2`).bind(connectorId, runId).first<{ id: string }>();
  if (existing) return { data: { id: existing.id, connectorId, runId }, replay: true };
  const checks = Array.isArray(input.checks) ? input.checks : [];
  if (!checks.length || checks.length > 4) return { error: "invalid_checks" };
  const credentialStatus = clean(input.credentialStatus, 30) ?? "unknown";
  const requestedStatus = statusValue(input.overallStatus);
  const normalizedChecks: Record<string, unknown>[] = [];
  for (const raw of checks) {
    if (!raw || typeof raw !== "object" || containsSecretShapedField(raw)) return { error: "secret_field_rejected" };
    const check = raw as Record<string, unknown>, kind = clean(check.kind, 30), status = statusValue(check.status);
    if (!kind || !CHECK_KINDS.has(kind)) return { error: "invalid_check_kind" };
    const modelCatalog = Array.isArray(check.modelCatalog)
      ? [...new Set(check.modelCatalog.map((item) => clean(item, 200)).filter((item): item is string => Boolean(item)))].slice(0, 500)
      : [];
    normalizedChecks.push({ kind, status, httpStatus: boundedNumber(check.httpStatus, 100, 599), latencyMs: boundedNumber(check.latencyMs, 0, 600_000), model: clean(check.model, 200), modelCount: boundedNumber(check.modelCount, 0, 100_000), modelCatalog, quotaSummary: clean(check.quotaSummary, 500), errorCode: clean(check.errorCode, 100) });
  }
  const failure = normalizedChecks.some((check) => check.status === "down"), previousFailures = Number(connector.consecutive_failures ?? 0);
  const immediate = normalizedChecks.some((check) => [401, 403].includes(Number(check.httpStatus)));
  const rateLimited = normalizedChecks.some((check) => Number(check.httpStatus) === 429 || check.errorCode === "insufficient_balance");
  const overallStatus: ApiProviderStatus = immediate ? "down" : rateLimited ? "degraded" : failure && previousFailures + 1 < 3 ? "degraded" : requestedStatus;
  const consecutiveFailures = overallStatus === "healthy" ? 0 : failure ? previousFailures + 1 : previousFailures;
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const mode = clean(input.mode, 20) === "inference" ? "inference" : "standard";
  const statements: D1PreparedStatement[] = [
    env.MGMT_DB.prepare(`INSERT INTO api_provider_probe_runs(id,connector_id,run_id,mode,credential_status,overall_status,observed_at,request_id,error_code,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(id, connectorId, runId, mode, credentialStatus, overallStatus, observedAt, requestId, clean(input.errorCode, 100), now),
  ];
  for (const check of normalizedChecks) statements.push(env.MGMT_DB.prepare(`INSERT INTO api_provider_probe_events(id,probe_run_id,connector_id,probe_kind,status,http_status,latency_ms,model,model_count,model_catalog_json,quota_summary,error_code,observed_at,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`).bind(crypto.randomUUID(), id, connectorId, check.kind, check.status, check.httpStatus, check.latencyMs, check.model, check.modelCount, Array.isArray(check.modelCatalog) && check.modelCatalog.length ? JSON.stringify(check.modelCatalog) : null, check.quotaSummary, check.errorCode, observedAt, now));
  const nextDueAt = new Date(Date.parse(observedAt) + 4 * 60 * 60 * 1000).toISOString(), staleAt = new Date(Date.parse(observedAt) + 6 * 60 * 60 * 1000).toISOString();
  const credentialExpiresAt = optionalIso(input.credentialExpiresAt), credentialExpirySource = credentialExpiresAt ? clean(input.credentialExpirySource, 50) : null;
  const subscriptionExpiresAt = optionalIso(input.subscriptionExpiresAt), subscriptionExpirySource = subscriptionExpiresAt ? clean(input.subscriptionExpirySource, 50) : null, quotaResetsAt = optionalIso(input.quotaResetsAt);
  statements.push(env.MGMT_DB.prepare(`UPDATE api_provider_connectors SET credential_status=?1,overall_status=?2,last_checked_at=?3,last_success_at=CASE WHEN ?2='healthy' THEN ?3 ELSE last_success_at END,last_inference_at=CASE WHEN ?4='inference' THEN ?3 ELSE last_inference_at END,next_due_at=?5,stale_at=?6,consecutive_failures=?7,last_error_code=?8,credential_expires_at=COALESCE(?9,credential_expires_at),credential_expiry_source=COALESCE(?10,credential_expiry_source),subscription_expires_at=COALESCE(?11,subscription_expires_at),subscription_expiry_source=COALESCE(?12,subscription_expiry_source),quota_resets_at=COALESCE(?13,quota_resets_at),updated_at=?14 WHERE id=?15`).bind(credentialStatus, overallStatus, observedAt, mode, nextDueAt, staleAt, consecutiveFailures, clean(input.errorCode, 100), credentialExpiresAt, credentialExpirySource, subscriptionExpiresAt, subscriptionExpirySource, quotaResetsAt, now, connectorId));
  statements.push(env.MGMT_DB.prepare(`UPDATE api_provider_probe_jobs SET status='completed',completed_at=?1,updated_at=?1 WHERE connector_id=?2 AND mode=?3 AND status='claimed'`).bind(now, connectorId, mode));
  await env.MGMT_DB.batch(statements);
  return { data: { id, connectorId, runId, overallStatus, observedAt } };
}

function serializeConnector(row: Record<string, unknown>): Record<string, unknown> {
  const staleAt = row.stale_at ? Date.parse(String(row.stale_at)) : Number.NaN;
  const overallStatus = Number.isFinite(staleAt) && staleAt < Date.now() && row.overall_status !== "unconfigured" ? "stale" : row.overall_status;
  const inferenceAge = row.inference_observed_at ? Date.now() - Date.parse(String(row.inference_observed_at)) : Number.POSITIVE_INFINITY;
  const recordedInferenceStatus = statusValue(row.inference_status);
  const inferenceStatus = row.credential_kind === "subscription" ? "not_applicable"
    : row.credential_status === "unconfigured" ? "unconfigured"
      : !row.inference_observed_at ? "unknown"
        : inferenceAge > 30 * 60 * 60 * 1000 ? "stale"
          : recordedInferenceStatus;
  const defaultCheck = row.credential_status === "unconfigured" ? "unconfigured" : "unknown";
  const officialLinks = API_PROVIDER_OFFICIAL_LINKS[String(row.id) as ApiProviderId] ?? null;
  const credentialExpiresAt = row.credential_expires_at ?? null, subscriptionExpiresAt = row.subscription_expires_at ?? null, quotaResetsAt = row.quota_resets_at ?? null, modelCatalog = parseStringArray(row.model_catalog_json);
  return { id: row.id, provider: row.provider, accountLabel: row.account_label, credentialType: row.credential_kind, enabled: Boolean(row.enabled), credentialStatus: row.credential_status, validity: { credential: { status: credentialExpiresAt ? "known" : "unknown", expiresAt: credentialExpiresAt, source: row.credential_expiry_source ?? null }, subscription: { status: subscriptionExpiresAt ? "known" : "unknown", expiresAt: subscriptionExpiresAt, source: row.subscription_expiry_source ?? null }, quota: { resetsAt: quotaResetsAt } }, credentialExpiry: { status: credentialExpiresAt ? "known" : "unknown", expiresAt: credentialExpiresAt, source: row.credential_expiry_source ?? null }, overallStatus, checks: { auth: row.auth_status ?? defaultCheck, models: row.models_status ?? defaultCheck, quota: row.quota_status ?? defaultCheck, inference: row.credential_kind === "subscription" ? "not_applicable" : inferenceStatus }, inferenceStatus, latencyMs: row.latency_ms == null ? null : Number(row.latency_ms), model: row.model ?? null, modelCatalog, modelCount: row.model_count == null ? modelCatalog.length : Number(row.model_count), quotaSummary: row.quota_summary ?? null, lastCheckedAt: row.last_checked_at ?? null, lastInferenceAt: row.last_inference_at ?? null, nextDueAt: row.next_due_at ?? null, staleAt: row.stale_at ?? null, errorCode: row.last_error_code ?? null, officialLinks };
}

function serializeEvent(row: Record<string, unknown>): Record<string, unknown> {
  return { kind: row.probe_kind, status: row.status, httpStatus: row.http_status == null ? null : Number(row.http_status), latencyMs: row.latency_ms == null ? null : Number(row.latency_ms), model: row.model ?? null, modelCount: row.model_count == null ? null : Number(row.model_count), modelCatalog: parseStringArray(row.model_catalog_json), quotaSummary: row.quota_summary ?? null, errorCode: row.error_code ?? null, observedAt: row.observed_at };
}
function clean(value: unknown, max: number): string | null { const text = String(value ?? "").trim(); return text ? text.slice(0, max) : null; }
function optionalIso(value: unknown): string | null { const text = clean(value, 50); return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : null; }
function parseStringArray(value: unknown): string[] { try { const parsed = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed.map(String).slice(0, 500) : []; } catch { return []; } }
function boundedNumber(value: unknown, min: number, max: number): number | null { if (value == null || value === "") return null; const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null; }
function statusValue(value: unknown): ApiProviderStatus { const status = String(value ?? "unknown") as ApiProviderStatus; return STATUS_VALUES.has(status) ? status : "unknown"; }
