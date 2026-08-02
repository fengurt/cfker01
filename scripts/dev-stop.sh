#!/usr/bin/env bash
# scripts/dev-stop.sh — kill any cfker01 dev server started by dev-up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ROOT}/.wrangler/dev-up.pid"
PORT_FILE="${ROOT}/.wrangler/dev-up.port"
URL_FILE="${ROOT}/.wrangler/dev-up.url"

is_alive() { [[ -n "$1" ]] && kill -0 "$1" 2>/dev/null; }

pid_cwd() {
  lsof -a -p "$1" -d cwd -F n 2>/dev/null | awk '/^n/ {sub(/^n/,""); print; exit}'
}

is_own_process() {
  local cwd
  cwd="$(pid_cwd "$1")"
  [[ "$cwd" == "$ROOT" || "$cwd" == "$ROOT/"* ]]
}

kill_tree() {
  local pid="$1" children
  is_alive "$pid" || return 0
  is_own_process "$pid" || { echo "skip pid $pid outside $ROOT" >&2; return 0; }
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  if [[ -n "$children" ]]; then
    while read -r child; do [[ -n "$child" ]] && kill_tree "$child"; done <<<"$children"
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do is_alive "$pid" || break; sleep 0.1; done
  is_alive "$pid" && kill -9 "$pid" 2>/dev/null || true
}

if [[ -f "${PID_FILE}" ]]; then
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if is_alive "${pid}"; then
    echo "stop ${pid}"
    kill_tree "${pid}"
  fi
  rm -f "${PID_FILE}"
fi

# Belt-and-braces: any stray wrangler dev process for this repo
pgrep -f 'wrangler dev' 2>/dev/null | while read -r pid; do
  cwd="$(lsof -a -p "${pid}" -d cwd -F n 2>/dev/null | awk '/^n/ {sub(/^n/,""); print; exit}')"
  [[ -z "${cwd}" ]] && continue
  case "${cwd}" in
    "${ROOT}"/*|"${ROOT}") kill_tree "${pid}" ;;
  esac
done

rm -f "${PORT_FILE}" "${URL_FILE}"

if command -v docker >/dev/null 2>&1 && [[ -f "${ROOT}/docker-compose.task-dev.yml" ]]; then
  docker compose -p tableai-task-dev -f "${ROOT}/docker-compose.task-dev.yml" down >/dev/null 2>&1 || true
fi

echo "stopped"
