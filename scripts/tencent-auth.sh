#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/cloud-env.sh
source scripts/lib/cloud-env.sh

load_tencent_credentials
apply_tencent_cli_config

APP_ID="$(tencent_app_id)"
SOURCE="1Password (${OP_TENCENT_ITEM})"
if [[ -f "${HOME}/.tccli/default.credential" ]]; then
  SOURCE="~/.tccli/default.credential or 1Password"
fi
echo "Tencent CLI configured (account=${TENCENT_ACCOUNT}, region=${TENCENT_REGION}, appId=${APP_ID})"
echo "Credential source: ${SOURCE}"
echo "Verify: ./scripts/tencent-check.sh"
