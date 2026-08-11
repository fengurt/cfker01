#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const specPath = resolve(root, "docs/resource-operations-spec.md");
const acceptancePath = resolve(root, "docs/resource-operations-acceptance.md");
const contextPath = resolve(root, "CONTEXT.md");
const spec = await readFile(specPath, "utf8");
const acceptance = await readFile(acceptancePath, "utf8");
const context = await readFile(contextPath, "utf8");
const ids = Array.from({ length: 25 }, (_, index) => `ROP-${String(index + 1).padStart(3, "0")}`);
const missing = ids.filter((id) => !spec.includes(`| ${id} |`));
const duplicated = ids.filter((id) => (spec.match(new RegExp(`\\b${id}\\b`, "g")) || []).length !== 1);
const unmapped = ids.filter((id) => !acceptance.includes(id));
const errors = [
  ...(missing.length ? [`missing specification IDs: ${missing.join(", ")}`] : []),
  ...(duplicated.length ? [`duplicated specification IDs: ${duplicated.join(", ")}`] : []),
  ...(unmapped.length ? [`unmapped acceptance IDs: ${unmapped.join(", ")}`] : []),
  ...(["Project", "Asset", "Fact", "Annotation", "Freshness", "Incident", "Placement recommendation", "Resource snapshot"].filter((term) => !context.includes(`**${term}**`)).map((term) => `missing glossary term: ${term}`)),
];
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Validated ${ids.length} resource-operations decisions, acceptance mappings, glossary terms, and ADR-backed boundaries.`);
