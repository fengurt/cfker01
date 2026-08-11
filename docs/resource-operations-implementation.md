# Resource operations implementation status

This document records the first implementation slice against the frozen
resource-operations contract. It is deliberately short so an agent can use it
as a release handoff without loading the whole repository.

## Delivered in this slice

- `operational-truth.ts` centralizes freshness SLAs and field-level authority.
- Migration `0016` adds project lifecycle, deployment requirements, operational
  facts, incidents, notification deliveries, and task outbox tables.
- Migration `0017` adds server region metadata used by placement checks.
- Incident classification is deterministic, fingerprinted, deduplicated, and
  version-locked. Monitor failures open incidents; recovery resolves them.
- `/api/admin/v1/incidents` provides inbox list/create/detail/update with the
  stable API envelope and optimistic version conflicts.
- `/api/admin/v1/deployment-requirements/:projectId` stores explicit deployment
  constraints; `/api/admin/v1/placement-recommendations/:projectId` returns at
  most three candidates and returns `insufficient_data` when facts are missing.
- Resource snapshot runtime eligibility now follows the 15-minute runtime SLA.
- The resource-monitoring UI shows a compact incident inbox with acknowledge
  actions; source status and deployment recommendations remain collapsible.
- Admin sessions accept the role hierarchy `viewer < editor < operator <
  system_admin`; legacy `/admin/*` routes remain system-admin-only.

## Release gates still required

Before staging promotion, wire the notification and incident-task outboxes to
the configured Task Core/SMS adapters, add the staging compose stack and
restore drill, and run the checklist in
[`resource-operations-acceptance.md`](./resource-operations-acceptance.md).
No external infrastructure mutation is performed by these APIs.
