import type { Collector, CollectorContext, CollectorResult } from "./types";

const MINIMAX_API = "https://api.minimaxi.com";

export const collectMinimax: Collector = async (
  ctx: CollectorContext,
): Promise<CollectorResult> => {
  const key = ctx.env.MINIMAX_API_KEY;
  if (!key) {
    return { ok: false, payload: {}, error: "missing_minimax_api_key", durationMs: 0 };
  }

  const headers = { Authorization: `Bearer ${key}` };

  const res = await fetch(
    `${MINIMAX_API}/v1/api/openplatform/coding_plan/remains`,
    { headers, signal: ctx.signal },
  );

  if (!res.ok) {
    return {
      ok: false,
      payload: {},
      error: `minimax_http_${res.status}`,
      durationMs: 0,
    };
  }

  const body = (await res.json()) as Record<string, unknown>;

  return {
    ok: true,
    payload: body,
    durationMs: 0,
  };
};