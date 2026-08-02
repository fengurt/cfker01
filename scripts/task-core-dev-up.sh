#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ROOT}/.wrangler"
ENV_FILE="${STATE_DIR}/task-core-dev.env"
PORT_FILE="${STATE_DIR}/task-core-dev.port"
TOKEN_FILE="${STATE_DIR}/task-core-dev.token"
mkdir -p "$STATE_DIR"

command -v docker >/dev/null || { echo "Docker is required for the local Task collaboration core" >&2; exit 2; }
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  {
    printf 'TASK_POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SESSION_SIGNING_KEY=%s\n' "$(openssl rand -base64 48 | tr -d '\n')"
    printf 'TASK_CORE_INTERNAL_TOKEN=%s\n' "$(openssl rand -base64 48 | tr -d '\n')"
    printf 'TASK_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
  } > "$ENV_FILE"
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

port_free(){ ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
port="${TASK_CORE_DEV_PORT:-}"
if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ ]] || ! port_free "$port"; then
  port=""
  for candidate in 8790 8791 8792 8793 8794 8795 8796 8797 8798 8799; do
    if port_free "$candidate"; then port="$candidate"; break; fi
  done
fi
[[ -n "$port" ]] || { echo "No free local Task Core port in 8790-8799" >&2; exit 1; }
export TASK_CORE_DEV_PORT="$port"
docker compose -p tableai-task-dev --env-file "$ENV_FILE" -f "$ROOT/docker-compose.task-dev.yml" up -d --build >/dev/null
for _ in {1..40}; do
  curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:${port}/health" >/dev/null
printf '%s\n' "$port" > "$PORT_FILE"
printf '%s\n' "$TASK_CORE_INTERNAL_TOKEN" > "$TOKEN_FILE"
chmod 600 "$ENV_FILE" "$PORT_FILE" "$TOKEN_FILE"
echo "Task Core ready on http://127.0.0.1:${port}"
