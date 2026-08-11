#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-.env.tencent.local}"
[[ "$TARGET" == ".env.tencent.local" || "$TARGET" == ".env.local" ]] || { echo "target must be .env.tencent.local or .env.local" >&2; exit 2; }
command -v op >/dev/null || { echo "1Password CLI (op) is required" >&2; exit 2; }
: "${OP_TENCENT_SECRET_ID_REF:=op://Personal/Tencent-APUCH-oss/add more/tencent-SecretId-01}"
: "${OP_TENCENT_SECRET_KEY_REF:=op://Personal/Tencent-APUCH-oss/add more/tencent-SecretKey-01}"
: "${TENCENT_REGION:=ap-guangzhou}"
[[ "$OP_TENCENT_SECRET_ID_REF" == op://* && "$OP_TENCENT_SECRET_KEY_REF" == op://* ]] || { echo "exact Tencent 1Password references are required" >&2; exit 2; }
secret_id="$(op read "$OP_TENCENT_SECRET_ID_REF")"
secret_key="$(op read "$OP_TENCENT_SECRET_KEY_REF")"
[[ -n "$secret_id" && -n "$secret_key" ]] || { echo "Tencent credential fields are empty" >&2; exit 2; }
umask 077
{
  printf 'TENCENT_SECRET_ID=%s\n' "$secret_id"
  printf 'TENCENT_SECRET_KEY=%s\n' "$secret_key"
  printf 'TENCENT_REGION=%s\n' "$TENCENT_REGION"
} > "$TARGET"
chmod 600 "$TARGET"
echo "Materialized $TARGET with mode 600; secret values were not printed."
