type Row = Record<string, unknown>;

const SCHEMA_VERSION = "resource-snapshot-v1";
const SNAPSHOT_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type ResourceSnapshot = {
  schemaVersion: string;
  generatedAt: string;
  purpose: string;
  safeguards: string[];
  freshness: { newestRuntimeAt: string | null; oldestRuntimeAt: string | null; snapshotAgeSeconds: number | null };
  fleet: { totalServers: number; healthyServers: number; attentionServers: number; runtimeCoverage: number; openEvents: number };
  placementPolicy: { eligibleStatuses: string[]; hardExclusions: string[]; scoreMeaning: string };
  serverPlacement: Array<Record<string, unknown>>;
  imbalance: { busiest: Array<Record<string, unknown>>; leastLoaded: Array<Record<string, unknown>>; spread: number | null; recommendation: string };
};

export async function createResourceSnapshot(env: Env, trigger: "schedule" | "manual" = "manual"): Promise<ResourceSnapshot> {
  const [serversResult, eventsResult] = await Promise.all([
    env.MGMT_DB.prepare(`
      SELECT s.id,s.name,s.provider,s.architecture,s.cpu,s.memory_mb,s.disk_gb,s.operating_system,s.due_at,
        s.health_status,s.manual_status,s.last_checked_at,s.last_latency_ms,
        (SELECT COUNT(*) FROM deployments d WHERE d.server_id=s.id AND d.status!='disabled') deployment_count,
        (SELECT COUNT(*) FROM discovered_assets a WHERE a.server_id=s.id AND a.kind IN ('runtime_service','compose_project') AND a.status!='stale') service_count,
        (SELECT COUNT(*) FROM discovered_assets a WHERE a.server_id=s.id AND a.kind='runtime_container' AND a.status!='stale') container_count,
        (SELECT metadata FROM discovered_assets a WHERE a.server_id=s.id AND a.kind='server_runtime' AND a.status!='stale' ORDER BY a.last_seen_at DESC LIMIT 1) runtime_metadata,
        (SELECT last_seen_at FROM discovered_assets a WHERE a.server_id=s.id AND a.kind='server_runtime' AND a.status!='stale' ORDER BY a.last_seen_at DESC LIMIT 1) runtime_at
      FROM servers s ORDER BY s.name
    `).all<Row>(),
    env.MGMT_DB.prepare(`SELECT COUNT(*) count FROM availability_events WHERE resolved_at IS NULL`).first<{ count: number }>(),
  ]);
  const generatedAt = new Date().toISOString();
  const servers = (serversResult.results ?? []).map(serializeServer);
  const eligible = servers.filter((server) => server.placement?.eligible);
  const byPressure = [...eligible].sort((left, right) => Number(right.placement?.pressure ?? 1) - Number(left.placement?.pressure ?? 1));
  const pressures = eligible.map((server) => Number(server.placement?.pressure)).filter(Number.isFinite);
  const runtimeTimes = servers.map((server) => server.runtime?.collectedAt).filter((value): value is string => Boolean(value)).sort();
  const snapshot: ResourceSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    purpose: "Machine-readable inventory for deployment planning. It is advisory only and never moves workloads automatically.",
    safeguards: ["No credentials, private document content, source code, or server IP addresses are included.", "Do not place stateful workloads without storage, backup, network, and compatibility review.", "Only healthy servers with a recent runtime sample are eligible for automatic shortlisting."],
    freshness: {
      newestRuntimeAt: runtimeTimes.at(-1) ?? null,
      oldestRuntimeAt: runtimeTimes[0] ?? null,
      snapshotAgeSeconds: null,
    },
    fleet: {
      totalServers: servers.length,
      healthyServers: servers.filter((server) => server.status === "healthy").length,
      attentionServers: servers.filter((server) => server.status !== "healthy").length,
      runtimeCoverage: servers.filter((server) => server.runtime?.collectedAt).length,
      openEvents: Number(eventsResult?.count ?? 0),
    },
    placementPolicy: {
      eligibleStatuses: ["healthy"],
      hardExclusions: ["down, expired, disabled, or stale runtime sample", "missing resource metrics", "manual maintenance state"],
      scoreMeaning: "0 is least pressured and 1 is the highest observed memory, disk, or normalized load ratio.",
    },
    serverPlacement: servers,
    imbalance: {
      busiest: byPressure.slice(0, 3).map(compactPlacement),
      leastLoaded: byPressure.slice(-3).reverse().map(compactPlacement),
      spread: pressures.length > 1 ? round(Math.max(...pressures) - Math.min(...pressures)) : null,
      recommendation: recommendation(byPressure),
    },
  };
  const serialized = JSON.stringify(snapshot);
  const hash = await sha256(serialized);
  await env.MGMT_DB.prepare(`INSERT INTO resource_snapshots(id,schema_version,generated_at,trigger,payload,payload_hash,created_at) VALUES(?1,?2,?3,?4,?5,?6,?3)`)
    .bind(crypto.randomUUID(), SCHEMA_VERSION, generatedAt, trigger, serialized, hash).run();
  await env.MGMT_DB.prepare(`DELETE FROM resource_snapshots WHERE id NOT IN (SELECT id FROM resource_snapshots ORDER BY generated_at DESC LIMIT 180)`).run();
  return snapshot;
}

