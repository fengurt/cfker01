#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:?Usage: verify-task-backup.sh <encrypted-backup>}"
: "${TASK_BACKUP_PASSPHRASE:?Load TASK_BACKUP_PASSPHRASE from 1Password}"
plain="$(mktemp "${TMPDIR:-/tmp}/tableai-task-restore.XXXXXX.dump")"
container="tableai-task-restore-${RANDOM}"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -f "$plain"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:TASK_BACKUP_PASSPHRASE -in "$BACKUP_FILE" -out "$plain"
docker run -d --name "$container" -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=tableai_restore postgres:16-bookworm >/dev/null
for _ in {1..30}; do docker exec "$container" pg_isready -U postgres -d tableai_restore >/dev/null 2>&1 && break; sleep 1; done
docker cp "$plain" "$container:/tmp/tasks.dump"
docker exec "$container" pg_restore -U postgres -d tableai_restore --no-owner --no-acl /tmp/tasks.dump
docker exec "$container" psql -U postgres -d tableai_restore -v ON_ERROR_STOP=1 -c "SELECT count(*) AS tasks FROM tasks; SELECT count(*) AS events FROM task_events;"
echo "Task backup restore verification passed."
