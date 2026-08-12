#!/usr/bin/env bash
set -euo pipefail

SOURCE="${1:?source env file is required}"
TARGET="${2:?target env file is required}"
[[ -f "$SOURCE" ]] || { echo "missing source env file" >&2; exit 2; }
[[ -f "$TARGET" ]] || { echo "missing target env file" >&2; exit 2; }

ALLOWED_KEYS=(
  DOUBAO_API_KEY
  MINIMAX_API_KEY
  MINIMAX_SUBSCRIPTION_KEY
  OPENAI_API_KEY
  PERPLEXITY_API_KEY
  MOONSHOT_API_KEY
  GEMINI_API_KEY
  DOUBAO_ARK_CREDENTIAL_EXPIRES_AT
  MINIMAX_API_CREDENTIAL_EXPIRES_AT
  MINIMAX_CODING_PLAN_CREDENTIAL_EXPIRES_AT
  MINIMAX_CODING_PLAN_SUBSCRIPTION_EXPIRES_AT
  MINIMAX_CODING_PLAN_QUOTA_RESETS_AT
  OPENAI_CREDENTIAL_EXPIRES_AT
  PERPLEXITY_CREDENTIAL_EXPIRES_AT
  MOONSHOT_CREDENTIAL_EXPIRES_AT
  GEMINI_CREDENTIAL_EXPIRES_AT
  API_MONITOR_PROVIDER_ALLOWLIST
)

umask 077
temporary="$(mktemp "${TARGET}.api-monitor.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
cp "$TARGET" "$temporary"
for key in "${ALLOWED_KEYS[@]}"; do
  value="$(sed -n "s/^${key}=//p" "$SOURCE" | head -1)"
  [[ -n "$value" ]] || continue
  sed -i.bak "/^${key}=/d" "$temporary"
  rm -f "${temporary}.bak"
  printf '%s=%s\n' "$key" "$value" >> "$temporary"
done
chmod 600 "$temporary"
mv "$temporary" "$TARGET"
trap - EXIT
echo "Installed allowlisted API monitor credentials with mode 600; values were not printed."
