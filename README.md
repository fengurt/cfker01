# TableAI Catalog and cfker01 Operations Worker

The repository now serves a Git-curated catalog of AI apps, skills, agents, benchmarks, and articles. The original **cfker** management Worker remains available for health checks, status aggregation, audit logging, cron heartbeats, API keys, and MCP access.

## Stack

- Astro static generation + Cloudflare Workers Static Assets
- Cloudflare Workers + Wrangler 4 for APIs and operations
- D1 (audit events) + KV (heartbeat cache)
- TypeScript, Vitest (`@cloudflare/vitest-pool-workers`)
- GitHub Actions CI

## Quick start

```bash
npm install
cp dev.vars.example .dev.vars   # set ADMIN_TOKEN
npm run types
npm run d1:migrate:local
npm run dev                     # catalog development server
npm run dev:worker              # Worker and API development
```

## API routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/v1/catalog` | No | Filtered and paginated public catalog |
| `GET /api/v1/catalog/:slug` | No | One canonical catalog entry |
| `GET /api/v1/articles` | No | Public article index |
| `GET /api/v1/articles/:slug` | No | One article record |
| `GET /api/v1/projects` | No | Scanned and imported project resources |
| `GET /api/v1/projects/:id` | No | One public project resource |
| `POST /api/v1/projects` | `X-Api-Key` with `write` | Upsert a project from another source |
| `GET /` | No | Service index |
| `GET /health` | No | Liveness probe |
| `GET /status` | No | HTML status page (auto-refreshing) |
| `GET /v1/status` | `X-Api-Key` | Latest snapshot for all sources |
| `GET /v1/status/:sourceId` | `X-Api-Key` | Latest snapshot for one source |
| `GET /v1/snapshots/:sourceId?limit=N` | `X-Api-Key` | Recent history (≤100) |
| `POST /admin/sync` | Bearer `ADMIN_TOKEN` | Force a full sync |
| `POST /admin/sync/:sourceId` | Bearer | Sync one source |
| `POST /admin/bootstrap` | Bearer `ADMIN_TOKEN` | One-time PBKDF2 admin bootstrap |
| `POST /admin/login` | Phone + password | Create an HttpOnly admin session |
| `GET /admin/projects` | Admin session | Review managed projects |
| `POST /admin/projects/import-local` | Admin session | Import the generated local scan into D1 |
| `GET /admin/keys` | Bearer | List API keys (hashes only) |
| `POST /admin/keys` | Bearer | Create API key (raw key returned once) |
| `DELETE /admin/keys/:id` | Bearer | Revoke API key |
| `GET /admin/heartbeat` | Bearer | Last cron heartbeat from KV |
| `GET /admin/audit?limit=20` | Bearer | Recent audit events from D1 |
| `POST /admin/audit` | Bearer | Append audit event |
| `GET /api/admin/v1/incidents` | Admin session / token | Read the deduplicated incident inbox |
| `POST /api/admin/v1/incidents` | Operator | Open or deduplicate an incident |
| `PATCH /api/admin/v1/incidents/:id` | Operator | Acknowledge, assign, or resolve with a version lock |
| `GET/PATCH /api/admin/v1/deployment-requirements/:projectId` | Viewer / operator | Manage explicit deployment constraints |
| `GET /api/admin/v1/placement-recommendations/:projectId` | Viewer | Return up to three safe placement candidates |
| `GET /.well-known/mcp` | No | MCP server card |
| `POST /mcp` | `X-Api-Key` | JSON-RPC (tools: `get_status`, `get_history`) |

Admin routes require `Authorization: Bearer $ADMIN_TOKEN`; `/v1/*` and `/mcp` require `X-Api-Key` (create with `POST /admin/keys`). All secrets live in `wrangler secret put`.

## Wrangler commands

```bash
npm run dev                 # Astro catalog development
npm run dev:worker          # Worker development (port 8787)
npm run build               # validate and generate static catalog
npm run check               # wrangler check + tsc
npm run deploy:staging
npm run deploy:production
npm run deploy:amd          # immutable Git archive to the configured AMD Docker host
npm run tail
npm run d1:migrate:local
npm run d1:migrate:remote
```

