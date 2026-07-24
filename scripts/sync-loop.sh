#!/usr/bin/env bash
set -euo pipefail

: "${WORKER_URL:=http://catalog:8787}"
: "${SYNC_TIMEOUT_SECONDS:=2700}"
: "${ASSET_DISCOVERY_PROVIDERS:=tencent,github,docker,cloudflare,godaddy}"

mkdir -p "${HOME}" /data/assets
umask 077

if [[ -n "${TENCENT_SECRET_ID:-}" && -n "${TENCENT_SECRET_KEY:-}" ]]; then
  tccli configure set secretId "${TENCENT_SECRET_ID}" secretKey "${TENCENT_SECRET_KEY}" region "${TENCENT_REGION:-ap-guangzhou}" output json >/dev/null
  coscli config set --secret_id "${TENCENT_SECRET_ID}" --secret_key "${TENCENT_SECRET_KEY}" --disable-log >/dev/null
fi

run_sync_legacy() {
  local started status=0
  started="$(date -u +%FT%TZ)"
  echo "{\"event\":\"asset_sync_started\",\"at\":\"${started}\"}"
  timeout --signal=TERM --kill-after=30 "${SYNC_TIMEOUT_SECONDS}" \
    node ./scripts/discover-assets.mjs --upload || status=$?
  if [[ "$status" -eq 0 ]]; then
    date -u +%FT%TZ > /data/assets/last-success
    rm -f /data/assets/last-error
    echo "{\"event\":\"asset_sync_completed\",\"at\":\"$(date -u +%FT%TZ)\"}"
  else
    printf '%s exit=%s\n' "$(date -u +%FT%TZ)" "$status" > /data/assets/last-error
    echo "{\"event\":\"asset_sync_failed\",\"at\":\"$(date -u +%FT%TZ)\",\"exitCode\":${status}}" >&2
  fi
}

if [[ -n "${SCANNER_KEY:-}" ]]; then
  exec node ./scripts/scanner-loop.mjs
fi

: "${ADMIN_TOKEN:?SCANNER_KEY is required; ADMIN_TOKEN is accepted only for the compatibility scanner}"
: "${SYNC_INTERVAL_SECONDS:=14400}"
echo '{"event":"scanner.compatibility_mode","warning":"configure SCANNER_KEY to enable queued ingestion"}' >&2
while true; do run_sync_legacy; sleep "${SYNC_INTERVAL_SECONDS}"; done
