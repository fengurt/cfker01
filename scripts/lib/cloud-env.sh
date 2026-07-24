#!/usr/bin/env bash
# Shared Cloudflare + Tencent env helpers. Sources 1Password refs; never echo secrets.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.cloud"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

: "${OP_TENCENT_VAULT:=Personal}"
: "${OP_TENCENT_ITEM:=Tencent-APUCH-oss}"
: "${OP_TENCENT_SECRET_ID_REF:=op://Personal/Tencent-APUCH-oss/add more/tencent-SecretId-01}"
: "${OP_TENCENT_SECRET_KEY_REF:=op://Personal/Tencent-APUCH-oss/add more/tencent-SecretKey-01}"
: "${TENCENT_REGION:=ap-guangzhou}"
: "${TENCENT_APP_ID:=1308586823}"
: "${TENCENT_ACCOUNT:=legacy}"
: "${TENCENT_ALLOW_LOCAL_CREDENTIAL_FILE:=false}"

select_tencent_account() {
  local profile
  profile="$(printf '%s' "${TENCENT_ACCOUNT}" | tr '[:lower:]-' '[:upper:]_')"
  [[ "$profile" =~ ^[A-Z0-9_]+$ ]] || { echo "error: invalid TENCENT_ACCOUNT" >&2; exit 1; }
  local id_name="OP_TENCENT_${profile}_SECRET_ID_REF"
  local key_name="OP_TENCENT_${profile}_SECRET_KEY_REF"
  local app_name="TENCENT_${profile}_APP_ID"
  if [[ -n "${!id_name:-}" || -n "${!key_name:-}" ]]; then
    [[ "${!id_name:-}" == op://* && "${!key_name:-}" == op://* ]] || { echo "error: incomplete exact 1Password refs for Tencent account ${TENCENT_ACCOUNT}" >&2; exit 1; }
    OP_TENCENT_SECRET_ID_REF="${!id_name}"
    OP_TENCENT_SECRET_KEY_REF="${!key_name}"
    TENCENT_APP_ID="${!app_name:-${TENCENT_APP_ID}}"
  fi
}

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "error: ${cmd} not found in PATH" >&2
    exit 1
  fi
}

load_tencent_from_tccli_file() {
  local cred_file="${HOME}/.tccli/default.credential"
  if [[ ! -f "${cred_file}" ]]; then
    return 1
  fi
  TENCENT_SECRET_ID="$(python3 - <<'PY'
import json, os
path = os.path.expanduser("~/.tccli/default.credential")
with open(path) as f:
    data = json.load(f)
print(data.get("secretId", ""))
PY
)"
  TENCENT_SECRET_KEY="$(python3 - <<'PY'
import json, os
path = os.path.expanduser("~/.tccli/default.credential")
with open(path) as f:
    data = json.load(f)
print(data.get("secretKey", ""))
PY
)"
  if [[ -z "${TENCENT_SECRET_ID}" || -z "${TENCENT_SECRET_KEY}" ]]; then
    return 1
  fi
  export TENCENT_SECRET_ID TENCENT_SECRET_KEY
}

load_tencent_from_op() {
  require_cmd op
  if ! op account list >/dev/null 2>&1; then
    echo "error: 1Password CLI not signed in. Run: eval \"\$(op signin)\"" >&2
    return 1
  fi
  export TENCENT_SECRET_ID
  export TENCENT_SECRET_KEY
  TENCENT_SECRET_ID="$(op read "${OP_TENCENT_SECRET_ID_REF}")"
  TENCENT_SECRET_KEY="$(op read "${OP_TENCENT_SECRET_KEY_REF}")"
}

load_tencent_credentials() {
  select_tencent_account
  if [[ -n "${TENCENT_SECRET_ID:-}" && -n "${TENCENT_SECRET_KEY:-}" ]]; then
    return 0
  fi
  if [[ "${TENCENT_ALLOW_LOCAL_CREDENTIAL_FILE}" == "true" ]] && load_tencent_from_tccli_file; then
    return 0
  fi
  load_tencent_from_op
}

apply_tencent_cli_config() {
  require_cmd tccli
  tccli configure set \
    secretId "${TENCENT_SECRET_ID}" \
    secretKey "${TENCENT_SECRET_KEY}" \
    region "${TENCENT_REGION}" \
    output json >/dev/null

  if command -v coscli >/dev/null 2>&1; then
    coscli config set --secret_id "${TENCENT_SECRET_ID}" --secret_key "${TENCENT_SECRET_KEY}" >/dev/null 2>&1 || true
  fi
}

tencent_app_id() {
  python3 -c "import json; print(json.load(open('${REPO_ROOT}/config/tencent.meta.json'))['account']['appId'])"
}

tencent_cos_endpoint() {
  python3 -c "import json; print(json.load(open('${REPO_ROOT}/config/tencent.meta.json'))['cosEndpoint'])"
}
