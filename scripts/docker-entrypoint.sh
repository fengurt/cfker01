#!/usr/bin/env bash
set -euo pipefail

: "${ADMIN_TOKEN:?ADMIN_TOKEN is required}"
: "${API_KEY_SALT:?API_KEY_SALT is required}"

PERSIST_DIR="${PERSIST_DIR:-/data}"
PORT="${PORT:-8787}"
mkdir -p "$PERSIST_DIR"

umask 077
{
  printf 'ADMIN_TOKEN=%s\n' "$ADMIN_TOKEN"
  printf 'API_KEY_SALT=%s\n' "$API_KEY_SALT"
  printf 'APP_NAME=%s\n' "${APP_NAME:-tableai-catalog}"
  printf 'ENVIRONMENT=%s\n' "${ENVIRONMENT:-self-hosted}"
  printf 'STATUS_PAGE_TITLE=%s\n' "${STATUS_PAGE_TITLE:-TableAI catalog status}"
  printf 'COOKIE_SECURE=%s\n' "${COOKIE_SECURE:-true}"
  [[ -n "${CONTENT_ENCRYPTION_KEY:-}" ]] && printf 'CONTENT_ENCRYPTION_KEY=%s\n' "$CONTENT_ENCRYPTION_KEY"
  printf 'CONTENT_KEY_VERSION=%s\n' "${CONTENT_KEY_VERSION:-v1}"
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] && printf 'CLOUDFLARE_API_TOKEN=%s\n' "$CLOUDFLARE_API_TOKEN"
  [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] && printf 'CLOUDFLARE_ACCOUNT_ID=%s\n' "$CLOUDFLARE_ACCOUNT_ID"
  [[ -n "${OPENAI_API_KEY:-}" ]] && printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY"
  [[ -n "${MINIMAX_API_KEY:-}" ]] && printf 'MINIMAX_API_KEY=%s\n' "$MINIMAX_API_KEY"
  [[ -n "${PERPLEXITY_API_KEY:-}" ]] && printf 'PERPLEXITY_API_KEY=%s\n' "$PERPLEXITY_API_KEY"
  [[ -n "${X_BEARER_TOKEN:-}" ]] && printf 'X_BEARER_TOKEN=%s\n' "$X_BEARER_TOKEN"
  [[ -n "${GITHUB_TOKEN:-}" ]] && printf 'GITHUB_TOKEN=%s\n' "$GITHUB_TOKEN"
  [[ -n "${SEMANTIC_SCHOLAR_API_KEY:-}" ]] && printf 'SEMANTIC_SCHOLAR_API_KEY=%s\n' "$SEMANTIC_SCHOLAR_API_KEY"
  [[ -n "${INTERNAL_MONITOR_TOKEN:-}" ]] && printf 'INTERNAL_MONITOR_TOKEN=%s\n' "$INTERNAL_MONITOR_TOKEN"
  [[ -n "${LOCAL_SCAN_ROOT:-}" ]] && printf 'LOCAL_SCAN_ROOT=%s\n' "$LOCAL_SCAN_ROOT"
  [[ -n "${SESSION_SIGNING_KEY:-}" ]] && printf 'SESSION_SIGNING_KEY=%s\n' "$SESSION_SIGNING_KEY"
  [[ -n "${TASK_CORE_URL:-}" ]] && printf 'TASK_CORE_URL=%s\n' "$TASK_CORE_URL"
  [[ -n "${TASK_CORE_INTERNAL_TOKEN:-}" ]] && printf 'TASK_CORE_INTERNAL_TOKEN=%s\n' "$TASK_CORE_INTERNAL_TOKEN"
} > .dev.vars

MIGRATION_LOG="$(mktemp)"
set +e
timeout --signal=INT --kill-after=5s 30s \
  npx wrangler d1 migrations apply cfker01-mgmt --local --persist-to "$PERSIST_DIR" \
  2>&1 | tee "$MIGRATION_LOG"
MIGRATION_STATUS="${PIPESTATUS[0]}"
set -e
if [[ "$MIGRATION_STATUS" -ne 0 ]]; then
  if [[ "$MIGRATION_STATUS" -eq 124 ]] && \
    grep -Eq 'No migrations to apply|commands? executed successfully' "$MIGRATION_LOG"; then
    echo "Wrangler migration completed but kept a network handle open; startup is continuing."
  else
    echo "D1 migration failed with status ${MIGRATION_STATUS}." >&2
    rm -f "$MIGRATION_LOG"
    exit "$MIGRATION_STATUS"
  fi
fi
rm -f "$MIGRATION_LOG"

exec npx wrangler dev \
  --local \
  --ip 0.0.0.0 \
  --port "$PORT" \
  --persist-to "$PERSIST_DIR"
