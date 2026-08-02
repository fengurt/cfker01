# Task collaboration core

The Task workspace uses one business service for the browser, REST API, MCP, realtime events, and webhooks. PostgreSQL is authoritative. Valkey is an ephemeral broadcast, presence, and cache layer; restarting it does not lose task history.

## Topology

The AMD64 Docker stack adds three services:

- `task-postgres`: organizations, projects, tasks, boards, comments, immutable events, idempotency records, API keys, and webhook outbox.
- `task-valkey`: WebSocket fan-out and 30-second presence records. Persistence is deliberately disabled.
- `task-core`: REST `/api/task/v1/*`, MCP `/mcp/task`, and WebSocket `/api/task/v1/realtime`.

Nginx sends these paths directly to loopback port 8790. Legacy `/api/admin/v1/tasks*` and task tools on `/mcp` are authenticated by the catalog Worker and forwarded to Task Core. If Task Core is not configured, the D1 implementation remains a development fallback; production writes must use PostgreSQL.

## Authorization and consistency

Human sessions use the shared `SESSION_SIGNING_KEY`. Resource administration still requires `system_admin`. Task API keys begin with `tsk_`, are stored only as SHA-256 hashes, belong to one organization, and can be restricted to projects, operations, and fields. Agents are separate principals.

Every task carries an integer `version`. PATCH and transition requests require both the current `version` and `If-Match`. A stale write receives `409 version_conflict` with the current task and changed fields. Appending comments does not consume a task version. Mutations accept `Idempotency-Key`; a repeated request with the same body returns the original response, while reuse with a different body is rejected.

Example:

```bash
curl -X PATCH https://g.ksamint.cn/api/task/v1/tasks/T-000001 \
  -H "Authorization: Bearer $TASK_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: agent-run-42-step-3" \
  -H 'If-Match: 7' \
  --data '{"version":7,"changes":{"status":"in_progress"}}'
```

API responses use `{data,meta}`. Errors use `{error:{code,message,requestId,details}}`. A task belongs to one organization, can link to multiple projects with exactly one optional primary project, and can appear on multiple boards. Board membership owns only lane, rank, and membership version; task status remains global.

## MCP and realtime

Connect agents to `https://g.ksamint.cn/mcp/task` with the Task API key as a Bearer token. Tools cover organizations, projects, tasks, project links, comments, boards, and events. Snapshot resources are:

- `ops://tasks/snapshot`
- `ops://organizations/{id}/tasks/snapshot`
- `ops://boards/{id}/snapshot`

The browser connects to `/api/task/v1/realtime?organizationId=...&cursor=...`. Task Core first replays PostgreSQL events after the cursor, then sends `ready`. Clients ping every 15 seconds. Presence messages expire after 30 seconds. PostgreSQL event sequence is the recovery cursor after a disconnect or Valkey restart.

## D1 migration

The migration is deliberately two-phase. First deploy an empty Task Core and confirm health. Then export D1, import preserving task IDs and identifiers, compare counts, and switch compatible routes.

```bash
# Inspect counts without writing.
npm run task-core:migrate -- --remote --env production --dry-run

# Creates a gitignored D1 SQL backup before importing.
TASK_CORE_URL=http://127.0.0.1:8790 \
TASK_CORE_INTERNAL_TOKEN='loaded-from-1password' \
npm run task-core:migrate -- --remote --env production
```

The legacy D1 tables are not mutated by Task Core and should be retained read-only for 30 days. Do not remove them until task, comment, dependency, participant, activity, and saved-view counts and checksums have been reviewed.

## Backup and recovery

`npm run task-core:backup:cos` streams `pg_dump --format=custom` over SSH, encrypts it with a separate PBKDF2-derived AES key, uploads the ciphertext plus SHA-256 checksum to the private COS backup bucket, and deletes temporary plaintext. Configure COS lifecycle rules for 30 daily copies and 12 monthly copies.

Before rollout and at least monthly, download one backup and run:

```bash
TASK_BACKUP_PASSPHRASE='loaded-from-1password' \
npm run task-core:restore:verify -- /path/to/backup.dump.enc
```

The verification restores into a disposable PostgreSQL container and queries task and event counts. Valkey is never restored.

## Operations

```bash
docker compose ps task-postgres task-valkey task-core
docker compose logs --tail=100 task-core
curl -fsS http://127.0.0.1:8790/health
npm run task-core:test
```

Monitor PostgreSQL connections, REST latency/error rate, active WebSockets, event broadcast delay, conflict rate, webhook retries, and backup age. Webhook bodies are HMAC signed with event ID and Unix timestamp headers; failed deliveries use exponential backoff and can be replayed by an organization admin.
