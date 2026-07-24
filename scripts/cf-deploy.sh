#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ENV_NAME="${1:-staging}"
if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "production" ]]; then
  echo "Usage: $0 <staging|production>" >&2
  exit 2
fi

if rg -q '00000000-0000-0000-0000-00000000000[12]|0000000000000000000000000000000[12]' wrangler.jsonc; then
  echo "Refusing deployment: replace placeholder D1 and KV IDs in wrangler.jsonc." >&2
  echo "Run ./scripts/cf-provision.sh and update the selected environment." >&2
  exit 1
fi

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then npm ci; fi
npm run content:validate
npm test
npm run build
npx wrangler d1 migrations apply "cfker01-mgmt-${ENV_NAME}" --remote --env "$ENV_NAME"
npx wrangler deploy --env "$ENV_NAME" --var "DEPLOY_VERSION:${DEPLOY_VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"

BASE_URL_VAR="${ENV_NAME^^}_BASE_URL"
BASE_URL="${!BASE_URL_VAR:-}"
if [[ -n "$BASE_URL" ]]; then
  node scripts/smoke-test.mjs "$BASE_URL"
else
  echo "Deployment finished. Set ${BASE_URL_VAR} to run post-deploy smoke tests automatically."
fi
