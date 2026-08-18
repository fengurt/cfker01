# cfker01 agent guide

Cloudflare-optimized management worker. Prefer live docs over training data for Workers APIs.

## Tooling stack

1. **Cloudflare Cursor plugin** — skills, `/build-agent`, docs MCP (bindings, builds, observability)
2. **Wrangler CLI** — deploy, secrets, D1 migrations, tail
3. **Tencent Cloud CLI** — `tccli` (EdgeOne `teo`, CAM, etc.), `coscli` (COS buckets)
4. **1Password CLI** — `op read` for Tencent API keys (`Tencent-APUCH-oss` item)
5. **Cursor CLI** (`agent`) — optional headless automation

Dual-cloud setup: [docs/dual-cloud.md](./docs/dual-cloud.md). Before Tencent commands in a new shell: `./scripts/tencent-auth.sh`.

## Project conventions

- Config: `wrangler.jsonc` (not TOML)
- Run `npm run types` after binding changes
- Secrets via `wrangler secret put`, never in source
- Structured JSON logs via `src/lib/logger.ts`
- Admin API protected by `ADMIN_TOKEN` secret

## Key files

| Path | Purpose |
|------|---------|
| `wrangler.jsonc` | Worker config, D1/KV bindings, cron, envs |
| `src/index.ts` | Fetch + scheduled handlers |
| `src/lib/asset-map.ts` | Versioned local-to-cloud asset graph |
| `src/routes/admin.ts` | Audit + heartbeat management |
| `migrations/` | D1 schema |
| `scripts/dev-up.sh` | Local dev entrypoint |
| `scripts/cf-provision.sh` | Create D1/KV resources |
| `scripts/tencent-auth.sh` | Load Tencent creds from 1Password → tccli/coscli |
| `scripts/cloud-check.sh` | Smoke test Cloudflare + Tencent CLI auth |
| `config/tencent.meta.json` | Tencent AppId, region, 1Password refs (no secrets) |

## Common tasks

```bash
./scripts/dev-up.sh
npm run check
./scripts/cf-deploy.sh staging
wrangler tail --env production
./scripts/tencent-auth.sh && ./scripts/cloud-check.sh
./scripts/cos-provision.sh <bucket-base> private
```

## Docs

- [Live Asset Map Agent guide](./docs/asset-map-agent-guide.md)
- https://developers.cloudflare.com/workers/
- MCP: https://docs.mcp.cloudflare.com/mcp
