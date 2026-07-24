#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const draftId = process.argv[2];
const mcpUrl = process.env.KSAMINT_MCP_URL || "https://g.ksamint.cn/mcp";
const apiKey = process.env.KSAMINT_MCP_WRITE_KEY;
const repository = process.env.KSAMINT_SKILL_REPOSITORY || "fengurt/cfker01";
const baseBranch = process.env.KSAMINT_SKILL_BASE_BRANCH || "main";

if (!draftId || !apiKey) {
  console.error("Usage: KSAMINT_MCP_WRITE_KEY=... npm run skills:publish -- <draft-id>");
  process.exit(2);
}

async function mcp(name, args) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) throw new Error(body?.error?.message || `MCP HTTP ${response.status}`);
  const text = body?.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("MCP returned no tool content");
  return JSON.parse(text);
}
async function gh(...args) { return execFile("gh", args, { maxBuffer: 2_000_000 }); }

const draft = await mcp("skills.get", { id: draftId });
if (draft.status !== "publish_requested") throw new Error(`Draft status must be publish_requested; got ${draft.status}`);
if (draft.target?.repository !== repository || !draft.target?.path?.startsWith("skills/")) throw new Error("Draft target is outside the approved repository path");

const slug = draft.slug;
const branch = `mcp/skill-${slug}-${draft.id.slice(0, 8)}`;
const baseSha = (await gh("api", `repos/${repository}/git/ref/heads/${baseBranch}`, "--jq", ".object.sha")).stdout.trim();
await gh("api", "--method", "POST", `repos/${repository}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${baseSha}`);
await gh("api", "--method", "PUT", `repos/${repository}/contents/${draft.target.path}`, "-f", `message=feat(skill): add ${slug}`, "-f", `content=${Buffer.from(draft.content, "utf8").toString("base64")}`, "-f", `branch=${branch}`);
const pullRequestUrl = (await gh("pr", "create", "--repo", repository, "--head", branch, "--base", baseBranch, "--title", `feat(skill): add ${slug}`, "--body", `Publishes MCP-staged skill \`${slug}\` from draft \`${draft.id}\`.\n\nValidated by Ksamint MCP; review before merge.`)).stdout.trim();
const commitSha = (await gh("api", `repos/${repository}/commits/${branch}`, "--jq", ".sha")).stdout.trim();
await mcp("skills.record_publish", { draftId: draft.id, branch, pullRequestUrl, commitSha });
console.log(JSON.stringify({ draftId: draft.id, branch, pullRequestUrl, commitSha }, null, 2));
