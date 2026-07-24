#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/cloud-env.sh
source scripts/lib/cloud-env.sh

require_cmd tccli

echo "== Tencent toolchain =="
echo "tccli:  $(tccli --version 2>&1 | head -1)"
if command -v coscli >/dev/null 2>&1; then
  echo "coscli: $(coscli --version 2>&1 | head -1)"
else
  echo "coscli: not installed (brew/curl from GitHub tencentyun/coscli)"
fi

load_tencent_credentials
apply_tencent_cli_config

echo ""
echo "== Account (tccli cam GetUserAppId) =="
tccli cam GetUserAppId --region "${TENCENT_REGION}"

echo ""
echo "== EdgeOne API (teo DescribeAvailablePlans) =="
if tccli teo DescribeAvailablePlans --region "${TENCENT_REGION}" >/dev/null 2>&1; then
  echo "EdgeOne (teo): API reachable"
else
  echo "EdgeOne (teo): check failed (permissions or service not enabled)"
fi

echo ""
echo "Tencent check complete."