export async function latestResourceSnapshot(env: Env): Promise<ResourceSnapshot | null> {
  const row = await env.MGMT_DB.prepare(`SELECT payload FROM resource_snapshots ORDER BY generated_at DESC LIMIT 1`).first<{ payload: string }>();
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload) as ResourceSnapshot; } catch { return null; }
}

export async function ensurePeriodicResourceSnapshot(env: Env): Promise<void> {
  const row = await env.MGMT_DB.prepare(`SELECT generated_at FROM resource_snapshots ORDER BY generated_at DESC LIMIT 1`).first<{ generated_at: string }>();
  if (row?.generated_at && Date.now() - Date.parse(row.generated_at) < SNAPSHOT_INTERVAL_MS) return;
  await createResourceSnapshot(env, "schedule");
}

function serializeServer(row: Row) {
  const runtime = parseJson(row.runtime_metadata);
  const memoryTotal = number(row.memory_mb) * 1024 * 1024 || number(runtime.memoryTotalKb) * 1024;
  const memoryAvailable = number(runtime.memoryAvailableKb) * 1024;
  const diskTotal = number(row.disk_gb) * 1024 ** 3 || number(runtime.diskTotalBytes);
  const diskUsed = number(runtime.diskUsedBytes);
  const cpu = number(row.cpu) || number(runtime.cpuCount);
  const memoryRatio = ratio(memoryTotal > 0 ? Math.max(0, memoryTotal - memoryAvailable) : null, memoryTotal);
  const diskRatio = ratio(diskUsed, diskTotal);
  const loadRatio = ratio(number(runtime.load1), cpu);
  const pressure = [memoryRatio, diskRatio, loadRatio].filter((value): value is number => value !== null).reduce((max, value) => Math.max(max, value), -1);
  const runtimeAt = string(row.runtime_at);
  const fresh = runtimeAt ? Date.now() - Date.parse(runtimeAt) <= 6 * 60 * 60 * 1000 : false;
  const status = normalizedStatus(row);
  const eligible = status === "healthy" && fresh && pressure >= 0 && String(row.manual_status ?? "") !== "maintenance";
  return {
    id: string(row.id), name: string(row.name), provider: serverClass(String(row.provider ?? "")), architecture: string(row.architecture), operatingSystem: string(row.operating_system), status,
    capacity: { vcpu: cpu || null, memoryGiB: gib(memoryTotal), diskGiB: gib(diskTotal), dueAt: string(row.due_at) },
    runtime: { collectedAt: runtimeAt, memoryUsedRatio: memoryRatio, diskUsedRatio: diskRatio, loadPerCpu: loadRatio, latencyMs: number(row.last_latency_ms) || null },
    workload: { deployments: number(row.deployment_count), services: number(row.service_count), containers: number(row.container_count) },
    placement: { eligible, pressure: pressure >= 0 ? round(pressure) : null, reasons: placementReasons(status, fresh, pressure, number(row.deployment_count), number(row.container_count)) },
  };
}

function compactPlacement(server: Record<string, any>) { return { id: server.id, name: server.name, pressure: server.placement?.pressure ?? null, workload: server.workload, capacity: server.capacity }; }
function recommendation(servers: Array<Record<string, any>>) { if (!servers.length) return "No safe placement candidate: collect a fresh runtime sample from a healthy server first."; const least = servers[servers.length - 1]!, busiest = servers[0]!; return `Shortlist ${least.name} first (pressure ${least.placement.pressure}); avoid adding non-essential workloads to ${busiest.name} (pressure ${busiest.placement.pressure}) until capacity is reviewed.`; }
function placementReasons(status: string, fresh: boolean, pressure: number, deployments: number, containers: number) { const reasons: string[] = []; if (status !== "healthy") reasons.push(`status:${status}`); if (!fresh) reasons.push("runtime_sample_stale_or_missing"); if (pressure >= .85) reasons.push("high_observed_pressure"); if (!deployments && !containers) reasons.push("no_current_workload_observed"); if (!reasons.length) reasons.push("healthy_recent_runtime_sample"); return reasons; }
function normalizedStatus(row: Row) { const status = String(row.health_status || "unverified").toLowerCase(); if (["healthy", "reachable", "online", "active"].includes(status)) return "healthy"; if (String(row.manual_status || "").toLowerCase() === "disabled") return "disabled"; return status; }
function serverClass(provider: string) { if (/lighthouse/i.test(provider)) return "tencent_lighthouse"; if (/cvm/i.test(provider)) return "tencent_cvm"; return provider || "unknown"; }
function parseJson(value: unknown): Row { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" ? parsed as Row : {}; } catch { return {}; } }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function string(value: unknown) { return value == null ? null : String(value); }
function ratio(value: number | null, total: number) { return value != null && total > 0 ? round(Math.max(0, Math.min(1, value / total))) : null; }
function gib(bytes: number) { return bytes > 0 ? round(bytes / 1024 ** 3) : null; }
function round(value: number) { return Math.round(value * 1000) / 1000; }
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
