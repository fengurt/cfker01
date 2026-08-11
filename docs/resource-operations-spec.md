# Resource Operations Specification

Status: accepted. This is the normative product and operating contract for the 90-day resource-operations work. Canonical domain terms live in [CONTEXT.md](../CONTEXT.md); code-level choices that are hard to reverse live in [docs/adr](./adr/).

## Product contract

| ID | Accepted decision |
| --- | --- |
| ROP-001 | The primary product is a trusted resource-operations decision console. |
| ROP-002 | The home view answers what is broken, what expires soon and what should happen next. |
| ROP-003 | Unverified, stale or ambiguous data cannot drive health totals or deployment advice. |
| ROP-004 | External infrastructure is read-only by default; writes require explicit approval and audit. |
| ROP-005 | Authority is field-specific: provider facts, runtime facts, Git facts, DNS facts, probes and human annotations have separate owners. |
| ROP-006 | A Project is a business product; repositories, workspaces, deployments and infrastructure are related Assets. |
| ROP-007 | Projects use active, maintenance, experimental, archived, unclassified and ignored lifecycles. |
| ROP-008 | Freshness SLAs are 5m health, 15m runtime, 1h DNS, 4h cloud/GitHub/local and daily expiry verification. |
| ROP-009 | Actionable failures are deduplicated Incidents with severity, evidence, ownership, recovery and a Task link. |
| ROP-010 | Task Core is the operations execution layer, not a general Linear replacement during this period. |
| ROP-011 | Placement first applies hard exclusions, then ranks eligible servers using capacity, risk, topology and migration evidence. |
| ROP-012 | Trusted devices last 90 days; sensitive actions require recent reauthentication; IP is only a risk signal. |
| ROP-013 | Catalog data is private by default and enters public views only through field-level publication. |
| ROP-014 | Success is measured by freshness, incident response, ownership, latency, login reliability and complete critical journeys, not record count. |
| ROP-015 | New feature work is frozen for two weeks while trust and release gates are repaired. |
| ROP-016 | P0/P1/P2/P3 define notification urgency; night-time interruption is limited to P0/P1. |
| ROP-017 | All Incidents enter the in-app inbox; P0/P1 use Tencent SMS and recovery notifications. |
| ROP-018 | The product operates one default organization while preserving organization-scoped data and keys. |
| ROP-019 | Agents can write scoped internal collaboration data, never external infrastructure or P0/P1 closure. |
| ROP-020 | Resource snapshots are versioned, redacted decision inputs and identical across API, MCP and copy actions. |
| ROP-021 | Task/Incident data has RPO ≤1h and RTO ≤2h with encrypted backups and monthly restore drills. |
| ROP-022 | Staging runs the same AMD Docker runtime and the same immutable commit/image before production promotion. |
| ROP-023 | system_admin, operator, editor, viewer and agent have separate minimum permissions. |
| ROP-024 | A deployment recommendation requires confirmed runtime and capacity constraints; missing constraints return insufficient_data. |
| ROP-025 | Work proceeds in order: security/recovery, truth, Incident loop, decision UI, Agent interfaces, release gates. |

## Frozen scope

During the two-week freeze, only production defects, security, recovery, truth/freshness, Incident handling, critical journey tests and release-gate work are allowed. New SaaS connectors, generic Task features, automatic Benchmark discovery and external write actions are deferred.

## Severity contract

- **P0**: multiple production projects unavailable, data loss, compromise or core console outage.
- **P1**: one critical production project unavailable, imminent disk exhaustion, backup failure or expiry within 24 hours.
- **P2**: degraded performance, version drift, expiry within 7 days or stale monitoring.
- **P3**: missing description, classification, low-confidence relationship or non-urgent improvement.

## Freshness contract

Facts outside their SLA are `stale`; facts older than twice their SLA leave health aggregates and create a monitoring-gap Incident. A stale fact may remain visible for investigation but cannot be presented as current or healthy.
