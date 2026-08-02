import { logEvent } from "./logger";

export type ApiScope = "read" | "write" | "admin" | "skills:write" | "tasks:read" | "tasks:write";

const KEY_PREFIX = "cfk_";
const KEY_ID_LEN = 8;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ApiKeyRecord {
  id: string;
  scopes: ApiScope[];
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(buf);
}

export async function hashKey(rawKey: string, salt: string): Promise<string> {
  return sha256Hex(rawKey + salt);
}

export function generateApiKey(): { raw: string; id: string } {
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const tail = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const id = tail.slice(0, KEY_ID_LEN);
  return { raw: `${KEY_PREFIX}${id}${tail}`, id };
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX);
}

export async function lookupKey(
  env: Env,
  rawKey: string,
): Promise<ApiKeyRecord | null> {
  const salt = env.API_KEY_SALT;
  if (!salt) return null;
  const hash = await hashKey(rawKey, salt);
  const row = await env.MGMT_DB.prepare(
    `SELECT id, hash, scopes, revoked_at FROM api_keys WHERE hash = ?1`,
  )
    .bind(hash)
    .first<{ id: string; hash: string; scopes: string; revoked_at: string | null }>();

  if (!row || row.revoked_at) return null;

  const scopes = row.scopes.split(",").map((s) => s.trim()).filter(Boolean) as ApiScope[];
  return { id: row.id, scopes };
}

export async function requireApiKey(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  scope: ApiScope = "read",
): Promise<Response | null> {
  const supplied = request.headers.get("X-Api-Key");
  if (!supplied) {
    return Response.json(
      { error: "missing_api_key" },
      { status: 401, headers: { "WWW-Authenticate": 'ApiKey realm="cfker01"' } },
    );
  }
  if (!looksLikeApiKey(supplied)) {
    return Response.json({ error: "invalid_api_key_format" }, { status: 401 });
  }

  const record = await lookupKey(env, supplied);
  if (!record || !record.scopes.includes(scope)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Per-key rate limit: 60 req/min, KV counter
  const minute = Math.floor(Date.now() / 60_000).toString();
  const rlKey = `ratelimit:key:${record.id}:${minute}`;
  const current = Number((await env.MGMT_KV.get(rlKey)) ?? "0");
  if (current >= 60) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  ctx.waitUntil(env.MGMT_KV.put(rlKey, String(current + 1), { expirationTtl: 90 }));

  ctx.waitUntil(
    env.MGMT_DB.prepare(`UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2`)
      .bind(new Date().toISOString(), record.id)
      .run(),
  );

  logEvent("debug", "api_key.used", { id: record.id, scope });
  return null;
}
