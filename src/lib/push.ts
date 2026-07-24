import type { SourceConfig } from "../collectors/types";
import { logEvent } from "./logger";

const DEDUPE_TTL_SECONDS = 60;
const MAX_RETRIES = 2;

interface WebhookRow {
  id: string;
  source_id: string;
  url: string;
  secret: string;
  active: number;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function postWithRetry(url: string, body: string, signature: string): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cfker-Signature": `sha256=${signature}`,
        },
        body,
      });
      if (res.ok) return;
    } catch {
      // network errors fall through to retry
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt + Math.random() * 100));
    }
  }
}

export interface SnapshotPush {
  fetchedAt: string;
  payload: Record<string, unknown>;
}

export async function deliverSnapshot(
  env: Env,
  src: SourceConfig,
  snap: SnapshotPush,
): Promise<void> {
  const rows = await env.MGMT_DB.prepare(
    `SELECT id, source_id, url, secret, active FROM webhooks
     WHERE source_id = ?1 AND active = 1`,
  )
    .bind(src.id)
    .all<WebhookRow>();

  if (!rows.results?.length) return;

  const body = JSON.stringify({
    source: src.id,
    label: src.label,
    fetchedAt: snap.fetchedAt,
    payload: snap.payload,
  });

  // KV has no atomic "put-if-absent"; do a get-then-put to dedupe.
  // A race is fine here because cron runs every 30 min and webhooks are idempotent.
  const digest = await sha256Hex(body);
  const dedupeKey = `push:dedupe:${src.id}:${digest.slice(0, 32)}`;
  const existing = await env.MGMT_KV.get(dedupeKey);
  if (existing) return;
  await env.MGMT_KV.put(dedupeKey, "1", { expirationTtl: DEDUPE_TTL_SECONDS });

  await Promise.all(
    rows.results.map(async (hook) => {
      const sig = await signBody(hook.secret, body);
      try {
        await postWithRetry(hook.url, body, sig);
        logEvent("info", "webhook.delivered", { source: src.id, url: hook.url });
      } catch (err) {
        logEvent("warn", "webhook.failed", {
          source: src.id,
          url: hook.url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}