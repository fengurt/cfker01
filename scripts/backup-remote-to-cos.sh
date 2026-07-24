#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET="${SSH_TARGET:-opchom}"
COS_BUCKET="${COS_BUCKET:-tableai-catalog-backup-1308586823}"
COS_REGION="${COS_REGION:-ap-nanjing}"
COS_ENDPOINT="${COS_ENDPOINT:-cos.${COS_REGION}.myqcloud.com}"
REMOTE_VOLUME="${REMOTE_VOLUME:-tableai-catalog_tableai_data}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$(mktemp "${TMPDIR:-/tmp}/tableai-catalog-${timestamp}.XXXXXX.tgz")"
checksum="${archive}.sha256"
trap 'rm -f "$archive" "$checksum"' EXIT

command -v coscli >/dev/null || { echo "coscli is required" >&2; exit 2; }
ssh -o BatchMode=yes "$SSH_TARGET" \
  "volume_path=\$(docker volume inspect --format '{{.Mountpoint}}' ${REMOTE_VOLUME}) && tar -C \"\$volume_path\" -czf - ." > "$archive"
shasum -a 256 "$archive" > "$checksum"
coscli cp "$archive" "cos://${COS_BUCKET}/backups/tableai-catalog/${timestamp}.tgz" --endpoint "$COS_ENDPOINT"
coscli cp "$checksum" "cos://${COS_BUCKET}/backups/tableai-catalog/${timestamp}.tgz.sha256" --endpoint "$COS_ENDPOINT"
echo "Backup uploaded to cos://${COS_BUCKET}/backups/tableai-catalog/${timestamp}.tgz"
