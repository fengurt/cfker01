# cfker01 — Cloudflare Management Worker

**cfker** (Cloudflare Ker) is a management-focused Workers project optimized for day-to-day Cloudflare ops: health checks, status, audit logging, cron heartbeats, and Wrangler-first workflows.

## Stack

- Cloudflare Workers + Wrangler 4
- D1 (audit events) + KV (heartbeat cache)
- TypeScript, Vitest (`@cloudflare/vitest-pool-workers`)
- GitHub Actions CI

## Quick start

```bash
npm install
cp dev.vars.example .dev.vars   # set ADMIN_TOKEN
npm run types
npm run d1:migrate:local
./scripts/dev-up.sh             # http://127.0.0.1:8787
```

## API routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /` | No | Service index |
| `GET /health` | No | Liveness probe |
| `GET /status` | No | Environment + binding summary |
| `GET /admin/heartbeat` | Bearer | Last cron heartbeat from KV |
| `GET /admin/audit?limit=20` | Bearer | Recent audit events from D1 |
| `POST /admin/audit` | Bearer | Append audit event |

Admin routes require `Authorization: Bearer $ADMIN_TOKEN` (set via `wrangler secret put ADMIN_TOKEN` in remote envs, or `.dev.vars` locally).

## Wrangler commands

```bash
npm run dev                 # local dev (port 8787)
npm run check               # wrangler check + tsc
npm run deploy:staging
npm run deploy:production
npm run tail
npm run d1:migrate:local
npm run d1:migrate:remote
```

## Provision Cloudflare resources

Replace placeholder IDs in `wrangler.jsonc` after creating resources:

```bash
chmod +x scripts/*.sh
./scripts/cf-provision.sh
# paste D1/KV IDs into wrangler.jsonc, then:
npm run types
```

## Environments

| Env | Worker name | Purpose |
|-----|-------------|---------|
| default | `cfker01` | Local dev |
| staging | `cfker01-staging` | Pre-production |
| production | `cfker01-production` | Production |

## Cursor + Cloudflare plugin

Use the Cloudflare plugin in Cursor for docs/skills, Wrangler for deploy, and optional account MCP for bindings/builds/logs. See [AGENTS.md](./AGENTS.md).

## Secrets

```bash
wrangler secret put ADMIN_TOKEN --env staging
wrangler secret put ADMIN_TOKEN --env production
```

Never commit `.dev.vars` or real binding IDs from production accounts in public repos without reviewing sensitivity.
