# Cloudflare Factsheet

A **factsheet** is a point-in-time snapshot of your Cloudflare account:

- Account ID, name, type, and plan
- Resource counts (Workers, KV, R2, D1, zones, Pages, Queues)
- Tables of each resource with IDs useful for `wrangler.jsonc` bindings

## Grab a fresh factsheet

```bash
# Option A: API token (recommended)
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."

npm run factsheet
# or
./scripts/cf-factsheet.sh
```

```bash
# Option B: Wrangler OAuth
npx wrangler login
npm run factsheet
```

## Outputs (regenerated every run)

| File | Purpose |
|------|---------|
| `factsheet/factsheet.md` | Source of truth — editable, diffable, versionable |
| `factsheet/factsheet.html` | Rendered view — opens in browser automatically via `cf-factsheet.sh` |

Both files are overwritten on each run. Archive copies manually if you need history (e.g. `factsheet/archive/2026-05-23.md`).

## API token permissions

Create a custom token at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) with:

- Account → Account Settings → Read
- Account → Workers Scripts → Read
- Account → Workers KV Storage → Read
- Account → Workers R2 Storage → Read
- Account → D1 → Read
- Account → Cloudflare Pages → Read
- Account → Queues → Read
- Account → Billing → Read (for plan line)
- Zone → Zone → Read (for domains)
