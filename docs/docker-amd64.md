# Docker deployment on an AMD64 server

This image runs the Worker through Wrangler's Miniflare/workerd local runtime with persistent D1 and KV data. Cloudflare documents this runtime as a local simulator. Use it for internal deployments, previews, or migration testing. For an internet-facing production service, Cloudflare Workers remains the preferred runtime.

## Server requirements

- Linux x86-64 / AMD64
- Docker Engine 24 or newer
- Docker Compose plugin
- A reverse proxy such as Caddy, Nginx, or Traefik for TLS
- Backups for the `tableai_data` volume and Task PostgreSQL

## Start

```bash
cp .env.docker.example .env.docker
# Materialize independent catalog, session, Task, database, and backup secrets.
docker compose --env-file .env.docker build --pull
docker compose --env-file .env.docker up -d
docker compose ps
curl -fsS http://127.0.0.1:8787/health
```

Bind the container to loopback and expose it through Nginx or another TLS proxy. The production deployment uses `TABLEAI_BIND_ADDRESS=127.0.0.1`; do not publish the Worker port on all interfaces.

## Persistent state

The named `tableai_data` volume contains local D1 and KV state. The entrypoint applies pending migrations before starting the service. Back up this volume before upgrading:

```bash
docker run --rm -v tableai_data:/data -v "$PWD":/backup debian:bookworm-slim \
  tar -C /data -czf /backup/tableai-data-backup.tgz .
```

Task, organization, project, board, comment, and event state lives in the separate `task_postgres_data` volume. Valkey is intentionally ephemeral. See [Task collaboration core](./task-collaboration.md) for migration, encrypted COS backup, and recovery verification.

## Upgrade and rollback

```bash
docker compose --env-file .env.docker build --pull
docker compose --env-file .env.docker up -d
docker compose logs -f --tail=100
```

## Automatic asset discovery

The Compose stack includes an `asset-sync` sidecar. It polls the source-scoped
job queue every minute. Each connector is due every four hours by default, so
Tencent Cloud, GitHub, Docker, and Cloudflare refresh six times per day. Results
are uploaded in idempotent batches through `/api/ingest/v1/*`; the scanner key
cannot use administrator endpoints.

The web container does not receive cloud CLI tools. Docker access is mediated by
a read-only socket proxy that permits container inspection but rejects write
requests. Nginx configuration is mounted read-only. Cloud credentials stay in
the root-readable `.env.docker` file and are injected only into the sync
sidecar.

```bash
docker compose --env-file .env.docker ps catalog docker-api asset-sync
docker compose --env-file .env.docker logs --tail=100 asset-sync
docker exec tableai-catalog-asset-sync-1 cat /data/assets/last-success
```

Create a scanner service key once through `POST /api/admin/v1/service-keys`,
bind it only to the four `central-*` connectors, and store the returned value as
`SCANNER_KEY` in the root-readable `.env.docker`. The plaintext is returned only
once; D1 stores its salted hash.

After five hours without a successful scan, the sidecar health check reports
`unhealthy`. A provider authentication failure is retained as an explicit error
asset; it is never presented as a successful empty scan. Local Mac repository
inventory is not rescanned by the server and continues to use the separate
fingerprint-based local scanner.

## Mac local scanner

Create a second service key bound only to `local-cpro01`, then install the user
LaunchAgent. Pass the key directly for the one-time install, or use one explicit
1Password reference. The installer copies it to the macOS Keychain and does not
write it to the repository or LaunchAgent plist.

```bash
SCANNER_KEY='tais_…' npm run scanner:local:install
# or
OP_SCANNER_KEY_REF='op://Personal/TableAI Catalog/local-scanner-key' npm run scanner:local:install
```

The agent wakes every 15 minutes, but scans only when the server has a due or
manual job. Unchanged fingerprints complete as cache hits without uploading the
asset dossier again.

## Administrator and ingestion APIs

- OpenAPI: `/api/admin/v1/openapi.json`
- Source health: `GET /api/admin/v1/sources`
- Cursor-paginated assets: `GET /api/admin/v1/resources`
- NDJSON export: `GET /api/admin/v1/export/assets.ndjson`
- Manual jobs: `POST /api/admin/v1/scans`
- Scanner job/lease/batch protocol: `/api/ingest/v1/*`

Legacy `/admin/assets*` routes remain available during the compatibility period.

Tag images with an immutable Git revision on the server so a previous image can be restored. Restore the data volume only when a schema or data rollback is necessary.

## Reverse proxy

Terminate HTTPS at the reverse proxy and forward to `127.0.0.1:8787`. Do not expose the port directly to the public internet when a reverse proxy is available. Preserve `Host`, `X-Forwarded-Proto`, and client IP headers.

`COOKIE_SECURE=true` is the Docker default so admin cookies are restricted to HTTPS. For direct HTTP-only testing, set it to `false`; never use that setting on an internet-facing server.

The checked-in [Nginx configuration](../deploy/nginx-g.ksamint.cn.conf) includes HTTPS redirect, HSTS, browser security headers, bounded request size/timeouts, immutable caching for static assets, and direct REST/MCP/WebSocket routes to Task Core.

## COS backups

`npm run backup:cos` streams the persistent Docker volume over SSH and uploads a timestamped archive plus SHA-256 checksum to a private COS bucket. Tencent credentials remain on the operator workstation and are not copied to the server. Override `SSH_TARGET`, `COS_BUCKET`, `COS_REGION`, or `REMOTE_VOLUME` when needed.
