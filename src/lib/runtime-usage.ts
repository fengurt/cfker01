type Row = Record<string, any>;

export type RuntimeProjectUsage = {
  name: string; projectId: string | null; url: string | null; repository: Row | null; workingDir: string | null;
  containerAssetIds: string[]; containerCount: number; status: "observed" | "partial" | "unavailable";
  cpuPercent: number | null; cpuHostRatio: number | null; memoryUsageBytes: number | null; memoryHostRatio: number | null;
  writableBytes: number | null; writableDiskRatio: number | null; networkRxBytes: number | null; networkTxBytes: number | null;
  blockReadBytes: number | null; blockWriteBytes: number | null; pids: number | null;
  lastCodeUpdateAt: string | null; lastRuntimeChangeAt: string | null; lastSampleAt: string | null;
};

export function aggregateRuntimeProjects(rows: Row[], host: Row | null): RuntimeProjectUsage[] {
  const services = rows.filter((row) => ["compose_project", "runtime_service"].includes(String(row.kind))), containers = rows.filter((row) => ["container", "runtime_container"].includes(String(row.kind))), serviceByName = new Map(services.map((row) => [String(row.name), row]));
  const names = new Set([...services.map((row) => String(row.name)), ...containers.map((row) => String(row.metadata?.composeProject || row.name))]);
  const cpuCount = number(host?.metadata?.cpuCount), memoryTotal = (number(host?.metadata?.memoryTotalKb) || 0) * 1024, diskTotal = number(host?.metadata?.dockerDiskTotalBytes) || number(host?.metadata?.diskTotalBytes);
  return [...names].map((name): RuntimeProjectUsage => {
    const service = serviceByName.get(name), members = containers.filter((row) => String(row.metadata?.composeProject || row.name) === name), observed = members.filter((row) => row.metadata?.stats && number(row.metadata.stats.cpuPercent) !== null), metrics = observed.map((row) => row.metadata.stats), repository = service?.repository || null;
    const cpuPercent = sumOrNull(metrics, "cpuPercent"), memoryUsageBytes = sumOrNull(metrics, "memoryUsageBytes"), writableBytes = sumOrNull(members.map((row) => row.metadata || {}), "sizeRwBytes"), networkRxBytes = sumOrNull(metrics, "networkRxBytes"), networkTxBytes = sumOrNull(metrics, "networkTxBytes"), blockReadBytes = sumOrNull(metrics, "blockReadBytes"), blockWriteBytes = sumOrNull(metrics, "blockWriteBytes"), pids = sumOrNull(metrics, "pids");
    const lastSampleAt = latest(metrics.map((metric) => metric.sampledAt)), lastRuntimeChangeAt = latest(members.flatMap((row) => [row.metadata?.createdAt, row.metadata?.startedAt])), lastCodeUpdateAt = latest([repository?.metadata?.pushedAt, repository?.metadata?.updatedAt, repository?.last_seen_at]);
    return { name, projectId: service?.project_id || null, url: service?.url || null, repository, workingDir: service?.metadata?.workingDir || members.find((row) => row.metadata?.workingDir)?.metadata?.workingDir || null, containerAssetIds: members.map((row) => String(row.id)), containerCount: members.length, status: observed.length === members.length && members.length ? "observed" : observed.length ? "partial" : "unavailable", cpuPercent, cpuHostRatio: cpuPercent !== null && cpuCount ? cpuPercent / (cpuCount * 100) : null, memoryUsageBytes, memoryHostRatio: memoryUsageBytes !== null && memoryTotal ? memoryUsageBytes / memoryTotal : null, writableBytes, writableDiskRatio: writableBytes !== null && diskTotal ? writableBytes / diskTotal : null, networkRxBytes, networkTxBytes, blockReadBytes, blockWriteBytes, pids, lastCodeUpdateAt, lastRuntimeChangeAt, lastSampleAt };
  }).sort((a, b) => pressure(b) - pressure(a) || (b.memoryUsageBytes || 0) - (a.memoryUsageBytes || 0) || a.name.localeCompare(b.name));
}

function sumOrNull(values: Row[], key: string): number | null { const numbers = values.map((value) => number(value?.[key])).filter((value): value is number => value !== null); return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null; }
function number(value: unknown): number | null { if (value === null || value === undefined || value === "") return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
function latest(values: unknown[]): string | null { return values.map(String).filter((value) => value && value !== "undefined" && Number.isFinite(Date.parse(value))).sort().at(-1) || null; }
function pressure(value: RuntimeProjectUsage): number { return Math.max(value.cpuHostRatio || 0, value.memoryHostRatio || 0, value.writableDiskRatio || 0); }
