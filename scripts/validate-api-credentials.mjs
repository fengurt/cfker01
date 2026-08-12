import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const registry = JSON.parse(readFileSync(resolve(root, "config/api-credentials.registry.json"), "utf8"));
const list = JSON.parse(execFileSync("op", ["item", "list", "--vault", registry.vault, "--format=json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
const titleCounts = new Map();
for (const item of list) titleCounts.set(item.title, (titleCounts.get(item.title) || 0) + 1);

const failures = [];
for (const provider of registry.providers) {
  const count = titleCounts.get(provider.itemTitle) || 0;
  if (!provider.configured && count === 0) {
    console.log(`optional/unconfigured ${provider.id}: ${provider.itemTitle}`);
    continue;
  }
  if (count !== 1) {
    failures.push(`${provider.id}: expected exactly one item named ${provider.itemTitle}, found ${count}`);
    continue;
  }
  const item = JSON.parse(execFileSync("op", ["item", "get", provider.itemTitle, "--vault", registry.vault, "--format=json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  const fields = new Map((item.fields || []).map((field) => [field.id, field]));
  for (const fieldId of registry.requiredFields) {
    const field = fields.get(fieldId);
    if (!field || !String(field.value || "").trim()) failures.push(`${provider.id}: missing ${fieldId}`);
  }
  const credential = fields.get("credential");
  if (credential?.type !== "CONCEALED") failures.push(`${provider.id}: credential must be CONCEALED`);
  if (!provider.itemTitle.startsWith(registry.itemPrefix)) failures.push(`${provider.id}: invalid title prefix`);
  console.log(`validated ${provider.id}: metadata and concealed credential present`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("API credential registry validation passed; no secret values were printed.");
