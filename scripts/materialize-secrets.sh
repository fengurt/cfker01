#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-.dev.vars}"
REFS_FILE="${ONEPASSWORD_REFS_FILE:-.env.1password}"
[[ "$TARGET" == ".dev.vars" || "$TARGET" == ".env.docker" ]] || { echo "target must be .dev.vars or .env.docker" >&2; exit 2; }
command -v op >/dev/null || { echo "1Password CLI (op) is required" >&2; exit 2; }
[[ -f "$REFS_FILE" ]] || { echo "missing $REFS_FILE; copy config/onepassword.refs.example and set exact op:// references" >&2; exit 2; }
set -a
source "$REFS_FILE"
set +a

read_ref(){ local name="$1" ref="${!1:-}"; [[ "$ref" == op://* ]] || { echo "missing or invalid $name" >&2; exit 2; }; op read "$ref"; }
admin_token="$(read_ref ADMIN_TOKEN_REF)"
api_salt="$(read_ref API_KEY_SALT_REF)"
content_key="$(read_ref CONTENT_ENCRYPTION_KEY_REF)"
session_signing_key="$(read_ref SESSION_SIGNING_KEY_REF)"
task_core_internal_token="$(read_ref TASK_CORE_INTERNAL_TOKEN_REF)"
task_encryption_key="$(read_ref TASK_ENCRYPTION_KEY_REF)"
task_postgres_password="$(read_ref TASK_POSTGRES_PASSWORD_REF)"
task_backup_passphrase="$(read_ref TASK_BACKUP_PASSPHRASE_REF)"
internal_monitor_token="$(read_ref INTERNAL_MONITOR_TOKEN_REF)"
umask 077
{
  printf 'ADMIN_TOKEN=%s\n' "$admin_token"
  printf 'API_KEY_SALT=%s\n' "$api_salt"
  printf 'CONTENT_ENCRYPTION_KEY=%s\n' "$content_key"
  printf 'CONTENT_KEY_VERSION=v1\n'
  printf 'SESSION_SIGNING_KEY=%s\n' "$session_signing_key"
  printf 'TASK_CORE_INTERNAL_TOKEN=%s\n' "$task_core_internal_token"
  printf 'TASK_ENCRYPTION_KEY=%s\n' "$task_encryption_key"
  printf 'TASK_POSTGRES_PASSWORD=%s\n' "$task_postgres_password"
  printf 'TASK_POSTGRES_DB=tableai_tasks\n'
  printf 'TASK_POSTGRES_USER=tableai_tasks\n'
  printf 'TASK_BACKUP_PASSPHRASE=%s\n' "$task_backup_passphrase"
  printf 'INTERNAL_MONITOR_TOKEN=%s\n' "$internal_monitor_token"
  for pair in PERPLEXITY_API_KEY:PERPLEXITY_API_KEY_REF X_BEARER_TOKEN:X_BEARER_TOKEN_REF MINIMAX_API_KEY:MINIMAX_API_KEY_REF GITHUB_TOKEN:GITHUB_TOKEN_REF SEMANTIC_SCHOLAR_API_KEY:SEMANTIC_SCHOLAR_API_KEY_REF CLOUDFLARE_API_TOKEN:CLOUDFLARE_API_TOKEN_REF CLOUDFLARE_ACCOUNT_ID:CLOUDFLARE_ACCOUNT_ID_REF GODADDY_API_TOKEN:GODADDY_API_TOKEN_REF GODADDY_ACCOUNT_ID:GODADDY_ACCOUNT_ID_REF ENS_RPC_URL:ENS_RPC_URL_REF; do
    key="${pair%%:*}"; ref_name="${pair##*:}"; ref="${!ref_name:-}"
    [[ -z "$ref" ]] || printf '%s=%s\n' "$key" "$(read_ref "$ref_name")"
  done
} > "$TARGET"
echo "Materialized $TARGET with mode 600; secret values were not printed."
