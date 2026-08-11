#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const cache = resolve(process.env.LOCAL_SCANNER_CACHE || `${root}/.cache/local-scanner`);
const inventory = resolve(cache, "inventory.json");
const audit = resolve(cache, "repository-audit/latest.json");
const output = resolve(cache, "latest-assets.json");
const base = process.env.WORKER_URL || "https://g.ksamint.cn";
const key = process.env.SCANNER_KEY || await keychainKey();
if (!key) throw new Error("Local scanner key is unavailable in the macOS Keychain");
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
await mkdir(resolve(cache, "repository-audit"), { recursive: true });
await mkdir(resolve(cache, "outbox"), { recursive: true });

const jobs = (await api(`${base}/api/ingest/v1/jobs`, { headers })).data || [];
for (const queued of jobs) {
  const job = (await api(`${base}/api/ingest/v1/jobs/${encodeURIComponent(queued.id)}/claim`, { method: "POST", headers, body: "{}" })).data;
  if (job.provider !== "local") continue;
  try {
    await exec(process.execPath, [`${root}/scripts/scan-local-projects.mjs`, process.env.LOCAL_SCAN_ROOT || "/Users/af/cpro01"], { timeout: 45 * 60_000, maxBuffer: 2_000_000, env: { ...process.env, LOCAL_SCAN_OUTPUT: inventory } });
    const fingerprint = await localFingerprint();
    const previous = await readFile(resolve(cache, "last-fingerprint"), "utf8").catch(() => "");
    if (previous.trim() === fingerprint && queued.mode !== "full") await completeCacheHit(queued.id, fingerprint);
    else {
      await exec(process.execPath, [`${root}/scripts/repository-audit.mjs`], { cwd: root, timeout: 45 * 60_000, maxBuffer: 20_000_000, env: { ...process.env, REPOSITORY_SCAN_ROOT: process.env.LOCAL_SCAN_ROOT || "/Users/af/cpro01", REPOSITORY_AUDIT_CACHE: resolve(cache, "repository-audit") } });
      const discovery = await exec(process.execPath, [`${root}/scripts/discover-assets.mjs`, "--upload"], { cwd: root, timeout: 45 * 60_000, maxBuffer: 20_000_000, env: { ...process.env, WORKER_URL: base, SCANNER_KEY: key, SCAN_JOB_ID: queued.id, SCANNER_CONNECTOR_PROVIDER: "local", ASSET_DISCOVERY_PROVIDERS: "local", LOCAL_INVENTORY_PATH: inventory, REPOSITORY_AUDIT_PATH: audit, ASSET_DISCOVERY_OUTPUT: output } });
      const summary = [...String(discovery.stdout || "").trim().split("\n")].reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).find(Boolean);
      if (summary?.uploadStatus === "partial") await writeFile(resolve(cache, "last-partial"), `${new Date().toISOString()}\n`, { mode: 0o600 });
      else if (summary?.uploadStatus !== "completed") throw new Error("scanner_upload_status_missing");
      await writeFile(resolve(cache, "last-fingerprint"), `${fingerprint}\n`, { mode: 0o600 });
    }
    await writeFile(resolve(cache, "last-success"), `${new Date().toISOString()}\n`, { mode: 0o600 });
  } catch (error) {
    const message = safeError(error);
    await writeFile(resolve(cache, "last-error"), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
    await writeFile(resolve(cache, `outbox/${queued.id}.json`), JSON.stringify({ jobId: queued.id, createdAt: new Date().toISOString(), inventory, audit, output, error: message }), { mode: 0o600 });
    await failJob(queued.id, message).catch(() => {});
  }
}

async function completeCacheHit(jobId, fingerprint) {
  const run = (await api(`${base}/api/ingest/v1/runs`, { method: "POST", headers, body: JSON.stringify({ jobId, schemaVersion: "asset-discovery-v1", fingerprint }) })).data;
  await api(`${base}/api/ingest/v1/runs/${run.id}/complete`, { method: "POST", headers, body: JSON.stringify({ authoritative: false, errors: [], durationMs: 0, cacheHit: true }) });
}
async function failJob(jobId, message) { const run = (await api(`${base}/api/ingest/v1/runs`, { method: "POST", headers, body: JSON.stringify({ jobId, schemaVersion: "asset-discovery-v1", fingerprint: "local-scanner-failed" }) })).data; await api(`${base}/api/ingest/v1/runs/${run.id}/fail`, { method: "POST", headers, body: JSON.stringify({ code: "local_scanner_failed", message }) }); }
async function localFingerprint() { const value = JSON.parse(await readFile(inventory, "utf8")); const stable = (value.resources || []).map((item) => ({ id: item.id, sourceRef: item.sourceRef, sourceUpdatedAt: item.sourceUpdatedAt, repositoryUrl: item.repositoryUrl, gitHead: item.metadata?.gitHead, gitDirty: item.metadata?.gitDirty, resourceTypes: item.resourceTypes })).sort((a, b) => a.id.localeCompare(b.id)); return createHash("sha256").update(JSON.stringify(stable)).digest("hex"); }
async function keychainKey() { try { return (await exec("security", ["find-generic-password", "-s", "TableAI-Catalog-Local-Scanner", "-a", "scanner", "-w"], { maxBuffer: 4096 })).stdout.trim(); } catch { return ""; } }
async function api(url, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) }), text = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 1000)}`);
      return text ? JSON.parse(text) : {};
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}
function safeError(error) {
  const lines = String(error?.stderr || error?.message || error || "unknown").trim().split("\n").map(line => line.trim()).filter(Boolean);
  const useful = [...lines].reverse().find(line => /(?:^\w*Error:|\b(?:ECONN|UND_ERR|ETIMEDOUT|HTTP)\b)/.test(line) && !/^Node\.js\b/.test(line));
  return (useful || lines.find(line => !/^Node\.js\b/.test(line)) || "unknown").slice(0, 500);
}
