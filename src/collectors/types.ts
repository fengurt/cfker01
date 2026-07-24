export interface CollectorContext {
  env: Env;
  signal: AbortSignal;
}

export interface CollectorResult {
  ok: boolean;
  payload: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export type Collector = (
  ctx: CollectorContext,
) => Promise<CollectorResult>;

export interface SourceConfig {
  id: string;
  label: string;
  kind: "cloudflare" | "tencent" | "openai" | "minimax";
  region?: string;
}