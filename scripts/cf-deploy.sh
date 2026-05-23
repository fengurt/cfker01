#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ENV_NAME="${1:-staging}"
npm run "deploy:${ENV_NAME}"
