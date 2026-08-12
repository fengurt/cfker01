#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.tableai.api-monitor"
TARGET="${HOME}/Library/LaunchAgents/${LABEL}.plist"
KEY="${API_MONITOR_KEY:-}"
NODE="${NODE_BIN:-$(command -v node)}"

[[ -f "${ROOT}/.env.api-monitor" ]] || { echo "Materialize .env.api-monitor first." >&2; exit 1; }
[[ "${KEY}" == tais_* ]] || { echo "Set API_MONITOR_KEY to the scoped api-probes:write key." >&2; exit 1; }
mkdir -p "${HOME}/Library/LaunchAgents" "${ROOT}/.cache/api-monitor"
chmod 0700 "${ROOT}/.cache/api-monitor"
chmod 0600 "${ROOT}/.env.api-monitor"
security add-generic-password -U -s "TableAI-Catalog-API-Monitor" -a api-monitor -w "${KEY}" >/dev/null

sed -e "s|__NODE__|${NODE}|g" -e "s|__ROOT__|${ROOT}|g" "${ROOT}/deploy/launchd/${LABEL}.plist" > "${TARGET}"
chmod 0600 "${TARGET}"
launchctl bootout "gui/${UID}/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID}" "${TARGET}"
launchctl kickstart -k "gui/${UID}/${LABEL}"
echo "Installed ${LABEL}; OpenAI and Perplexity run once now and every 24 hours."