Catalog content lives in `src/content/`. See [docs/content-contributing.md](./docs/content-contributing.md) before adding or changing records.

The resource-operations product contract, glossary, decisions, and release acceptance checklist live in [docs/resource-operations-spec.md](./docs/resource-operations-spec.md), [CONTEXT.md](./CONTEXT.md), and [docs/resource-operations-acceptance.md](./docs/resource-operations-acceptance.md). Run `npm run ops:validate` before changing operational behavior.

## Project inventory and admin GUI

Scan local projects, repositories, skills, and agent resources:

```bash
npm run projects:scan
npm run d1:migrate:local
npm run build
```

The current scan is written to `src/generated/local-projects.json` using paths relative to `/Users/af/cpro01`. `/resources/` is the authenticated resource-operations workspace; `/system-admin/` is a compatible alias. The public reviewed directory remains at `/catalog/`. The GUI defaults to zh-CN, supports English, and uses a signed eight-hour HttpOnly session.

Resource operations include tags and pin ranks, source/scan timestamps, server specifications and expiry, deployments, GitHub backup verification, AES-256-GCM Markdown/codebase maps, and review-gated benchmark discovery.

### One-time admin and 1Password setup

Create a dedicated `TableAI Catalog` item in 1Password. Copy `config/onepassword.refs.example` to the gitignored `.env.1password`, then replace each required value with one exact `op://` reference. Item-title searches are intentionally unsupported so duplicate items cannot be selected heuristically.

Provider API keys use one canonical API Credential item per independently rotatable key. Authorized administrator Agents must follow [the API credential and model-discovery guide](./docs/admin-agent-api-credentials.md) and can validate metadata without printing secrets using `npm run api-credentials:validate`.

```bash
npm run secrets:local
./scripts/dev-up.sh
npm run admin:bootstrap
```

Bootstrap reads the phone and password directly from 1Password, sends them only to the protected local endpoint, and never prints them. The endpoint refuses a second bootstrap once an admin exists.

If the credentials have not yet been stored in 1Password, run `npm run admin:bootstrap:prompt` and enter them at the hidden terminal prompt.

## Docker on AMD64

An AMD64 self-hosted image and Compose service are included for internal servers and previews:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build -d
```

For 1Password-backed Docker secrets, use `npm run secrets:docker` instead of copying the example, then bootstrap with `BASE_URL=http://127.0.0.1:8787 npm run admin:bootstrap`.

The container applies D1 migrations before startup and persists D1/KV state in the `tableai_data` volume. See [docs/docker-amd64.md](./docs/docker-amd64.md) for TLS, backups, upgrades, and the distinction between this Miniflare/workerd compatibility deployment and Cloudflare production.

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

## Factsheet (account inventory)

A **factsheet** is a Markdown + HTML snapshot of all Cloudflare resources, plans, and key IDs. Regenerate anytime:

```bash
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."
npm run factsheet
```

Outputs: `factsheet/factsheet.md` and `factsheet/factsheet.html`. See [factsheet/README.md](./factsheet/README.md).

## Cursor + Cloudflare plugin

Use the Cloudflare plugin in Cursor for docs/skills, Wrangler for deploy, and optional account MCP for bindings/builds/logs. See [AGENTS.md](./AGENTS.md).

## Tencent Cloud + dual-cloud CLI

COS (object storage) and EdgeOne are controlled via `tccli` / `coscli`. API keys live in 1Password (`Tencent-APUCH-oss`); metadata in `config/tencent.meta.json`.

```bash
eval "$(op signin)"              # if needed
./scripts/tencent-auth.sh
./scripts/cloud-check.sh
./scripts/cos-provision.sh my-bucket private
```

Full guide: [docs/dual-cloud.md](./docs/dual-cloud.md).

## Secrets

```bash
wrangler secret put ADMIN_TOKEN --env staging
wrangler secret put ADMIN_TOKEN --env production
```

Never commit `.dev.vars` or real binding IDs from production accounts in public repos without reviewing sensitivity.
