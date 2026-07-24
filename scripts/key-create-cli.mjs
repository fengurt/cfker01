#!/usr/bin/env node
// Create an API key via /admin/keys.
// Usage: ADMIN_TOKEN=... WORKER_URL=https://cfker01-production.workers.dev npm run key:create -- [name] [scope1,scope2]
const url = process.env.WORKER_URL ?? "http://127.0.0.1:8787";
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error("ADMIN_TOKEN env var required");
  process.exit(1);
}
const name = process.argv[2] ?? "default";
const scopes = (process.argv[3] ?? "read").split(",").map((s) => s.trim()).filter(Boolean);

const res = await fetch(`${url}/admin/keys`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name, scopes }),
});
console.log(res.status, await res.text());