#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";

const exec = promisify(execFile);
const base = process.env.WORKER_URL || "http://catalog:8787";
const key = process.env.SCANNER_KEY;
const pollSeconds = Math.max(10, Number(process.env.SCANNER_POLL_SECONDS || 60));
const timeout = Math.max(60_000, Number(process.env.SYNC_TIMEOUT_SECONDS || 2700) * 1000);
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
if (!key) throw new Error("SCANNER_KEY is required");

await mkdir("/data/assets", { recursive: true });
while (true) {
  try {
    const jobs = (await api(`${base}/api/ingest/v1/jobs`, { headers })).data || [];
    if (!jobs.length) await sleep(pollSeconds * 1000);
    for (const job of jobs) await execute(job);
  } catch (error) {
    await recordError("poll", error);
    await sleep(Math.min(300, pollSeconds * 2) * 1000);
  }
}

async function execute(job) {
  let claim;
  try {
    claim = (await api(`${base}/api/ingest/v1/jobs/${encodeURIComponent(job.id)}/claim`, { method: "POST", headers, body: "{}" })).data;
  } catch (error) {
    if (String(error?.message || error).startsWith("409 ")) return;
    throw error;
  }
  const started = new Date().toISOString();
  console.log(JSON.stringify({ event: "scanner.job.started", jobId: job.id, connectorId: claim.connectorId, provider: claim.provider, at: started }));
  try {
    await exec(process.execPath, ["./scripts/discover-assets.mjs", "--upload"], {
      timeout,
      maxBuffer: 20_000_000,
      env: {
        ...process.env,
        ASSET_DISCOVERY_PROVIDERS: claim.provider,
        SCAN_JOB_ID: job.id,
        SCANNER_CONNECTOR_PROVIDER: claim.provider,
        ASSET_DISCOVERY_OUTPUT: `/data/assets/${claim.provider}-${job.id}.json`,
      },
    });
    await writeFile("/data/assets/last-success", `${new Date().toISOString()}\n`, { mode: 0o600 });
    await rm("/data/assets/last-error", { force: true });
    console.log(JSON.stringify({ event: "scanner.job.completed", jobId: job.id, provider: claim.provider, at: new Date().toISOString() }));
  } catch (error) {
    await failUnstartedRun(job, error);
    await recordError(job.id, error);
    console.error(JSON.stringify({ event: "scanner.job.failed", jobId: job.id, provider: claim.provider, error: safeError(error), at: new Date().toISOString() }));
  }
}

async function failUnstartedRun(job, error) {
  try {
    const run = (await api(`${base}/api/ingest/v1/runs`, { method: "POST", headers, body: JSON.stringify({ jobId: job.id, schemaVersion: "asset-discovery-v1", fingerprint: "scanner-process-failed" }) })).data;
    await api(`${base}/api/ingest/v1/runs/${run.id}/fail`, { method: "POST", headers, body: JSON.stringify({ code: "scanner_process_failed", message: safeError(error) }) });
  } catch {}
}
async function recordError(scope, error) { await writeFile("/data/assets/last-error", `${new Date().toISOString()} ${scope} ${safeError(error)}\n`, { mode: 0o600 }).catch(() => {}); }
function safeError(error) {
  const lines=String(error?.stderr || error?.message || error || "unknown").trim().split("\n").map(line=>line.trim()).filter(Boolean);
  return (lines.find(line=>/^(Error|TypeError|SyntaxError|ReferenceError|RangeError)\b/.test(line))||lines.find(line=>!/^Node\.js v\d/.test(line))||"unknown").slice(0,500);
}
async function api(url, options) { const response = await fetch(url, options), text = await response.text(); if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 1000)}`); return text ? JSON.parse(text) : {}; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
