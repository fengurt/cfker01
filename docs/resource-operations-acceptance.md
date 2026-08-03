# Resource Operations Acceptance Checklist

Each requirement must have automated evidence before production promotion. The checklist is intentionally kept in the repository so a release reviewer can copy it into a PR or deployment record.

## Documentation gate

- [ ] ROP-001, ROP-002, ROP-003, ROP-004 and ROP-005 are represented by the product, trust and safety sections below.
- [ ] `CONTEXT.md` uses the canonical terms without implementation detail.
- [ ] `ROP-001` through `ROP-025` each appear exactly once in the specification.
- [ ] Every ROP ID is mapped to a test or operational evidence below.
- [ ] Required ADR links resolve.

## Security and recovery

- [ ] ROP-012, ROP-018, ROP-019 and ROP-021 are covered by the security, organization, Agent and recovery checks below.
- [ ] 90-day trusted-device login survives reload and can be revoked.
- [ ] Sensitive actions reject sessions older than 15 minutes without reauthentication.
- [ ] Role and Agent scope tests prevent cross-organization and external writes.
- [ ] Hourly encrypted PostgreSQL and daily D1 backups are present.
- [ ] Monthly restore verification proves counts and checksums with RPO/RTO evidence.

## Truth and monitoring

- [ ] ROP-006, ROP-007 and ROP-008 are covered by the Project, lifecycle and freshness checks below.
- [ ] Field authority and annotation precedence tests pass.
- [ ] Freshness boundary tests cover exactly-on-time, stale and twice-stale facts.
- [ ] Active/maintenance/experimental/archived/unclassified/ignored lifecycle tests pass.
- [ ] Stale facts do not count as healthy or eligible placement candidates.

## Incidents and execution

- [ ] ROP-009, ROP-010, ROP-016 and ROP-017 are covered by the Incident, Task and notification checks below.
- [ ] Root-cause deduplication collapses dependent failures.
- [ ] P0–P3 severity and quiet-hour notification tests pass.
- [ ] P0/P1 create idempotent Task links and SMS delivery records.
- [ ] Recovery closes the Incident and sends a recovery notification.
- [ ] Concurrent Incident edits return a version conflict.

## Snapshot and placement

- [ ] ROP-011, ROP-020 and ROP-024 are covered by the placement, snapshot and requirement checks below.
- [ ] Snapshot V2 includes schema version, freshness, evidence and exclusion reasons.
- [ ] API, MCP and copy output are byte-equivalent after serialization.
- [ ] Secrets, IPs, private paths, source excerpts and unpublished candidates are absent.
- [ ] Missing requirements return `insufficient_data`.
- [ ] Eligible placement returns at most three ranked candidates and deterministic reasons.

## Release and UX

- [ ] ROP-013, ROP-014, ROP-015, ROP-022, ROP-023 and ROP-025 are covered by the publication, metrics, freeze, staging, role and sequencing checks below.
- [ ] Login, task creation, Incident acknowledgement, scan refresh and device revoke pass in a browser.
- [ ] Staging and production use the same immutable image digest.
- [ ] Production migration is blocked when backup or health checks fail.
- [ ] Failed promotion restores the previous image without data rollback.
- [ ] Home p95 load is below 2 seconds and critical interaction latency below 300ms.
- [ ] Production smoke tests are read-only; mutation tests use staging or a marked test organization.

## Success report

Every promotion records freshness compliance, P0/P1 creation latency, Incident ownership, login success rate, homepage latency, critical-journey results, backup age and restore evidence.
