#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "======== Cloudflare ========"
require_wrangler() {
  command -v wrangler >/dev/null 2>&1 || command -v npx >/dev/null 2>&1
}

if require_wrangler; then
  echo "wrangler: $(npx wrangler --version 2>/dev/null || wrangler --version 2>/dev/null | head -1)"
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "CLOUDFLARE_API_TOKEN: set"
  else
    echo "CLOUDFLARE_API_TOKEN: not set (use wrangler login or .env.cloud)"
  fi
  if npx wrangler whoami >/dev/null 2>&1; then
    echo "wrangler whoami: OK"
    npx wrangler whoami 2>/dev/null | head -5
  else
    echo "wrangler whoami: not authenticated (run: npx wrangler login)"
  fi
  echo ""
  echo "Cursor plugin MCP (when enabled in Cursor):"
  echo "  - cloudflare-docs      search Cloudflare documentation"
  echo "  - cloudflare-bindings  account bindings"
  echo "  - cloudflare-builds    build/deploy status"
  echo "  - cloudflare-observability  logs/metrics"
else
  echo "wrangler: not found (npm install in repo root)"
fi

echo ""
echo "======== Tencent Cloud ========"
./scripts/tencent-check.sh

echo ""
echo "Dual-cloud check complete."
