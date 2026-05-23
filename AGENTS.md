# cfker01 agent guide

Cloudflare-optimized management worker. Prefer live docs over training data for Workers APIs.

## Tooling stack

1. **Cloudflare Cursor plugin** — skills, `/build-agent`, docs MCP
2. **Wrangler CLI** — deploy, secrets, D1 migrations, tail
3. **Cursor CLI** (`agent`) — optional headless automation

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
| `src/routes/admin.ts` | Audit + heartbeat management |
| `migrations/` | D1 schema |
| `scripts/dev-up.sh` | Local dev entrypoint |
| `scripts/cf-provision.sh` | Create D1/KV resources |

## Common tasks

```bash
./scripts/dev-up.sh
npm run check
./scripts/cf-deploy.sh staging
wrangler tail --env production
```

## Docs

- https://developers.cloudflare.com/workers/
- MCP: https://docs.mcp.cloudflare.com/mcp
