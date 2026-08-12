import { describe, expect, it } from "vitest";
import { aggregateRuntimeProjects } from "../src/lib/runtime-usage";
// @ts-ignore The production scanner is intentionally authored as a Node ESM module.
import { cliStats, dockerApiStats, parseDockerBytes } from "../scripts/lib/docker-runtime-metrics.mjs";
import scannerDockerfile from "../Dockerfile.sync?raw";
import scannerSource from "../scripts/discover-assets.mjs?raw";

describe("runtime project usage", () => {
  it("packages every runtime scanner import into the production image", () => {
    expect(scannerDockerfile).toContain("scripts/lib/docker-runtime-metrics.mjs");
    expect(scannerDockerfile).toContain("scripts/lib/dns-probe.mjs");
  });

  it("emits one JSON record so completed jobs are not logged as failed", () => {
    expect(scannerSource).toContain("console.log(JSON.stringify({output,count:assets.length,summary:result.summary,errors,uploadStatus}));");
    expect(scannerSource).not.toContain("uploadStatus},null,2");
  });
  it("normalizes Docker CLI units without inventing missing values", () => {
    expect(parseDockerBytes("1.5 GiB")).toBe(1610612736);
    expect(cliStats({ cpu: "12.5%", memory: "512MiB / 2GiB", memoryPercent: "25%", network: "1GB / 250MB", block: "10MB / 3MB", pids: "8", sampledAt: "2026-08-12T00:00:00Z" })).toMatchObject({
      cpuPercent: 12.5,
      memoryUsageBytes: 536870912,
      memoryLimitBytes: 2147483648,
      networkRxBytes: 1_000_000_000,
      blockWriteBytes: 3_000_000,
      pids: 8,
    });
    expect(cliStats({ cpu: "", memory: "", memoryPercent: "", network: "", block: "", pids: "", sampledAt: undefined }).cpuPercent).toBeNull();
  });

  it("normalizes Docker Engine point-in-time stats", () => {
    const stats = dockerApiStats({
      read: "2026-08-12T01:00:00Z",
      cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 1_200, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1_000 },
      memory_stats: { usage: 1_000, limit: 4_000, stats: { inactive_file: 100 } },
      networks: { eth0: { rx_bytes: 20, tx_bytes: 30 } },
      blkio_stats: { io_service_bytes_recursive: [{ op: "Read", value: 40 }, { op: "Write", value: 50 }] },
      pids_stats: { current: 3 },
    });
    expect(stats).toMatchObject({ cpuPercent: 200, memoryUsageBytes: 900, memoryPercentLimit: 22.5, networkRxBytes: 20, blockWriteBytes: 50, pids: 3 });
  });

  it("aggregates containers once per Compose project and keeps source timestamps", () => {
    const host = { kind: "server_runtime", metadata: { cpuCount: 4, memoryTotalKb: 4 * 1024 * 1024, diskTotalBytes: 1000 } };
    const service = { kind: "runtime_service", name: "catalog", project_id: "project-1", metadata: { workingDir: "/srv/catalog" }, repository: { name: "owner/catalog", url: "https://github.com/owner/catalog", metadata: { pushedAt: "2026-08-11T12:00:00Z" } } };
    const containers = [
      { kind: "runtime_container", name: "web", metadata: { composeProject: "catalog", sizeRwBytes: 100, startedAt: "2026-08-10T00:00:00Z", stats: { cpuPercent: 20, memoryUsageBytes: 1000, networkRxBytes: 10, networkTxBytes: 20, blockReadBytes: 30, blockWriteBytes: 40, pids: 2, sampledAt: "2026-08-12T01:00:00Z" } } },
      { kind: "runtime_container", name: "worker", metadata: { composeProject: "catalog", sizeRwBytes: 150, startedAt: "2026-08-11T00:00:00Z", stats: { cpuPercent: 30, memoryUsageBytes: 2000, networkRxBytes: 50, networkTxBytes: 60, blockReadBytes: 70, blockWriteBytes: 80, pids: 4, sampledAt: "2026-08-12T01:05:00Z" } } },
    ];
    const [project] = aggregateRuntimeProjects([service, ...containers], host);
    expect(project).toMatchObject({ name: "catalog", status: "observed", containerCount: 2, cpuPercent: 50, cpuHostRatio: 0.125, memoryUsageBytes: 3000, writableBytes: 250, writableDiskRatio: 0.25, networkRxBytes: 60, blockWriteBytes: 120, pids: 6, lastCodeUpdateAt: "2026-08-11T12:00:00Z", lastRuntimeChangeAt: "2026-08-11T00:00:00Z", lastSampleAt: "2026-08-12T01:05:00Z" });
  });

  it("marks retained old scans unavailable instead of displaying zero usage", () => {
    const [project] = aggregateRuntimeProjects([{ kind: "runtime_service", name: "legacy", metadata: {} }, { kind: "runtime_container", name: "legacy-web", last_seen_at: "2026-08-01T00:00:00Z", metadata: { composeProject: "legacy" } }], null);
    expect(project).toMatchObject({ status: "unavailable", cpuPercent: null, memoryUsageBytes: null, writableBytes: null, lastSampleAt: null });
  });
});
