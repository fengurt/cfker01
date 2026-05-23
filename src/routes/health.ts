import { jsonResponse } from "../lib/response";

export function handleHealth(): Response {
  return jsonResponse({
    ok: true,
    service: "cfker01",
    timestamp: new Date().toISOString(),
  });
}
