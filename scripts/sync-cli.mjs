#!/usr/bin/env node
// Trigger a manual sync via /admin/sync.
// Usage: ADMIN_TOKEN=... WORKER_URL=https://cfker01-production.workers.dev npm run sync
const url = process.env.WORKER_URL ?? "http://127.0.0.1:8787";
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error("ADMIN_TOKEN env var required");
  process.exit(1);
}
const res = await fetch(`${url}/admin/sync`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
console.log(res.status, await res.text());