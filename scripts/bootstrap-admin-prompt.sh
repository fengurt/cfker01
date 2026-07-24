#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8788}"
[[ -f .dev.vars ]] || { echo "missing .dev.vars" >&2; exit 2; }
admin_token="$(awk -F= '$1=="ADMIN_TOKEN"{sub(/^[^=]*=/,""); print; exit}' .dev.vars)"
[[ -n "$admin_token" ]] || { echo "ADMIN_TOKEN is missing from .dev.vars" >&2; exit 2; }
read -r -p "Admin phone: " phone
read -r -s -p "Admin password: " password
echo
payload="$(PHONE="$phone" PASSWORD="$password" node -e 'process.stdout.write(JSON.stringify({phone:process.env.PHONE,password:process.env.PASSWORD}))')"
unset password phone
status="$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST "$BASE_URL/admin/bootstrap" --header "Authorization: Bearer $admin_token" --header 'Content-Type: application/json' --data "$payload")"
unset payload admin_token
[[ "$status" == "201" ]] || { echo "admin bootstrap failed with HTTP $status" >&2; exit 1; }
echo "System administrator created. Credentials were not printed or stored by this script."
