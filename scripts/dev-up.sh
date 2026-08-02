#!/usr/bin/env bash
# scripts/dev-up.sh — start cfker01 dev server on a free port.
#
# Behavior:
#   1. Scan CFKER_PORT_RANGE (default "8787 8788 8789 8790 8791 8792 8793 8794 8795 8796")
#      for the first free TCP port. If CFKER_PORT is set and free, use it.
#   2. Kill any previous cfker01 dev process found via:
#        - .wrangler/dev-up.pid (if it points to a live process whose cwd is this repo)
#        - wrangler dev children whose cwd is this repo
#      Refuses to kill listeners on the chosen port owned by another repo.
#   3. Start Wrangler with the chosen port and a free inspector port.
#   4. Poll /health, record the URL, and keep it running in the background.
# Set CFKER_FOREGROUND=true when logs should remain attached to this shell.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT_RANGE_DEFAULT=(8787 8788 8789 8790 8791 8792 8793 8794 8795 8796)
PID_FILE="${ROOT}/.wrangler/dev-up.pid"
PORT_FILE="${ROOT}/.wrangler/dev-up.port"
URL_FILE="${ROOT}/.wrangler/dev-up.url"

cd "$ROOT"

port_free() {
  local p="$1"
  ! lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1024 && $1 <= 65535 ))
}

is_alive() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

pid_cwd() {
  local pid="$1"
  lsof -a -p "${pid}" -d cwd -F n 2>/dev/null | awk '/^n/ {sub(/^n/,""); print; exit}'
}

# Same-repo process: cwd under ROOT (handle symlinked paths via realpath).
is_own_process() {
  local pid="$1"
  local cwd pid_real root_real
  cwd="$(pid_cwd "${pid}" 2>/dev/null || true)"
  if [[ -z "${cwd}" ]]; then
    return 1
  fi
  pid_real="$(cd "${cwd}" 2>/dev/null && pwd -P || echo "${cwd}")"
  root_real="$(cd "${ROOT}" && pwd -P)"
  [[ "${pid_real}" == "${root_real}" || "${pid_real}" == "${root_real}/"* ]]
}

kill_pid() {
  local pid="$1"
  is_alive "${pid}" || return 0
  if ! is_own_process "${pid}"; then
    echo "skip: pid ${pid} is not under ${ROOT}" >&2
    return 0
  fi
  local children
  children="$(pgrep -P "${pid}" 2>/dev/null || true)"
  if [[ -n "${children}" ]]; then
    while read -r child; do
      [[ -n "${child}" ]] && kill_pid "${child}"
    done <<<"${children}"
  fi
  echo "kill ${pid} (cfker01 dev)"
  kill "${pid}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    is_alive "${pid}" || break
    sleep 0.1
  done
  if is_alive "${pid}"; then
    kill -9 "${pid}" 2>/dev/null || true
  fi
}

cleanup_existing() {
  # 1) PID file from a prior run
  if [[ -f "${PID_FILE}" ]]; then
    local saved
    saved="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${saved}" ]]; then
      kill_pid "${saved}" || true
    fi
    rm -f "${PID_FILE}" || true
  fi

  # 2) Any other wrangler dev children belonging to this repo.
  # Use ps+grep (anchored) to avoid matching our own bash script, which has
  # the literal string 'wrangler dev' in its argv.
  local others
  others="$(ps -axo pid=,command= | awk '/node.*wrangler.*dev/ {print $1}')"
  if [[ -n "${others}" ]]; then
    while read -r pid; do
      [[ -z "${pid}" ]] && continue
      local cmd
      cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
      case "${cmd}" in
        *"wrangler"*"dev"*) ;;
        *) continue ;;
      esac
      if is_own_process "${pid}"; then
        kill_pid "${pid}" || true
      fi
    done <<<"${others}"
  fi
}

