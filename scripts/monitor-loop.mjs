#!/usr/bin/env node
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { isPublicAddress } from "./lib/dns-probe.mjs";

const base = process.env.WORKER_URL || "http://catalog:8787";
const token = process.env.INTERNAL_MONITOR_TOKEN;
const intervalMs = Math.max(60, Number(process.env.MONITOR_INTERVAL_SECONDS || 300)) * 1000;
const timeoutMs = Math.max(1000, Number(process.env.MONITOR_TIMEOUT_MS || 5000));
const concurrency = Math.max(1, Math.min(20, Number(process.env.MONITOR_CONCURRENCY || 6)));
if (!token) throw new Error("INTERNAL_MONITOR_TOKEN is required");
await mkdir("/data/monitor", { recursive: true });

while (true) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let status = "complete";
  try {
    const targetResponse = await fetch(`${base}/admin/monitor/targets`, { headers: authHeaders() });
    if (!targetResponse.ok) throw new Error(`targets_http_${targetResponse.status}`);
    const body = await targetResponse.json();
    const targets = Array.isArray(body.data) ? body.data : [];
    const results = await runPool(targets, concurrency, probeTarget);
    const resultResponse = await fetch(`${base}/admin/monitor/results`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ runId: body.requestedRunId || randomUUID(), startedAt, durationMs: Date.now() - started, results }),
    });
    if (!resultResponse.ok) throw new Error(`results_http_${resultResponse.status}`);
    const snapshotResponse = await fetch(`${base}/admin/monitor/snapshot`, { method: "POST", headers: authHeaders() });
    if (!snapshotResponse.ok) console.warn(JSON.stringify({ event: "resource_snapshot_failed", status: snapshotResponse.status }));
    await writeFile("/data/monitor/last-success", new Date().toISOString());
    console.log(JSON.stringify({ event: "monitor_complete", targets: results.length, durationMs: Date.now() - started }));
  } catch (error) {
    status = "failed";
    await writeFile("/data/monitor/last-error", `${new Date().toISOString()} ${safeError(error)}\n`);
    console.error(JSON.stringify({ event: "monitor_failed", error: safeError(error) }));
  }
  const elapsed = Date.now() - started;
  await new Promise((resolve) => setTimeout(resolve, Math.max(1000, intervalMs - elapsed)));
  if (status === "failed") continue;
}

async function probeTarget(target) {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  let url;
  try { url = new URL(String(target.url)); } catch { return result(target, "down", checkedAt, started, { errorCode: "invalid_url" }); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return result(target, "down", checkedAt, started, { errorCode: "unsafe_url" });
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); } catch (error) { return result(target, "down", checkedAt, started, { errorCode: safeError(error) }); }
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) return result(target, "down", checkedAt, started, { errorCode: "private_or_missing_address" });
  try {
    let response = await requestStatus(url, addresses[0], "HEAD");
    if (response.statusCode === 405) response = await requestStatus(url, addresses[0], "GET");
    const httpStatus = response.statusCode;
    const status = httpStatus < 400 || httpStatus === 401 || httpStatus === 403 ? "healthy" : "degraded";
    return result(target, status, checkedAt, started, { httpStatus, errorCode: status === "degraded" ? `http_${httpStatus}` : null });
  } catch (error) {
    return result(target, "down", checkedAt, started, { errorCode: safeError(error) });
  }
}

function requestStatus(url, address, method) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      servername: url.protocol === "https:" ? url.hostname : undefined,
      port: url.port || undefined,
      path: `${url.pathname || "/"}${url.search}`,
      method,
      timeout: timeoutMs,
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [address]) : callback(null, address.address, address.family),
      headers: { "User-Agent": "TableAI-Health-Monitor/1.0", Accept: "*/*", ...(method === "GET" ? { Range: "bytes=0-1023" } : {}) },
    }, (response) => { const statusCode = response.statusCode || 0; response.destroy(); resolve({ statusCode }); });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

function result(target, status, checkedAt, started, extra = {}) {
  return { entityType: target.entityType, entityId: target.entityId, status, checkedAt, latencyMs: Date.now() - started, ...extra };
}
function authHeaders() { return { Authorization: `Bearer ${token}` }; }
function safeError(error) { return String(error?.code || error?.message || error).replace(/[\r\n]/g, " ").slice(0, 160); }
async function runPool(values, limit, work) { const output = new Array(values.length); let index = 0; await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (index < values.length) { const position = index++; output[position] = await work(values[position]); } })); return output; }
