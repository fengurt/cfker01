const UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

export function parseDockerBytes(value) {
  const match = String(value || "").trim().match(/^([\d.]+)\s*([kmgt]?i?b)$/i);
  if (!match) return null;
  const bytes = Number(match[1]) * (UNITS[match[2].toLowerCase()] || 0);
  return Number.isFinite(bytes) ? Math.round(bytes) : null;
}

export function parseDockerPair(value) {
  const [first, second] = String(value || "").split("/").map((part) => parseDockerBytes(part));
  return { first: first ?? null, second: second ?? null };
}

export function parseDockerPercent(value) {
  const normalized = String(value ?? "").replace("%", "").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function dockerApiStats(stats) {
  if (!stats || typeof stats !== "object") return null;
  const cpuDelta = Number(stats.cpu_stats?.cpu_usage?.total_usage || 0) - Number(stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta = Number(stats.cpu_stats?.system_cpu_usage || 0) - Number(stats.precpu_stats?.system_cpu_usage || 0);
  const onlineCpus = Number(stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1);
  const cpuPercent = cpuDelta > 0 && systemDelta > 0 ? cpuDelta / systemDelta * onlineCpus * 100 : 0;
  const memoryStats = stats.memory_stats || {}, cache = Number(memoryStats.stats?.inactive_file || memoryStats.stats?.cache || 0), memoryUsageBytes = Math.max(0, Number(memoryStats.usage || 0) - cache), memoryLimitBytes = Number(memoryStats.limit || 0);
  const networks = Object.values(stats.networks || {}), networkRxBytes = networks.reduce((sum, item) => sum + Number(item?.rx_bytes || 0), 0), networkTxBytes = networks.reduce((sum, item) => sum + Number(item?.tx_bytes || 0), 0);
  const io = stats.blkio_stats?.io_service_bytes_recursive || [], blockReadBytes = io.filter((item) => String(item.op).toLowerCase() === "read").reduce((sum, item) => sum + Number(item.value || 0), 0), blockWriteBytes = io.filter((item) => String(item.op).toLowerCase() === "write").reduce((sum, item) => sum + Number(item.value || 0), 0);
  return { cpuPercent: finite(cpuPercent), memoryUsageBytes: finite(memoryUsageBytes), memoryLimitBytes: finite(memoryLimitBytes), memoryPercentLimit: memoryLimitBytes > 0 ? finite(memoryUsageBytes / memoryLimitBytes * 100) : null, networkRxBytes: finite(networkRxBytes), networkTxBytes: finite(networkTxBytes), blockReadBytes: finite(blockReadBytes), blockWriteBytes: finite(blockWriteBytes), pids: finite(Number(stats.pids_stats?.current || 0)), sampledAt: stats.read || new Date().toISOString() };
}

export function cliStats({ cpu, memory, memoryPercent, network, block, pids, sampledAt }) {
  const memoryPair = parseDockerPair(memory), networkPair = parseDockerPair(network), blockPair = parseDockerPair(block);
  const normalizedPids = String(pids ?? "").trim();
  return { cpuPercent: parseDockerPercent(cpu), memoryUsageBytes: memoryPair.first, memoryLimitBytes: memoryPair.second, memoryPercentLimit: parseDockerPercent(memoryPercent), networkRxBytes: networkPair.first, networkTxBytes: networkPair.second, blockReadBytes: blockPair.first, blockWriteBytes: blockPair.second, pids: normalizedPids && Number.isFinite(Number(normalizedPids)) ? Number(normalizedPids) : null, sampledAt: sampledAt || new Date().toISOString() };
}

function finite(value) { return Number.isFinite(value) ? value : null; }
