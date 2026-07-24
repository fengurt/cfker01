import { getCollector, listSources } from "../collectors/registry";
import type { CollectorContext, CollectorResult, SourceConfig } from "../collectors/types";
import { runCollector } from "../collectors/run";
import { logEvent } from "./logger";
import { deliverSnapshot } from "./push";

const LOCK_TTL_SECONDS = 60;

async function acquireLock(kv: KVNamespace, sourceId: string): Promise<boolean> {
  const key = `sync:lock:${sourceId}`;
  const existing = await kv.get(key);
  if (existing) return false;
  await kv.put(key, new Date().toISOString(), { expirationTtl: LOCK_TTL_SECONDS });
  return true;
}

async function ensureSource(env: Env, src: SourceConfig): Promise<void> {
  await env.MGMT_DB.prepare(
    `INSERT INTO sources (id, label, kind, region)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       kind = excluded.kind,
       region = excluded.region`,
  )
    .bind(src.id, src.label, src.kind, src.region ?? null)
    .run();
}

async function writeSnapshot(
  env: Env,
  src: SourceConfig,
  result: CollectorResult,
  fetchedAt: string,
): Promise<void> {
  await env.MGMT_DB.prepare(
    `INSERT INTO snapshots (source_id, fetched_at, ok, duration_ms, payload, error)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      src.id,
      fetchedAt,
      result.ok ? 1 : 0,
      result.durationMs,
      JSON.stringify(result.payload),
      result.error ?? null,
    )
    .run();

  await env.MGMT_DB.prepare(
    `UPDATE sources SET last_synced_at = ?1, last_status = ?2, last_error = ?3 WHERE id = ?4`,
  )
    .bind(fetchedAt, result.ok ? "ok" : "error", result.error ?? null, src.id)
    .run();

  if (result.ok) {
    await env.MGMT_KV.put(
      `status:latest:${src.id}`,
      JSON.stringify({ source: src, fetchedAt, ok: true, payload: result.payload }),
      { expirationTtl: 60 * 60 * 24 },
    );
  }
}

export async function syncSource(env: Env, sourceId: string): Promise<CollectorResult> {
  const sources = listSources();
  const src = sources.find((s) => s.id === sourceId);
  if (!src) {
    return { ok: false, payload: {}, error: "unknown_source", durationMs: 0 };
  }
  const collector = getCollector(src.kind);
  if (!collector) {
    return { ok: false, payload: {}, error: "no_collector_for_kind", durationMs: 0 };
  }

  await ensureSource(env, src);

  const lockAcquired = await acquireLock(env.MGMT_KV, src.id);
  if (!lockAcquired) {
    return { ok: true, payload: {}, error: "sync_already_in_progress", durationMs: 0 };
  }

  const ctx: CollectorContext = { env, signal: new AbortController().signal };
  const result = await runCollector(collector, ctx);

  const fetchedAt = new Date().toISOString();
  await writeSnapshot(env, src, result, fetchedAt);

  logEvent(result.ok ? "info" : "warn", `sync.${src.id}.${result.ok ? "ok" : "error"}`, {
    source: src.id,
    durationMs: result.durationMs,
    error: result.error ?? null,
  });

  if (result.ok) {
    await deliverSnapshot(env, src, { fetchedAt, payload: result.payload });
  }

  return result;
}

export async function syncAll(env: Env): Promise<CollectorResult[]> {
  const sources = listSources();
  return Promise.all(sources.map((s) => syncSource(env, s.id)));
}