import { handleRequest } from "./router";
import { logEvent } from "./lib/logger";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      logEvent("error", "unhandled_exception", {
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : "unknown",
      });
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(recordCronHeartbeat(env, event.cron));
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
