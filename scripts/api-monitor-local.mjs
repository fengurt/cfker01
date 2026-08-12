#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const envFile = resolve(process.env.API_MONITOR_ENV_FILE || `${root}/.env.api-monitor`);
const key = (await exec("security", ["find-generic-password", "-s", "TableAI-Catalog-API-Monitor", "-a", "api-monitor", "-w"], { maxBuffer: 4096 })).stdout.trim();
if (!key.startsWith("tais_")) throw new Error("Scoped API monitor key is unavailable in the macOS Keychain");

const result = await exec(process.execPath, [`--env-file=${envFile}`, `${root}/scripts/api-monitor.mjs`], {
  cwd: root,
  timeout: 10 * 60_000,
  maxBuffer: 1024 * 1024,
  env: {
    ...process.env,
    API_MONITOR_KEY: key,
    API_MONITOR_ONCE: "1",
    API_MONITOR_PROVIDER_ALLOWLIST: "openai,perplexity",
    CATALOG_INTERNAL_URL: process.env.CATALOG_INTERNAL_URL || "https://g.ksamint.cn",
  },
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
