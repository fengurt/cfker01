#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/cloud-env.sh
source scripts/lib/cloud-env.sh

BUCKET_BASE="${1:-}"
ACL="${2:-private}"

if [[ -z "${BUCKET_BASE}" ]]; then
  echo "Usage: $0 <bucket-base-name> [acl]" >&2
  echo "  Creates cos://<bucket-base-name>-<appId> in ${TENCENT_REGION}" >&2
  echo "  Example: $0 apuch-ksa private" >&2
  exit 1
fi

require_cmd coscli
load_tencent_credentials
apply_tencent_cli_config

APP_ID="$(tencent_app_id)"
ENDPOINT="$(tencent_cos_endpoint)"
BUCKET="${BUCKET_BASE}-${APP_ID}"

echo "Creating COS bucket: cos://${BUCKET} (endpoint=${ENDPOINT}, acl=${ACL})"
coscli mb "cos://${BUCKET}" -e "${ENDPOINT}" --acl "${ACL}"
echo "Done. Bucket: ${BUCKET}"
