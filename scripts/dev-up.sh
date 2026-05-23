#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CFKER_PORT:-8787}"
URL="http://127.0.0.1:${PORT}"

cd "$ROOT"

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PORT} already in use — assuming cfker01 dev server is running."
  echo "App URL: ${URL}"
  open "${URL}" 2>/dev/null || true
  exit 0
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run d1:migrate:local
npm run types

echo "Starting cfker01 dev server on ${URL} ..."
npm run dev -- --port "${PORT}" &
DEV_PID=$!

trap 'kill "${DEV_PID}" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -sf "${URL}/health" >/dev/null 2>&1; then
    echo "Ready: ${URL}"
    open "${URL}" 2>/dev/null || true
    wait "${DEV_PID}"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for dev server on port ${PORT}" >&2
exit 1
