#!/usr/bin/env bash
set -euo pipefail

# Immutable-commit deployment for the AMD64 Docker host. Secrets and persistent
# volumes stay on the host; only the current Git archive is transferred.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_TARGET="${SSH_TARGET:-opchom}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/tableai-catalog}"
BASE_URL="${BASE_URL:-https://g.ksamint.cn}"
COMMIT="${DEPLOY_COMMIT:-$(git rev-parse HEAD)}"

if [[ -n "$(git -C "$ROOT" status --short)" ]]; then
  echo "Refusing deployment: working tree is not clean." >&2
  exit 1
fi
if ! git -C "$ROOT" cat-file -e "${COMMIT}^{commit}" 2>/dev/null; then
  echo "Unknown deployment commit: ${COMMIT}" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%d%H%M%S)"
echo "Deploying ${COMMIT} to ${SSH_TARGET}:${REMOTE_APP_DIR}"
ssh -o BatchMode=yes "$SSH_TARGET" "test -f '$REMOTE_APP_DIR/.env.docker' && mkdir -p '$REMOTE_APP_DIR/backups'"
ssh -o BatchMode=yes "$SSH_TARGET" "cd '$REMOTE_APP_DIR' && tar --exclude=backups --exclude=.env.docker --exclude=node_modules --exclude=.wrangler --exclude=dist --exclude=.cache -czf 'backups/pre-deploy-${STAMP}.tar.gz' ."
git -C "$ROOT" archive "$COMMIT" | ssh -o BatchMode=yes "$SSH_TARGET" "tar -x -C '$REMOTE_APP_DIR'"
ssh -o BatchMode=yes "$SSH_TARGET" "cd '$REMOTE_APP_DIR' && DEPLOY_VERSION='$COMMIT' docker compose --env-file .env.docker config --quiet && DEPLOY_VERSION='$COMMIT' docker compose --env-file .env.docker build --pull && DEPLOY_VERSION='$COMMIT' docker compose --env-file .env.docker up -d --remove-orphans"

for attempt in {1..30}; do
  if ssh -o BatchMode=yes "$SSH_TARGET" "cd '$REMOTE_APP_DIR' && docker compose --env-file .env.docker ps --format '{{.Name}} {{.State}} {{.Health}}' | grep -q 'tableai-catalog-catalog-1.*running.*healthy'"; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then echo "Catalog did not become healthy." >&2; exit 1; fi
  sleep 5
done
node "$ROOT/scripts/smoke-test.mjs" "$BASE_URL"
REMOTE_VERSION="$(ssh -o BatchMode=yes "$SSH_TARGET" "docker inspect tableai-catalog-catalog-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DEPLOY_VERSION=//p' | head -1")"
if [[ "$REMOTE_VERSION" != "$COMMIT" ]]; then
  echo "Deployment version mismatch: expected ${COMMIT}, got ${REMOTE_VERSION:-unknown}." >&2
  exit 1
fi
echo "AMD deployment complete: ${COMMIT}"
