import type { Collector, CollectorContext, CollectorResult } from "./types";

const DEFAULT_TIMEOUT_MS = 5000;

export async function runCollector(
  collector: Collector,
  ctx: CollectorContext,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CollectorResult> {
  const started = Date.now();
  const ac = new AbortController();
  if (ctx.signal.aborted) ac.abort();
  ctx.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const localCtx: CollectorContext = { env: ctx.env, signal: ac.signal };

  const timeout = new Promise<CollectorResult>((resolve) => {
    const id = setTimeout(() => {
      ac.abort();
      resolve({
        ok: false,
        payload: {},
        error: `timeout_after_${timeoutMs}ms`,
        durationMs: timeoutMs,
      });
    }, timeoutMs);
    ac.signal.addEventListener("abort", () => clearTimeout(id), { once: true });
  });

  try {
    const result = await Promise.race([collector(localCtx), timeout]);
    return { ...result, durationMs: result.durationMs ?? Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      payload: {},
      error: err instanceof Error ? err.message : "unknown_error",
      durationMs: Date.now() - started,
    };
  }
}