import { jsonResponse } from "../lib/response";
import { requireAdminToken } from "../lib/auth";
import { syncSource } from "../lib/sync";
import { listSources } from "../collectors/registry";

export async function handleAdminSync(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authError = await requireAdminToken(request, env);
  if (authError) return authError;
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["admin", "sync", sourceId?]

  if (segments.length === 2) {
    const sources = listSources();
    const results = await Promise.all(
      sources.map((s) => syncSource(env, s.id)),
    );
    return jsonResponse({ ok: true, results });
  }
  if (segments.length === 3) {
    const result = await syncSource(env, segments[2]);
    return jsonResponse({ ok: true, source: segments[2], result });
  }
  return jsonResponse({ error: "not_found" }, 404);
}
