#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8788}"
REFS_FILE="${ONEPASSWORD_REFS_FILE:-.env.1password}"
command -v op >/dev/null || { echo "1Password CLI (op) is required" >&2; exit 2; }
[[ -f "$REFS_FILE" ]] || { echo "missing $REFS_FILE" >&2; exit 2; }
set -a
source "$REFS_FILE"
set +a
for name in ADMIN_TOKEN_REF ADMIN_PHONE_REF ADMIN_PASSWORD_REF; do [[ "${!name:-}" == op://* ]] || { echo "missing exact $name" >&2; exit 2; }; done
admin_token="$(op read "$ADMIN_TOKEN_REF")"
phone="$(op read "$ADMIN_PHONE_REF")"
password="$(op read "$ADMIN_PASSWORD_REF")"
payload="$(node -e 'process.stdout.write(JSON.stringify({phone:process.argv[1],password:process.argv[2]}))' "$phone" "$password")"
status="$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST "$BASE_URL/admin/bootstrap" --header "Authorization: Bearer $admin_token" --header 'Content-Type: application/json' --data "$payload")"
[[ "$status" == "201" || "$status" == "409" ]] || { echo "admin bootstrap failed with HTTP $status" >&2; exit 1; }
echo "Admin bootstrap is ready (HTTP $status); credentials were not printed."
