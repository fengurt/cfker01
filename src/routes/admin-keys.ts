import { jsonResponse } from "../lib/response";
import { requireAdminToken } from "../lib/auth";
import { generateApiKey, hashKey, type ApiScope } from "../lib/apikey";

interface ApiKeyRow {
  id: string;
  name: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function handleAdminKeys(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authError = await requireAdminToken(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["admin", "keys", id?]

  if (segments[1] === "keys" && segments.length === 2) {
    if (request.method === "GET") return listKeys(env);
    if (request.method === "POST") return createKey(request, env, ctx);
  }
  if (segments[1] === "keys" && segments.length === 3 && request.method === "DELETE") {
    return revokeKey(env, segments[2]);
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function listKeys(env: Env): Promise<Response> {
  const result = await env.MGMT_DB.prepare(
    `SELECT id, name, scopes, created_at, last_used_at, revoked_at
     FROM api_keys ORDER BY created_at DESC`,
  ).all<ApiKeyRow>();
  return jsonResponse({ keys: result.results ?? [] });
}

async function createKey(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let name = "default";
  let scopes: ApiScope[] = ["read"];
  try {
    const body = (await request.json()) as { name?: string; scopes?: ApiScope[] };
    if (body.name) name = body.name;
    if (Array.isArray(body.scopes)) scopes = body.scopes;
  } catch {
    // empty body is fine
  }

  const salt = env.API_KEY_SALT;
  if (!salt) {
    return jsonResponse({ error: "api_key_salt_not_configured" }, 503);
  }

  const { raw, id } = generateApiKey();
  const hash = await hashKey(raw, salt);

  await env.MGMT_DB.prepare(
    `INSERT INTO api_keys (id, name, hash, scopes) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, name, hash, scopes.join(","))
    .run();

  ctx.waitUntil(
    env.MGMT_DB.prepare(
      `INSERT INTO audit_events (event_type, payload, created_at) VALUES (?1, ?2, ?3)`,
    )
      .bind("api_key.created", JSON.stringify({ id, name, scopes }), new Date().toISOString())
      .run(),
  );

  return jsonResponse({ id, name, scopes, key: raw }, 201);
}

async function revokeKey(env: Env, id: string): Promise<Response> {
  const result = await env.MGMT_DB.prepare(
    `UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL`,
  )
    .bind(new Date().toISOString(), id)
    .run();
  if (result.meta?.changes === 0) {
    return jsonResponse({ error: "not_found_or_already_revoked" }, 404);
  }
  return jsonResponse({ ok: true, id });
}
