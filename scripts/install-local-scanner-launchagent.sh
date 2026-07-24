#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.tableai.local-scanner"
TARGET="${HOME}/Library/LaunchAgents/${LABEL}.plist"
KEY="${SCANNER_KEY:-}"

if [[ -z "${KEY}" && -n "${OP_SCANNER_KEY_REF:-}" ]]; then
  command -v op >/dev/null || { echo "1Password CLI is required for OP_SCANNER_KEY_REF" >&2; exit 1; }
  KEY="$(op read "${OP_SCANNER_KEY_REF}")"
fi
if [[ "${KEY}" != tais_* ]]; then
  echo "Set SCANNER_KEY or an explicit OP_SCANNER_KEY_REF to the local scoped service key." >&2
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${ROOT}/.cache/local-scanner"
chmod 0700 "${ROOT}/.cache/local-scanner"
security add-generic-password -U -s "TableAI-Catalog-Local-Scanner" -a scanner -w "${KEY}" >/dev/null

NODE="$(command -v node)"
ESCAPED_PATH="$(printf '%s' "${PATH}" | sed 's/[&|]/\\&/g')"
sed -e "s|__NODE__|${NODE}|g" -e "s|__ROOT__|${ROOT}|g" -e "s|__PATH__|${ESCAPED_PATH}|g" "${ROOT}/deploy/launchd/${LABEL}.plist" > "${TARGET}"
chmod 0600 "${TARGET}"
launchctl bootout "gui/${UID}/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID}" "${TARGET}"
launchctl kickstart -k "gui/${UID}/${LABEL}"
echo "Installed ${LABEL}; polls every 15 minutes and scans only when a job is due."
