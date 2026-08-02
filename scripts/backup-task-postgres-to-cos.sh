#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET="${SSH_TARGET:-opchom}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/tableai-catalog}"
COS_BUCKET="${COS_BUCKET:-tableai-catalog-backup-1308586823}"
COS_REGION="${COS_REGION:-ap-nanjing}"
COS_ENDPOINT="${COS_ENDPOINT:-cos.${COS_REGION}.myqcloud.com}"
: "${TASK_BACKUP_PASSPHRASE:?Load TASK_BACKUP_PASSPHRASE from 1Password before backup}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain="$(mktemp "${TMPDIR:-/tmp}/tableai-tasks-${timestamp}.XXXXXX.dump")"
encrypted="${plain}.enc"
checksum="${encrypted}.sha256"
trap 'rm -f "$plain" "$encrypted" "$checksum"' EXIT

command -v coscli >/dev/null || { echo "coscli is required" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }
ssh -o BatchMode=yes "$SSH_TARGET" "cd '$REMOTE_APP_DIR' && docker compose exec -T task-postgres pg_dump -U \"\${TASK_POSTGRES_USER:-tableai_tasks}\" -d \"\${TASK_POSTGRES_DB:-tableai_tasks}\" --format=custom --no-owner --no-acl" > "$plain"
[[ -s "$plain" ]] || { echo "PostgreSQL dump is empty" >&2; exit 1; }
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:TASK_BACKUP_PASSPHRASE -in "$plain" -out "$encrypted"
shasum -a 256 "$encrypted" > "$checksum"
coscli cp "$encrypted" "cos://${COS_BUCKET}/backups/tableai-tasks/daily/${timestamp}.dump.enc" --endpoint "$COS_ENDPOINT"
coscli cp "$checksum" "cos://${COS_BUCKET}/backups/tableai-tasks/daily/${timestamp}.dump.enc.sha256" --endpoint "$COS_ENDPOINT"
if [[ "$(date -u +%d)" == "01" ]]; then
  month="$(date -u +%Y-%m)"
  coscli cp "$encrypted" "cos://${COS_BUCKET}/backups/tableai-tasks/monthly/${month}.dump.enc" --endpoint "$COS_ENDPOINT"
  coscli cp "$checksum" "cos://${COS_BUCKET}/backups/tableai-tasks/monthly/${month}.dump.enc.sha256" --endpoint "$COS_ENDPOINT"
fi
echo "Encrypted Task PostgreSQL backup uploaded: cos://${COS_BUCKET}/backups/tableai-tasks/daily/${timestamp}.dump.enc"
