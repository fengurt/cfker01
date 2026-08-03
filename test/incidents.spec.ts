import { describe, expect, it } from "vitest";
import {
  classifyIncident,
  incidentFingerprint,
  notificationPlan,
} from "../src/lib/incidents";

describe("incident policy", () => {
  it("classifies systemic impact as P0", () => {
    expect(classifyIncident({ affectedProductionProjects: 2, productionImpact: true })).toBe("p0");
    expect(classifyIncident({ security: true })).toBe("p0");
  });

  it("classifies urgent single-service failures and expiry windows as P1", () => {
    expect(classifyIncident({ criticalProjectDown: true })).toBe("p1");
    expect(classifyIncident({ expiryHours: 24 })).toBe("p1");
    expect(classifyIncident({ backupFailure: true })).toBe("p1");
  });

  it("keeps degraded and stale conditions below outage severity", () => {
    expect(classifyIncident({ degraded: true })).toBe("p2");
    expect(classifyIncident({ stale: true })).toBe("p2");
    expect(classifyIncident({ missingDescription: true })).toBe("p3");
  });

  it("deduplicates the same root cause regardless of evidence order", () => {
    expect(incidentFingerprint({ entityType: "server", entityId: "srv-1", check: "health", rootCause: "timeout", evidence: ["a", "b"] }))
      .toBe(incidentFingerprint({ entityType: "server", entityId: "srv-1", check: "health", rootCause: "timeout", evidence: ["b", "a"] }));
    expect(incidentFingerprint({ entityType: "server", entityId: "srv-1", check: "health", rootCause: "dns", evidence: ["a", "b"] }))
      .not.toBe(incidentFingerprint({ entityType: "server", entityId: "srv-1", check: "health", rootCause: "timeout", evidence: ["a", "b"] }));
  });

  it("only interrupts for P0 and P1", () => {
    expect(notificationPlan("p0", true)).toEqual(["inbox", "sms"]);
    expect(notificationPlan("p1", true)).toEqual(["inbox", "sms"]);
    expect(notificationPlan("p2", true)).toEqual(["inbox", "digest"]);
    expect(notificationPlan("p3", false)).toEqual(["inbox"]);
  });
});
