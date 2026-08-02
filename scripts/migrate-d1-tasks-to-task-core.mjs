#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const remote = args.has("--remote");
const dryRun = args.has("--dry-run");
const envIndex = process.argv.indexOf("--env");
const environment =
  (envIndex >= 0 ? process.argv[envIndex + 1] : "") ||
  (remote ? "production" : "");
const database = process.env.D1_DATABASE_NAME || "cfker01-mgmt";
const taskCoreUrl = process.env.TASK_CORE_URL;
const internalToken = process.env.TASK_CORE_INTERNAL_TOKEN;
const wranglerBase = [
  "wrangler",
  "d1",
  "execute",
  database,
  remote ? "--remote" : "--local",
  "--json",
];
if (environment) wranglerBase.push("--env", environment);

function query(sql) {
  const output = execFileSync("npx", [...wranglerBase, "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const parsed = JSON.parse(output);
  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  return result?.results || result?.result?.[0]?.results || [];
}

if (remote && !dryRun) {
  mkdirSync(".task-migration", { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const exportArgs = [
    "wrangler",
    "d1",
    "export",
    database,
    "--remote",
    "--output",
    `.task-migration/d1-tasks-${stamp}.sql`,
  ];
  if (environment) exportArgs.push("--env", environment);
  execFileSync("npx", exportArgs, { stdio: "inherit" });
}

const payload = {
  projects: query(
    "SELECT p.* FROM catalog_projects p WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.project_id=p.id)",
  ),
  people: query("SELECT * FROM task_people ORDER BY created_at"),
  milestones: query("SELECT * FROM task_milestones ORDER BY created_at"),
  tasks: query("SELECT * FROM tasks ORDER BY created_at"),
  participants: query("SELECT * FROM task_participants ORDER BY created_at"),
  dependencies: query("SELECT * FROM task_dependencies ORDER BY created_at"),
  comments: query("SELECT * FROM task_comments ORDER BY created_at"),
  activity: query("SELECT * FROM task_activity ORDER BY created_at"),
  views: query("SELECT * FROM task_saved_views ORDER BY created_at"),
};
const counts = Object.fromEntries(
  Object.entries(payload).map(([key, value]) => [key, value.length]),
);
const checksum = createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex");
console.log(
  JSON.stringify({
    source: remote ? `remote:${environment || "default"}` : "local",
    counts,
    checksum,
    dryRun,
  }),
);
if (dryRun) process.exit(0);
if (!taskCoreUrl || !internalToken)
  throw new Error(
    "TASK_CORE_URL and TASK_CORE_INTERNAL_TOKEN are required for migration",
  );

const response = await fetch(
  new URL("/api/task/v1/migration/d1", taskCoreUrl),
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-task-internal-token": internalToken,
    },
    body: JSON.stringify(payload),
  },
);
const body = await response.json().catch(() => ({}));
if (!response.ok)
  throw new Error(
    `Task migration failed: ${response.status} ${JSON.stringify(body)}`,
  );
for (const [key, count] of Object.entries(counts)) {
  const resultKey = key === "activity" ? "events" : key;
  if (
    Number(body.data?.counts?.[resultKey] ?? 0) !== count &&
    !["projects", "people", "milestones", "comments", "views"].includes(key)
  ) {
    throw new Error(
      `Migration count mismatch for ${key}: expected ${count}, received ${body.data?.counts?.[resultKey]}`,
    );
  }
}
console.log(
  JSON.stringify({
    migrated: true,
    sourceChecksum: checksum,
    result: body.data,
  }),
);
