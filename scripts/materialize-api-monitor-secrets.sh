#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-.env.api-monitor}"
REFS_FILE="${ONEPASSWORD_REFS_FILE:-.env.1password}"
[[ "$TARGET" == ".env.api-monitor" || "$TARGET" == ".env.docker" ]] || { echo "target must be .env.api-monitor or .env.docker" >&2; exit 2; }
command -v op >/dev/null || { echo "1Password CLI (op) is required" >&2; exit 2; }
[[ -f "$REFS_FILE" ]] || { echo "missing $REFS_FILE" >&2; exit 2; }
set -a; source "$REFS_FILE"; set +a
read_ref(){ local name="$1" ref="${!1:-}"; [[ "$ref" == op://* ]] || return 1; op read "$ref"; }
umask 077
{
  for pair in API_MONITOR_KEY:API_MONITOR_KEY_REF DOUBAO_API_KEY:DOUBAO_API_KEY_REF MINIMAX_API_KEY:MINIMAX_API_KEY_REF MINIMAX_SUBSCRIPTION_KEY:MINIMAX_SUBSCRIPTION_KEY_REF OPENAI_API_KEY:OPENAI_API_KEY_REF PERPLEXITY_API_KEY:PERPLEXITY_API_KEY_REF MOONSHOT_API_KEY:MOONSHOT_API_KEY_REF GEMINI_API_KEY:GEMINI_API_KEY_REF; do
    key="${pair%%:*}"; ref_name="${pair##*:}"; ref="${!ref_name:-}"
    [[ -z "$ref" ]] || printf '%s=%s\n' "$key" "$(read_ref "$ref_name")"
  done
} > "$TARGET"
if [[ -n "${API_MONITOR_PROVIDER_ALLOWLIST:-}" ]]; then
  printf 'API_MONITOR_PROVIDER_ALLOWLIST=%s\n' "$API_MONITOR_PROVIDER_ALLOWLIST" >> "$TARGET"
fi
chmod 600 "$TARGET"
echo "Materialized $TARGET with mode 600; secret values were not printed."
