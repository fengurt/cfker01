# Runtime project resource attribution

The server scanner attributes current Docker usage to the canonical Compose project. The admin API returns this as `runtime_projects`; one project appears once even when it contains several containers.

## Metric definitions

| Field | Definition | Decision use |
|---|---|---|
| `cpuPercent` | Sum of Docker container CPU percentages from one point-in-time sample. One fully used core is 100%. | Identify projects consuming CPU now. |
| `cpuHostRatio` | `cpuPercent / (host CPU count * 100)` | Compare the project with total host CPU capacity. |
| `memoryUsageBytes` | Sum of container memory usage after subtracting inactive file cache where Docker Engine exposes it. | Identify current resident-memory pressure. |
| `memoryHostRatio` | Project memory divided by host physical memory. | Compare projects on the same server. |
| `writableBytes` | Sum of each container writable layer (`SizeRw`). | Find projects growing their container filesystem. |
| `writableDiskRatio` | Writable-layer bytes divided by the filesystem containing Docker's data root, falling back to host root-disk capacity. | Triage large writable layers. |
| `networkRxBytes` / `networkTxBytes` | Cumulative container network counters since container start. | Compare traffic volume, with container age considered. |
| `blockReadBytes` / `blockWriteBytes` | Cumulative container block-I/O counters since container start. | Find storage-intensive services, with container age considered. |
| `lastCodeUpdateAt` | Latest verified attached GitHub repository push/update time. | Detect old code, not runtime activity. |
| `lastRuntimeChangeAt` | Latest container create/start time. | Detect recent restarts or redeployments. |
| `lastSampleAt` | Time at which Docker usage was sampled. | Judge freshness before acting. |

## Important limits

- CPU is a point-in-time sample, not an average or a peak. Do not resize from one sample alone.
- Network and block I/O are cumulative counters. Compare them together with container start time.
- Writable-layer attribution deliberately excludes shared images, named volumes, bind mounts, database files on the host, and log files outside the container layer. These cannot be assigned safely without additional mount-level evidence.
- Old retained scans without normalized metrics are labelled unavailable. Missing values are never displayed as zero.
- Repository update time is shown only when the runtime service has a deterministic repository match.

Use repeated samples and host-level history before moving a workload. The current view is designed for triage and evidence collection, not automatic placement.
