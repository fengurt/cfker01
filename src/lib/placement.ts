export type PlacementRequirement = {
  architecture?: string | null;
  runtime?: string | null;
  minCpu?: number | null;
  minMemoryMb?: number | null;
  minDiskGb?: number | null;
  requiredRegion?: string | null;
  stateful?: boolean;
};

export type PlacementCandidate = {
  id: string;
  name: string;
  status: string;
  manualStatus?: string | null;
  runtimeFresh: boolean;
  architecture?: string | null;
  region?: string | null;
  vcpu?: number | null;
  memoryMb?: number | null;
  diskGb?: number | null;
  pressure?: number | null;
  runtime?: string | null;
};

export type PlacementResult = {
  status: "ok" | "insufficient_data";
  candidates: Array<PlacementCandidate & { score: number; reasons: string[] }>;
  excluded: Array<{ id: string; reasons: string[] }>;
};

/**
 * Deterministic placement policy. It never invents capacity: missing facts are
 * an exclusion and produce insufficient_data when no candidate is safe.
 */
export function rankPlacement(requirement: PlacementRequirement | null, candidates: PlacementCandidate[], limit = 3): PlacementResult {
  if (!requirement) return { status: "insufficient_data", candidates: [], excluded: candidates.map((candidate) => ({ id: candidate.id, reasons: ["deployment_requirements_missing"] })) };
  const eligible: PlacementResult["candidates"] = [];
  const excluded: PlacementResult["excluded"] = [];
  for (const candidate of candidates) {
    const reasons: string[] = [];
    const architecture = candidate.architecture?.trim().toLowerCase();
    if (!candidate.id || !candidate.name) reasons.push("identity_missing");
    if (candidate.status !== "healthy") reasons.push(`status:${candidate.status || "missing"}`);
    if (candidate.manualStatus === "maintenance" || candidate.manualStatus === "disabled") reasons.push(`manual_status:${candidate.manualStatus}`);
    if (!candidate.runtimeFresh) reasons.push("runtime_stale_or_missing");
    if (requirement.architecture && architecture !== requirement.architecture.trim().toLowerCase()) reasons.push("architecture_mismatch");
    if (requirement.requiredRegion && candidate.region !== requirement.requiredRegion) reasons.push("region_mismatch");
    if (requirement.minCpu == null || requirement.minMemoryMb == null || requirement.minDiskGb == null) reasons.push("capacity_requirements_incomplete");
    if (requirement.minCpu != null && (candidate.vcpu == null || candidate.vcpu < requirement.minCpu)) reasons.push("cpu_insufficient");
    if (requirement.minMemoryMb != null && (candidate.memoryMb == null || candidate.memoryMb < requirement.minMemoryMb)) reasons.push("memory_insufficient");
    if (requirement.minDiskGb != null && (candidate.diskGb == null || candidate.diskGb < requirement.minDiskGb)) reasons.push("disk_insufficient");
    if (reasons.length) {
      excluded.push({ id: candidate.id, reasons: [...new Set(reasons)] });
      continue;
    }
    const pressure = candidate.pressure;
    if (pressure == null || !Number.isFinite(pressure)) {
      excluded.push({ id: candidate.id, reasons: ["runtime_metrics_missing"] });
      continue;
    }
    const headroom = Math.max(0, 1 - pressure);
    const score = Math.round((pressure * 0.7 + (1 - headroom) * 0.3) * 1000) / 1000;
    eligible.push({ ...candidate, score, reasons: ["healthy", "fresh_runtime", "requirements_satisfied"] });
  }
  eligible.sort((left, right) => left.score - right.score || left.name.localeCompare(right.name));
  return { status: eligible.length ? "ok" : "insufficient_data", candidates: eligible.slice(0, Math.max(1, Math.min(3, limit))), excluded };
}
