import type { Collector, CollectorContext, CollectorResult } from "./types";

const OPENAI_API = "https://api.openai.com/v1";

export const collectOpenai: Collector = async (
  ctx: CollectorContext,
): Promise<CollectorResult> => {
  const key = ctx.env.OPENAI_API_KEY ?? ctx.env.OPENAI_ADMIN_KEY;
  if (!key) {
    return { ok: false, payload: {}, error: "missing_openai_api_key", durationMs: 0 };
  }

  const headers = { Authorization: `Bearer ${key}` };

  const [modelsRes, subRes] = await Promise.all([
    fetch(`${OPENAI_API}/models`, { headers, signal: ctx.signal }),
    fetch(`${OPENAI_API}/dashboard/billing/subscription`, {
      headers,
      signal: ctx.signal,
    }),
  ]);

  const models = modelsRes.ok
    ? ((await modelsRes.json()) as { data: Array<{ id: string }> })
    : { data: [] };

  let subscription: Record<string, unknown> | null = null;
  if (subRes.ok) {
    subscription = (await subRes.json()) as Record<string, unknown>;
  }

  return {
    ok: modelsRes.ok,
    payload: {
      modelCount: models.data.length,
      sampleModels: models.data.slice(0, 10).map((m) => m.id),
      subscription,
    },
    error: modelsRes.ok ? undefined : `openai_http_${modelsRes.status}`,
    durationMs: 0,
  };
};