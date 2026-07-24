# Dual-cloud operations (Cloudflare + Tencent)

This repo manages a Cloudflare Worker (`cfker01`) and documents CLI/plugin workflows for **Cloudflare** and **Tencent Cloud** (COS, EdgeOne).

Secrets stay in **1Password** or local gitignored files — never in git.

## Toolchain

| Provider | CLI | Cursor plugin / MCP |
|----------|-----|---------------------|
| Cloudflare | `wrangler` (npm), `./scripts/cf-*.sh` | Cloudflare plugin: docs, bindings, builds, observability MCP |
| Tencent | `tccli`, `coscli` | Context7 for API docs; `tccli teo` for EdgeOne |

## One-time setup

```bash
npm install
chmod +x scripts/*.sh scripts/lib/*.sh

# Cloudflare: OAuth or API token
npx wrangler login
# or create .env.cloud with CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (gitignored)

# Tencent: load API keys from 1Password
eval "$(op signin)"          # if needed
./scripts/tencent-auth.sh
```

## Verify both clouds

```bash
./scripts/cloud-check.sh
```

## Tencent account (non-secret metadata)

Stored in [`config/tencent.meta.json`](../config/tencent.meta.json):

| Field | Value |
|-------|--------|
| Sub-account | `oss@100022600923` |
| AppId | `1308586823` |
| Default region | `ap-guangzhou` |
| COS endpoint | `cos.ap-guangzhou.myqcloud.com` |
| 1Password item | `Tencent-APUCH-oss` (Personal vault) |

API keys: `op://Personal/Tencent-APUCH-oss/add more/tencent-SecretId-01` and `.../tencent-SecretKey-01`.

Credential load order in scripts: `TENCENT_*` env vars → `~/.tccli/default.credential` → 1Password (`op read`).

## Common Tencent commands

```bash
# Auth from 1Password → tccli + coscli
./scripts/tencent-auth.sh
./scripts/tencent-check.sh

# Create COS bucket (name becomes {base}-1308586823)
./scripts/cos-provision.sh apuch-ksa private

# EdgeOne
tccli teo DescribeZones
tccli teo DescribeAvailablePlans
```

## Common Cloudflare commands

```bash
./scripts/dev-up.sh
npm run check
./scripts/cf-deploy.sh staging
npm run factsheet                    # needs CLOUDFLARE_API_TOKEN or wrangler login
npx wrangler tail --env production
```

## Cursor agent workflow

1. **Cloudflare** — use installed Cloudflare plugin skills (`workers-best-practices`, `wrangler`) and MCP `search_cloudflare_documentation` before guessing Workers APIs.
2. **Tencent** — use Context7 MCP for COS/EdgeOne API docs; run `./scripts/tencent-auth.sh` before `tccli`/`coscli` in a fresh shell.
3. **Secrets** — read Tencent keys via `op read` or `./scripts/tencent-auth.sh`; Cloudflare via `wrangler login` or `CLOUDFLARE_API_TOKEN` in `.env.cloud`.

## Session log (2026-05-24)

Process established in this repo:

1. Verified `tccli` v3.1.85 and installed `coscli` v1.0.8.
2. Confirmed EdgeOne service (`teo`) registered in tccli; API endpoint reachable.
3. Linked Tencent sub-account credentials from 1Password item **Tencent-APUCH-oss**.
4. Verified account via `tccli cam GetUserAppId` (AppId `1308586823`).
5. Added repo scripts to reload auth from 1Password and provision COS buckets without storing keys in source.

## Session log (2026-07-07)

Multi-source status aggregator added to cfker01:

- New D1 tables: `sources`, `snapshots`, `api_keys`, `webhooks` (migration `0002_status.sql`).
- New collectors (each hits the live API directly from the Worker; no `tccli`/`coscli`):
  - Cloudflare REST (`/user/tokens/verify`, `/accounts/{id}/subscriptions`)
  - Tencent TC3 (`cam GetUserAppId`, `billing DescribeAccountBalance`, `teo DescribeZones`)
  - OpenAI (`/v1/models`, `/v1/dashboard/billing/subscription`)
  - MiniMax (`/v1/api/openplatform/coding_plan/remains`)
- Sync engine (`src/lib/sync.ts`) runs every 30 min via cron, with a KV `sync:lock` to dedupe overlapping runs. Each successful snapshot is pushed to subscribed webhooks (`src/lib/push.ts`) and cached in KV as `status:latest:{source_id}`.
- Public API: `GET /v1/status`, `GET /v1/status/:sourceId`, `GET /v1/snapshots/:sourceId?limit=N` (X-Api-Key, read scope).
- Admin: `POST /admin/sync`, `POST /admin/sync/:sourceId` (Bearer ADMIN_TOKEN), `GET/POST/DELETE /admin/keys` for API key management.
- Remote MCP server at `/.well-known/mcp` and `POST /mcp` (JSON-RPC over HTTP), auth via X-Api-Key read scope. Tools: `get_status`, `get_history`.
- Tiny HTML status page at `/status` (~3 KB, vanilla JS, polls every 60 s).
- All provider secrets live in `wrangler secret put`; D1 stores only SHA-256(key + salt) hashes.

## Files

| Path | Purpose |
|------|---------|
| `config/tencent.meta.json` | Tencent account metadata (no secrets) |
| `.env.cloud` | Optional local overrides (gitignored) |
| `scripts/lib/cloud-env.sh` | 1Password + env loader |
| `scripts/tencent-auth.sh` | Configure tccli/coscli from 1Password |
| `scripts/tencent-check.sh` | Tencent CLI smoke test |
| `scripts/cos-provision.sh` | Create COS bucket |
| `scripts/cloud-check.sh` | Cloudflare + Tencent health check |
| `src/collectors/*` | Worker-side collectors (Cloudflare, Tencent TC3, OpenAI, MiniMax) |
| `src/lib/sync.ts` | Cron-driven sync engine with KV locking |
| `src/lib/apikey.ts` | Hashed API key auth + per-key rate limit |
| `src/lib/push.ts` | Outbound webhook delivery with HMAC signing |
| `src/lib/tc3.ts` | TC3-HMAC-SHA256 signer (no SDK) |
| `src/routes/v1.ts` | `GET /v1/status*` |
| `src/routes/admin-keys.ts` | `GET/POST/DELETE /admin/keys` |
| `src/routes/admin-sync.ts` | `POST /admin/sync[/:sourceId]` |
| `src/routes/mcp.ts` | Remote MCP server (`/.well-known/mcp`, `POST /mcp`) |
| `src/routes/status-page.ts` | Tiny HTML status page at `/status` |
