import { handleRequest } from "./router";
import { logEvent } from "./lib/logger";
import { syncAll } from "./lib/sync";
import { runResourceOperations } from "./lib/resource-operations";
import { ensurePeriodicResourceSnapshot } from "./lib/resource-snapshot";
import { ensurePeriodicAssetMapVersion } from "./lib/asset-map";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      logEvent("error", "unhandled_exception", {
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : "unknown",
        deployVersion: env.DEPLOY_VERSION ?? "unknown",
      });
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(recordCronHeartbeat(env, event.cron));
    ctx.waitUntil(runSyncSweep(env));
    ctx.waitUntil(runResourceOperations(env));
    ctx.waitUntil(ensurePeriodicResourceSnapshot(env));
    ctx.waitUntil(ensurePeriodicAssetMapVersion(env));
  },
};

async function recordCronHeartbeat(env: Env, cron: string): Promise<void> {
  const timestamp = new Date().toISOString();
  logEvent("info", "cron_heartbeat", { cron, timestamp, environment: env.ENVIRONMENT });

  await env.MGMT_KV.put(
    `heartbeat:${env.ENVIRONMENT}`,
    JSON.stringify({ cron, timestamp }),
    { expirationTtl: 60 * 60 * 24 * 7 },
  );

  await env.MGMT_DB.prepare(
    "INSERT INTO audit_events (event_type, payload, created_at) VALUES (?1, ?2, ?3)",
  )
    .bind("cron_heartbeat", JSON.stringify({ cron, timestamp }), timestamp)
    .run();
}

async function runSyncSweep(env: Env): Promise<void> {
  const started = Date.now();
  const results = await syncAll(env);
  logEvent("info", "sync_sweep.complete", {
    durationMs: Date.now() - started,
    okCount: results.filter((r) => r.ok).length,
    errorCount: results.filter((r) => !r.ok).length,
  });
}
