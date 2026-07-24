#!/usr/bin/env node
/**
 * Cloudflare account factsheet generator.
 * Writes factsheet/factsheet.md and factsheet/factsheet.html on each run.
 *
 * Auth (pick one):
 *   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
 *   wrangler login (OAuth)
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "factsheet");
const MD_PATH = join(OUT_DIR, "factsheet.md");
const HTML_PATH = join(OUT_DIR, "factsheet.html");
const API_BASE = "https://api.cloudflare.com/client/v4";

async function cfFetch(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    const message = body.errors?.map((e) => e.message).join("; ") ?? response.statusText;
    throw new Error(`${path}: ${message}`);
  }
  return body.result;
}

async function verifyToken(token) {
  const response = await fetch(`${API_BASE}/user/tokens/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error("Invalid CLOUDFLARE_API_TOKEN");
  }
  return body.result;
}

function wranglerJson(args) {
  try {
    const output = execFileSync("npx", ["wrangler", ...args, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function wranglerWhoami() {
  try {
    const output = execFileSync("npx", ["wrangler", "whoami"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const accountId = output.match(/Account ID\s+\│\s+(\S+)/)?.[1]
      ?? output.match(/Account ID[:\s]+([a-f0-9]+)/i)?.[1];
    const email = output.match(/Email\s+\│\s+(\S+)/)?.[1]
      ?? output.match(/associated with the email ([^\s]+)/i)?.[1];
    return { accountId, email };
  } catch {
    return { accountId: null, email: null };
  }
}

async function resolveAuth() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

  if (token) {
    const verified = await verifyToken(token);
    if (!accountId) {
      const accounts = await cfFetch("/accounts?per_page=50", token);
      accountId = accounts[0]?.id ?? null;
    }
    return { mode: "api_token", token, accountId, verifiedEmail: verified.email };
  }

  const whoami = wranglerWhoami();
  if (whoami.accountId) {
    return {
      mode: "wrangler_oauth",
      token: null,
      accountId: whoami.accountId,
      verifiedEmail: whoami.email,
    };
  }

  return null;
}

async function fetchViaApi(token, accountId) {
  const [
    account,
    workers,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    zones,
    pagesProjects,
    queues,
  ] = await Promise.all([
    cfFetch(`/accounts/${accountId}`, token),
    cfFetch(`/accounts/${accountId}/workers/scripts`, token).catch(() => []),
    cfFetch(`/accounts/${accountId}/storage/kv/namespaces?per_page=100`, token).catch(() => []),
    cfFetch(`/accounts/${accountId}/r2/buckets`, token).catch(() => []),
    cfFetch(`/accounts/${accountId}/d1/database`, token).catch(() => []),
    cfFetch(`/zones?account.id=${accountId}&per_page=50`, token).catch(() => []),
    cfFetch(`/accounts/${accountId}/pages/projects?per_page=50`, token).catch(() => []),
    cfFetch(`/accounts/${accountId}/queues?per_page=50`, token).catch(() => []),
  ]);

  let subscriptions = [];
  try {
    subscriptions = await cfFetch(`/accounts/${accountId}/subscriptions`, token);
  } catch {
    subscriptions = [];
  }

  return {
    account,
    workers,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    zones,
    pagesProjects,
    queues,
    subscriptions,
  };
}

function fetchViaWrangler(accountId) {
  return {
    account: { id: accountId, name: "(via wrangler)", type: "unknown" },
    workers: wranglerJson(["deployments", "list"]) ?? [],
    kvNamespaces: wranglerJson(["kv", "namespace", "list"]) ?? [],
    r2Buckets: wranglerJson(["r2", "bucket", "list"]) ?? [],
    d1Databases: wranglerJson(["d1", "list"]) ?? [],
    zones: [],
    pagesProjects: [],
    queues: [],
    subscriptions: [],
  };
}

function table(headers, rows) {
  if (!rows.length) return "_None_\n";
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

function planFromSubscriptions(subscriptions) {
  if (!subscriptions?.length) {
    return "Unknown (add Billing Read to API token for plan details)";
  }
  return subscriptions
    .map((s) => `${s.rate_plan?.name ?? s.component ?? "plan"} (${s.state ?? "active"})`)
    .join(", ");
}

function buildMarkdown(data, meta) {
  const generatedAt = new Date().toISOString();
  const {
    account,
    workers,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    zones,
    pagesProjects,
    queues,
    subscriptions,
  } = data;

  const workerRows = (Array.isArray(workers) ? workers : []).slice(0, 100).map((w) => {
    const name = w.id ?? w.name ?? w.script ?? "—";
    const modified = w.modified_on ?? w.created_on ?? w.last_deployed ?? "—";
    return [name, String(modified).slice(0, 19)];
  });

  const kvRows = (Array.isArray(kvNamespaces) ? kvNamespaces : []).map((k) => [
    k.title ?? k.name ?? "—",
    k.id ?? "—",
  ]);

  const r2Rows = (Array.isArray(r2Buckets) ? r2Buckets : []).map((b) => [
    b.name ?? "—",
    b.creation_date ? String(b.creation_date).slice(0, 10) : "—",
  ]);

  const d1Rows = (Array.isArray(d1Databases) ? d1Databases : []).map((d) => [
    d.name ?? "—",
    d.uuid ?? d.database_id ?? "—",
    d.num_tables != null ? String(d.num_tables) : "—",
  ]);

  const zoneRows = (Array.isArray(zones) ? zones : []).slice(0, 50).map((z) => [
    z.name ?? "—",
    z.status ?? "—",
    z.plan?.name ?? "—",
  ]);

  const pagesRows = (Array.isArray(pagesProjects) ? pagesProjects : []).map((p) => [
    p.name ?? "—",
    p.subdomain ?? p.domains?.[0] ?? "—",
  ]);

  const queueRows = (Array.isArray(queues) ? queues : []).map((q) => [
    q.queue_name ?? q.name ?? "—",
    q.created_on ? String(q.created_on).slice(0, 10) : "—",
  ]);

  return `# Cloudflare Factsheet

> Auto-generated account snapshot for **cfker01**. Re-run \`npm run factsheet\` to refresh.

| Field | Value |
| --- | --- |
| Generated | ${generatedAt} |
| Auth mode | ${meta.mode} |
| Account ID | \`${account.id ?? meta.accountId}\` |
| Account name | ${account.name ?? "—"} |
| Account type | ${account.type ?? "—"} |
| User email | ${meta.verifiedEmail ?? "—"} |
| Workers plan | ${planFromSubscriptions(subscriptions)} |

## Summary counts

| Resource | Count |
| --- | --- |
| Workers scripts | ${workerRows.length} |
| KV namespaces | ${kvRows.length} |
| R2 buckets | ${r2Rows.length} |
| D1 databases | ${d1Rows.length} |
| Zones (domains) | ${zoneRows.length} |
| Pages projects | ${pagesRows.length} |
| Queues | ${queueRows.length} |

## Workers

${table(["Script", "Modified"], workerRows)}

## KV namespaces

${table(["Title", "ID"], kvRows)}

## R2 buckets

${table(["Bucket", "Created"], r2Rows)}

## D1 databases

${table(["Name", "ID", "Tables"], d1Rows)}

## Zones (domains)

${table(["Zone", "Status", "Plan"], zoneRows)}

## Pages projects

${table(["Project", "Domain"], pagesRows)}

## Queues

${table(["Queue", "Created"], queueRows)}

## Key facts

- **Factsheet purpose:** single-page inventory of Cloudflare resources, plan, and binding IDs for ops and cfker management.
- **Refresh:** \`npm run factsheet\` or \`./scripts/cf-factsheet.sh\`
- **Outputs:** \`factsheet/factsheet.md\` (source) + \`factsheet/factsheet.html\` (rendered view)
- **Auth:** set \`CLOUDFLARE_API_TOKEN\` + \`CLOUDFLARE_ACCOUNT_ID\`, or run \`wrangler login\`
- **Recommended token permissions:** Account Read, Workers Scripts Read, Workers KV Storage Read, Workers R2 Storage Read, D1 Read, Zone Read, Billing Read

---
_Generated by cfker01 factsheet generator_
`;
}

function buildHtml(markdown, generatedAt) {
  const body = marked.parse(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cloudflare Factsheet — cfker01</title>
  <style>
    :root {
      --bg: #0f1419; --surface: #1a2332; --text: #e6edf3; --muted: #8b949e;
      --accent: #f6821f; --border: #30363d; --code-bg: #161b22;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.6;
      margin: 0; padding: 2rem 1rem 4rem;
    }
    .wrap { max-width: 960px; margin: 0 auto; }
    header {
      border-bottom: 1px solid var(--border); margin-bottom: 2rem; padding-bottom: 1rem;
    }
    header h1 { margin: 0 0 .25rem; font-size: 1.75rem; }
    header p { margin: 0; color: var(--muted); font-size: .9rem; }
    h2 {
      color: var(--accent); font-size: 1.15rem; margin-top: 2rem;
      border-bottom: 1px solid var(--border); padding-bottom: .35rem;
    }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; margin: 1rem 0; }
    th, td { border: 1px solid var(--border); padding: .5rem .65rem; text-align: left; }
    th { background: var(--surface); color: var(--accent); }
    tr:nth-child(even) td { background: rgba(255,255,255,.02); }
    blockquote {
      border-left: 3px solid var(--accent); margin: 0 0 1.5rem;
      padding: .5rem 1rem; background: var(--surface); color: var(--muted);
    }
    code { background: var(--code-bg); padding: .1rem .35rem; border-radius: 4px; font-size: .85em; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
    em { color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Cloudflare Factsheet</h1>
      <p>cfker01 · rendered ${generatedAt}</p>
    </header>
    ${body}
  </div>
</body>
</html>`;
}

async function main() {
  const auth = await resolveAuth();
  if (!auth?.accountId) {
    console.error(`
Cannot connect to Cloudflare. Set credentials and retry:

  export CLOUDFLARE_API_TOKEN="your-token"
  export CLOUDFLARE_ACCOUNT_ID="your-account-id"
  npm run factsheet

Or: npx wrangler login
`);
    process.exit(1);
  }

  const data = auth.token
    ? await fetchViaApi(auth.token, auth.accountId)
    : fetchViaWrangler(auth.accountId);

  const generatedAt = new Date().toISOString();
  const markdown = buildMarkdown(data, auth);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(MD_PATH, markdown, "utf8");
  writeFileSync(HTML_PATH, buildHtml(markdown, generatedAt), "utf8");

  console.log(`Factsheet written:\n  ${MD_PATH}\n  ${HTML_PATH}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