choose_port() {
  if [[ -n "${CFKER_PORT:-}" ]]; then
    valid_port "${CFKER_PORT}" || { echo "invalid CFKER_PORT: ${CFKER_PORT}" >&2; exit 2; }
    if port_free "${CFKER_PORT}"; then
      PORT="${CFKER_PORT}"
      return
    fi
    echo "Port ${CFKER_PORT} is occupied; searching fallback range."
  fi
  local range=("${PORT_RANGE_DEFAULT[@]}")
  if [[ -n "${CFKER_PORT_RANGE:-}" ]]; then
    # shellcheck disable=SC2206
    range=( ${CFKER_PORT_RANGE} )
  fi
  for p in "${range[@]}"; do
    valid_port "${p}" || { echo "skip invalid port in CFKER_PORT_RANGE: ${p}" >&2; continue; }
    if port_free "${p}"; then
      PORT="${p}"
      return
    fi
  done
  echo "no free port in range; set CFKER_PORT or CFKER_PORT_RANGE" >&2
  exit 1
}

cleanup_existing

TASK_CORE_ARGS=()
if [[ "${TASK_CORE_DEV:-true}" == "true" ]]; then
  "${ROOT}/scripts/task-core-dev-up.sh"
  TASK_CORE_PORT_VALUE="$(cat "${ROOT}/.wrangler/task-core-dev.port")"
  TASK_CORE_TOKEN_VALUE="$(cat "${ROOT}/.wrangler/task-core-dev.token")"
  TASK_CORE_ARGS=(--var "TASK_CORE_URL:http://127.0.0.1:${TASK_CORE_PORT_VALUE}" --var "TASK_CORE_INTERNAL_TOKEN:${TASK_CORE_TOKEN_VALUE}")
fi
choose_port

choose_inspector_port() {
  local candidate=$((PORT + 100))
  while (( candidate <= 65535 )); do
    if port_free "${candidate}"; then
      INSPECTOR_PORT="${candidate}"
      return
    fi
    candidate=$((candidate + 1))
  done
  echo "no free inspector port available" >&2
  exit 1
}

choose_inspector_port

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run d1:migrate:local
npm run types
npm run build

URL="http://127.0.0.1:${PORT}"

echo "Starting cfker01 dev server on ${URL} (inspector=${INSPECTOR_PORT})"
mkdir -p "${ROOT}/.wrangler"
nohup npx wrangler dev --port "${PORT}" --ip 127.0.0.1 \
  --inspector-port "${INSPECTOR_PORT}" \
  --persist-to "${ROOT}/.wrangler/state" \
  "${TASK_CORE_ARGS[@]}" \
  >"${ROOT}/.wrangler/dev-up.log" 2>&1 &
DEV_PID=$!
echo "${DEV_PID}" >"${PID_FILE}"
echo "${PORT}" >"${PORT_FILE}"
echo "${URL}" >"${URL_FILE}"

cleanup() {
  local rc=$?
  if is_alive "${DEV_PID}"; then
    kill "${DEV_PID}" 2>/dev/null || true
    for _ in $(seq 1 20); do
      is_alive "${DEV_PID}" || break
      sleep 0.1
    done
    is_alive "${DEV_PID}" && kill -9 "${DEV_PID}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
  rm -f "${PORT_FILE}" "${URL_FILE}"
  exit "${rc}"
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 40); do
  if ! is_alive "${DEV_PID}"; then
    echo "wrangler exited early; see .wrangler/dev-up.log" >&2
    tail -n 40 "${ROOT}/.wrangler/dev-up.log" >&2 || true
    exit 1
  fi
  if curl -sf "${URL}/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done

if [[ "${ready}" -ne 1 ]]; then
  echo "Timed out waiting for dev server on ${URL}" >&2
  tail -n 40 "${ROOT}/.wrangler/dev-up.log" >&2 || true
  exit 1
fi

echo "Ready: ${URL}"
open "${URL}" 2>/dev/null || true

if [[ "${CFKER_FOREGROUND:-false}" == "true" ]]; then
  wait "${DEV_PID}" || true
else
  trap - EXIT INT TERM
  disown "${DEV_PID}" 2>/dev/null || true
  echo "Running in background (pid=${DEV_PID}, log=.wrangler/dev-up.log)"
fi
