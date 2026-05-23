import { jsonResponse } from "../lib/response";

export async function handleStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let heartbeat: unknown = null;

  try {
    const raw = await env.MGMT_KV.get(`heartbeat:${env.ENVIRONMENT}`);
    heartbeat = raw ? JSON.parse(raw) : null;
  } catch {
    heartbeat = null;
  }

  return jsonResponse({
    service: env.APP_NAME,
    environment: env.ENVIRONMENT,
    region: url.hostname,
    bindings: {
      d1: Boolean(env.MGMT_DB),
      kv: Boolean(env.MGMT_KV),
    },
    lastCronHeartbeat: heartbeat,
    checkedAt: new Date().toISOString(),
  });
}
