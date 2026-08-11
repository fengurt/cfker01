import { jsonResponse } from "../lib/response";

export function handleHealth(env?: Env): Response {
  return jsonResponse({
    ok: true,
    service: "cfker01",
    deployVersion: env?.DEPLOY_VERSION ?? "unknown",
    timestamp: new Date().toISOString(),
  });
}
