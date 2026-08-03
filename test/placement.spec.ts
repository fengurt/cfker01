import { describe, expect, it } from "vitest";
import { rankPlacement } from "../src/lib/placement";

const requirement = { architecture: "amd64", minCpu: 2, minMemoryMb: 2048, minDiskGb: 20 };

describe("placement policy", () => {
  it("rejects missing requirements and never guesses", () => {
    const result = rankPlacement(null, [{ id: "s1", name: "one", status: "healthy", runtimeFresh: true }]);
    expect(result.status).toBe("insufficient_data");
    expect(result.excluded[0]?.reasons).toContain("deployment_requirements_missing");
  });

  it("excludes stale, unhealthy, and undersized servers", () => {
    const result = rankPlacement(requirement, [
      { id: "down", name: "down", status: "down", runtimeFresh: true, architecture: "amd64", vcpu: 4, memoryMb: 4096, diskGb: 100, pressure: 0.1 },
      { id: "stale", name: "stale", status: "healthy", runtimeFresh: false, architecture: "amd64", vcpu: 4, memoryMb: 4096, diskGb: 100, pressure: 0.1 },
      { id: "small", name: "small", status: "healthy", runtimeFresh: true, architecture: "amd64", vcpu: 1, memoryMb: 1024, diskGb: 10, pressure: 0.1 },
    ]);
    expect(result.status).toBe("insufficient_data");
    expect(result.candidates).toHaveLength(0);
  });

  it("returns at most three candidates ordered by lowest pressure", () => {
    const candidates = [0.8, 0.2, 0.5, 0.1].map((pressure, index) => ({ id: `s${index}`, name: `server-${index}`, status: "healthy", runtimeFresh: true, architecture: "amd64", vcpu: 4, memoryMb: 4096, diskGb: 100, pressure }));
    const result = rankPlacement(requirement, candidates, 10);
    expect(result.status).toBe("ok");
    expect(result.candidates.map((item) => item.id)).toEqual(["s3", "s1", "s2"]);
  });
});
