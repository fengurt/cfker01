#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -d node_modules ]]; then
  npm install
fi

npx wrangler d1 create cfker01-mgmt-staging 2>/dev/null || true
npx wrangler d1 create cfker01-mgmt-production 2>/dev/null || true
npx wrangler kv namespace create MGMT_KV 2>/dev/null || true
npx wrangler kv namespace create MGMT_KV --env staging 2>/dev/null || true
npx wrangler kv namespace create MGMT_KV --env production 2>/dev/null || true

echo "Update wrangler.jsonc with the IDs printed above, then run: npm run types"
