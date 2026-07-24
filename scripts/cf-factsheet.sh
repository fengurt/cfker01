#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node scripts/generate-factsheet.mjs
open factsheet/factsheet.html 2>/dev/null || true
