import { describe, expect, it } from "vitest";
import {
  evaluateFreshness,
  isHomeLifecycle,
  resolveOperationalFact,
  type OperationalFact,
} from "../src/lib/operational-truth";

const now = "2026-08-04T00:00:00.000Z";

describe("operational truth", () => {
  it("marks values at the SLA boundary current and values beyond it stale", () => {
    expect(evaluateFreshness("2026-08-03T23:55:00.000Z", "health", now)).toMatchObject({ state: "current", ageSeconds: 300 });
    expect(evaluateFreshness("2026-08-03T23:54:59.000Z", "health", now)).toMatchObject({ state: "stale", ageSeconds: 301 });
    expect(evaluateFreshness("2026-08-03T23:49:59.000Z", "health", now)).toMatchObject({ state: "expired", ageSeconds: 601 });
  });

  it("uses the authoritative source without allowing a fresh lower-authority value to hide stale truth", () => {
    const facts: OperationalFact[] = [
      { field: "server.spec", value: { memoryGiB: 4 }, source: "tencent", observedAt: "2026-08-03T12:00:00.000Z" },
      { field: "server.spec", value: { memoryGiB: 8 }, source: "annotation", observedAt: now },
    ];
    const resolved = resolveOperationalFact(facts, "server.spec", now);
    expect(resolved?.source).toBe("tencent");
    expect(resolved?.freshness.state).toBe("expired");
    expect(resolved?.value).toEqual({ memoryGiB: 4 });
  });

  it("prefers the newest current value when authority and freshness are equal", () => {
    const facts: OperationalFact[] = [
      { field: "url.health", value: "degraded", source: "monitor", observedAt: "2026-08-03T23:58:00.000Z" },
      { field: "url.health", value: "healthy", source: "monitor", observedAt: "2026-08-03T23:59:00.000Z" },
    ];
    expect(resolveOperationalFact(facts, "url.health", now)?.value).toBe("healthy");
  });

  it("only counts active and maintenance projects on the home view", () => {
    expect(isHomeLifecycle("active")).toBe(true);
    expect(isHomeLifecycle("maintenance")).toBe(true);
    expect(isHomeLifecycle("experimental")).toBe(false);
    expect(isHomeLifecycle("unclassified")).toBe(false);
  });
});
