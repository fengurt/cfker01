import { jsonResponse } from "../lib/response";
import { requireApiKey } from "../lib/apikey";
import { listSources } from "../collectors/registry";
import type { SourceConfig } from "../collectors/types";

interface SnapshotRow {
  id: number;
  source_id: string;
  fetched_at: string;
  ok: number;
  duration_ms: number;
  payload: string;
  error: string | null;
}

export async function handleV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authError = await requireApiKey(request, env, ctx, "read");
  if (authError) return authError;

  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["v1", "status", sourceId?]

  if (segments[1] === "status" && segments.length === 2) {
    return listLatestAll(env);
  }
  if (segments[1] === "status" && segments.length === 3) {
    return listLatestOne(env, segments[2]);
  }
  if (segments[1] === "snapshots" && segments.length === 3) {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);
    return listHistory(env, segments[2], limit);
  }
  return jsonResponse({ error: "not_found" }, 404);
}

async function listLatestAll(env: Env): Promise<Response> {
  const sources = listSources();
  const out: Array<{ source: SourceConfig; snapshot: unknown; fetchedAt: string | null }> = [];
  for (const src of sources) {
    const raw = await env.MGMT_KV.get(`status:latest:${src.id}`);
    out.push({
      source: src,
      fetchedAt: raw ? JSON.parse(raw).fetchedAt : null,
      snapshot: raw ? JSON.parse(raw) : null,
    });
  }
  return jsonResponse({ sources: out, checkedAt: new Date().toISOString() });
}

async function listLatestOne(env: Env, sourceId: string): Promise<Response> {
  const sources = listSources();
  const src = sources.find((s) => s.id === sourceId);
  if (!src) return jsonResponse({ error: "unknown_source" }, 404);
  const raw = await env.MGMT_KV.get(`status:latest:${src.id}`);
  return jsonResponse({
    source: src,
    fetchedAt: raw ? JSON.parse(raw).fetchedAt : null,
    snapshot: raw ? JSON.parse(raw) : null,
  });
}

async function listHistory(env: Env, sourceId: string, limit: number): Promise<Response> {
  const sources = listSources();
  if (!sources.some((s) => s.id === sourceId)) {
    return jsonResponse({ error: "unknown_source" }, 404);
  }
  const result = await env.MGMT_DB.prepare(
    `SELECT id, source_id, fetched_at, ok, duration_ms, payload, error
     FROM snapshots WHERE source_id = ?1 ORDER BY id DESC LIMIT ?2`,
  )
    .bind(sourceId, limit)
    .all<SnapshotRow>();
  return jsonResponse({ source: sourceId, events: result.results ?? [] });
}