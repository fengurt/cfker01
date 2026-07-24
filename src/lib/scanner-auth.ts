import { hashKey } from "./apikey";

export type ScannerScope = "jobs:poll" | "jobs:claim" | "ingest:write";

export interface ScannerPrincipal {
  id: string;
  name: string;
  scopes: ScannerScope[];
  connectorIds: string[];
  providers: string[];
  accounts: string[];
}

const PREFIX = "tais_";

export function generateScannerKey(): { raw: string; id: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const tail = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const raw = `${PREFIX}${tail}`;
  return { raw, id, prefix: raw.slice(0, 13) };
}

export async function authenticateScanner(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  scope: ScannerScope,
): Promise<{ principal?: ScannerPrincipal; response?: Response }> {
  const requestId = request.headers.get("CF-Ray") ?? crypto.randomUUID();
  const authorization = request.headers.get("Authorization") ?? "";
  const raw = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!raw.startsWith(PREFIX) || !env.API_KEY_SALT) {
    return { response: error("unauthorized", "A scanner service key is required.", 401, requestId) };
  }
  const keyHash = await hashKey(raw, env.API_KEY_SALT);
  const row = await env.MGMT_DB.prepare(`
    SELECT id,name,scopes,connector_ids,allowed_providers,allowed_accounts,expires_at,revoked_at
    FROM scanner_service_keys WHERE key_hash=?1
  `).bind(keyHash).first<Record<string, unknown>>();
  if (!row || row.revoked_at || (row.expires_at && Date.parse(String(row.expires_at)) <= Date.now())) {
    return { response: error("unauthorized", "The scanner service key is invalid, expired, or revoked.", 401, requestId) };
  }
  const scopes = parseArray(row.scopes) as ScannerScope[];
  if (!scopes.includes(scope)) {
    return { response: error("insufficient_scope", `Required scope: ${scope}.`, 403, requestId) };
  }
  const minute = Math.floor(Date.now() / 60_000);
  const rateKey = `ratelimit:scanner:${row.id}:${minute}`;
  const used = Number(await env.MGMT_KV.get(rateKey) ?? "0");
  if (used >= 120) return { response: error("rate_limited", "Scanner request limit exceeded.", 429, requestId) };
  ctx.waitUntil(env.MGMT_KV.put(rateKey, String(used + 1), { expirationTtl: 90 }));
  ctx.waitUntil(env.MGMT_DB.prepare(`UPDATE scanner_service_keys SET last_used_at=?1,updated_at=?1 WHERE id=?2`)
    .bind(new Date().toISOString(), row.id).run());
  return {
    principal: {
      id: String(row.id),
      name: String(row.name),
      scopes,
      connectorIds: parseArray(row.connector_ids),
      providers: parseArray(row.allowed_providers),
      accounts: parseArray(row.allowed_accounts),
    },
  };
}

export function scannerCanUse(principal: ScannerPrincipal, connector: Record<string, unknown>): boolean {
  const connectorId = String(connector.connector_id ?? connector.id);
  const connectorAllowed = principal.connectorIds.length === 0 || principal.connectorIds.includes(connectorId);
  const providerAllowed = principal.providers.length === 0 || principal.providers.includes("*") || principal.providers.includes(String(connector.provider));
  const account = String(connector.account_id);
  const accountAllowed = principal.accounts.length === 0 || principal.accounts.includes("*") || principal.accounts.includes(account);
  return connectorAllowed && providerAllowed && accountAllowed;
}

function parseArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function error(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message, requestId, details: null } }, {
    status,
    headers: { "Cache-Control": "no-store", "WWW-Authenticate": 'Bearer realm="tableai-scanner"' },
  });
}
