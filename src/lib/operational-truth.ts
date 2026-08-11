export const FRESHNESS_SLA_SECONDS = {
  health: 5 * 60,
  runtime: 15 * 60,
  dns: 60 * 60,
  cloud: 4 * 60 * 60,
  github: 4 * 60 * 60,
  local: 4 * 60 * 60,
  expiry: 24 * 60 * 60,
  annotation: Number.MAX_SAFE_INTEGER,
} as const;

export type FreshnessKind = keyof typeof FRESHNESS_SLA_SECONDS;
export type FreshnessState = "current" | "stale" | "expired" | "missing";

export type Freshness = {
  state: FreshnessState;
  ageSeconds: number | null;
  slaSeconds: number;
  expiresAt: string | null;
};

export type FactSource =
  | "tencent"
  | "cloudflare"
  | "github"
  | "local_git"
  | "docker_runtime"
  | "dns_provider"
  | "registrar_or_chain"
  | "monitor"
  | "annotation";

export type OperationalFact = {
  field: string;
  value: unknown;
  source: FactSource;
  observedAt: string;
  validUntil?: string | null;
  confidence?: number;
};

export type ResolvedFact = OperationalFact & {
  freshness: Freshness;
};

const FIELD_POLICY: Record<string, { kind: FreshnessKind; sources: FactSource[] }> = {
  "server.spec": { kind: "cloud", sources: ["tencent", "cloudflare", "annotation"] },
  "server.runtime": { kind: "runtime", sources: ["docker_runtime", "monitor"] },
  "server.expiry": { kind: "expiry", sources: ["tencent", "registrar_or_chain", "annotation"] },
  "repository.remote": { kind: "github", sources: ["github", "annotation"] },
  "repository.local_sync": { kind: "local", sources: ["local_git", "annotation"] },
  "dns.record": { kind: "dns", sources: ["dns_provider", "annotation"] },
  "url.health": { kind: "health", sources: ["monitor"] },
  "project.description": { kind: "annotation", sources: ["annotation"] },
  "project.lifecycle": { kind: "annotation", sources: ["annotation"] },
};

export function evaluateFreshness(observedAt: string | null | undefined, kind: FreshnessKind, now = new Date().toISOString()): Freshness {
  const slaSeconds = FRESHNESS_SLA_SECONDS[kind];
  if (!observedAt) return { state: "missing", ageSeconds: null, slaSeconds, expiresAt: null };
  const ageSeconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(observedAt)) / 1000));
  if (!Number.isFinite(ageSeconds)) return { state: "missing", ageSeconds: null, slaSeconds, expiresAt: null };
  if (kind === "annotation") return { state: "current", ageSeconds, slaSeconds, expiresAt: null };
  const expiresAt = new Date(Date.parse(observedAt) + slaSeconds * 1000).toISOString();
  const state: FreshnessState = ageSeconds <= slaSeconds ? "current" : ageSeconds <= slaSeconds * 2 ? "stale" : "expired";
  return { state, ageSeconds, slaSeconds, expiresAt };
}

export function resolveOperationalFact(facts: OperationalFact[], field: string, now = new Date().toISOString()): ResolvedFact | null {
  const policy = FIELD_POLICY[field];
  if (!policy) return null;
  const candidates = facts.filter((fact) => fact.field === field && policy.sources.includes(fact.source));
  if (!candidates.length) return null;
  const rank = (source: FactSource) => policy.sources.indexOf(source);
  const ranked = candidates.map((fact) => ({ ...fact, freshness: evaluateFreshness(fact.observedAt, policy.kind, now) }));
  ranked.sort((left, right) => rank(left.source) - rank(right.source) || stateRank(left.freshness.state) - stateRank(right.freshness.state) || Date.parse(right.observedAt) - Date.parse(left.observedAt) || Number(right.confidence ?? 0) - Number(left.confidence ?? 0));
  return ranked[0] ?? null;
}

export function isHomeLifecycle(value: string | null | undefined): boolean {
  return value === "active" || value === "maintenance";
}

function stateRank(state: FreshnessState): number {
  return state === "current" ? 0 : state === "stale" ? 1 : state === "expired" ? 2 : 3;
}
