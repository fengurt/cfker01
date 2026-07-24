import { jsonResponse } from "../lib/response";
import { requireApiKey } from "../lib/apikey";
import { listSources } from "../collectors/registry";

const SERVER_INFO = { name: "cfker01", version: "0.2.0", protocolVersion: "2024-11-05" };
const SKILL_REPOSITORY = "fengurt/cfker01";
const SKILL_PATH_PREFIX = "skills";
const SERVER_CARD = {
  ...SERVER_INFO,
  capabilities: { tools: {}, resources: {} },
  auth: { type: "apiKey", header: "X-Api-Key", scopes: ["read", "skills:write"] },
  endpoints: { tools: "/mcp", resources: "/v1/status" },
};

const TOOLS = [
  { name: "get_status", description: "Get the latest snapshot for one source or all sources.", inputSchema: { type: "object", properties: { source: { type: "string" } } } },
  { name: "get_history", description: "Get recent snapshot history for one source.", inputSchema: { type: "object", required: ["source"], properties: { source: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } } },
  { name: "skills.list", description: "List staged and published agent skills without returning their bodies.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["validated", "publish_requested", "published", "rejected"] }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } } } },
  { name: "skills.get", description: "Get a skill draft by id or the newest version of a slug.", inputSchema: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" } } } },
  { name: "skills.stage", description: "Create a schema-validated SKILL.md draft. Requires skills:write; does not publish to GitHub.", inputSchema: { type: "object", required: ["slug", "content"], properties: { slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }, title: { type: "string" }, description: { type: "string" }, content: { type: "string", maxLength: 65536 } } } },
  { name: "skills.request_publish", description: "Mark a validated draft for the local GitHub publisher. It creates a branch and PR, never pushes main.", inputSchema: { type: "object", required: ["draftId"], properties: { draftId: { type: "string" } } } },
  { name: "skills.record_publish", description: "Record the PR created by the local GitHub publisher. Requires skills:write.", inputSchema: { type: "object", required: ["draftId", "branch", "pullRequestUrl"], properties: { draftId: { type: "string" }, branch: { type: "string" }, pullRequestUrl: { type: "string" }, commitSha: { type: "string" } } } },
];
const RESOURCES = [{ uri: "status://all", name: "All sources (latest)", mimeType: "application/json" }];
const WRITE_TOOLS = new Set(["skills.stage", "skills.request_publish", "skills.record_publish"]);

interface McpRequest { jsonrpc: "2.0"; id: string | number; method: string; params?: Record<string, unknown>; }
interface SkillDraftRow { id: string; slug: string; title: string; description: string; content: string; content_hash: string; status: string; validation: string; target_repo: string; target_path: string; branch: string | null; github_pr_url: string | null; published_commit_sha: string | null; created_at: string; updated_at: string; published_at: string | null; }

function makeError(id: McpRequest["id"] | null, code: number, message: string) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function makeResult(id: McpRequest["id"], result: unknown) { return { jsonrpc: "2.0", id, result }; }
function textResult(id: McpRequest["id"], data: unknown) { return makeResult(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }); }
function toolArgs(body: McpRequest) { return (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }; }
function parseJson(value: string) { try { return JSON.parse(value); } catch { return {}; } }

async function sha256(value: string) { const bytes = new TextEncoder().encode(value), digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function skillValidation(slug: string, title: string, description: string, content: string) {
  const errors: string[] = [], frontmatter = content.match(/^---\r?\n([\s\S]{1,8192}?)\r?\n---\r?\n/);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) errors.push("invalid_slug");
  if (title.trim().length < 3 || title.length > 120) errors.push("invalid_title");
  if (description.trim().length < 12 || description.length > 500) errors.push("invalid_description");
  if (content.length < 80 || content.length > 65_536) errors.push("invalid_content_length");
  if (!frontmatter) errors.push("missing_frontmatter");
  else {
    const name = frontmatter[1].match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
    const frontmatterDescription = frontmatter[1].match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim();
    if (name !== slug) errors.push("frontmatter_name_must_match_slug");
    if (!frontmatterDescription || frontmatterDescription.length < 12) errors.push("missing_frontmatter_description");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|cfk_[a-f0-9]{32,}|tais_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})\b/.test(content)) errors.push("secret_like_content_rejected");
  return { valid: errors.length === 0, errors, schemaVersion: "skill-v1" };
}
function publicDraft(row: SkillDraftRow, includeContent = false) { return { id: row.id, slug: row.slug, title: row.title, description: row.description, status: row.status, validation: parseJson(row.validation), target: { repository: row.target_repo, path: row.target_path, branch: row.branch, pullRequestUrl: row.github_pr_url, commitSha: row.published_commit_sha }, contentHash: row.content_hash, createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at, ...(includeContent ? { content: row.content } : {}) }; }

export async function handleMcpCard(): Promise<Response> { return jsonResponse(SERVER_CARD); }

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "GET") return jsonResponse({ hint: "POST JSON-RPC requests here. See /.well-known/mcp." });
  let body: McpRequest;
  try { body = (await request.json()) as McpRequest; } catch { return jsonResponse(makeError(null, -32700, "parse_error"), 400); }
  const params = toolArgs(body), name = params.name ?? "";
  const readAuth = await requireApiKey(request, env, ctx, "read");
  if (readAuth) return readAuth;
  if (body.method === "tools/call" && WRITE_TOOLS.has(name)) {
    const writeAuth = await requireApiKey(request, env, ctx, "skills:write");
    if (writeAuth) return writeAuth;
  }

  switch (body.method) {
    case "initialize": return jsonResponse(makeResult(body.id, { ...SERVER_INFO, capabilities: SERVER_CARD.capabilities }));
    case "tools/list": return jsonResponse(makeResult(body.id, { tools: TOOLS }));
    case "resources/list": return jsonResponse(makeResult(body.id, { resources: RESOURCES }));
    case "tools/call": return handleToolCall(body, env, ctx);
    default: return jsonResponse(makeError(body.id, -32601, "unknown_method"), 400);
  }
}

async function handleToolCall(body: McpRequest, env: Env, ctx: ExecutionContext): Promise<Response> {
  const params = toolArgs(body), name = params.name, args = params.arguments ?? {};
  if (name === "get_status") {
    const source = typeof args.source === "string" ? args.source : null;
    if (source) { const raw = await env.MGMT_KV.get(`status:latest:${source}`); return jsonResponse(makeResult(body.id, { content: [{ type: "text", text: raw ?? JSON.stringify({ error: "no_snapshot", source }) }] })); }
    const out: Record<string, unknown> = {}; for (const src of listSources()) { const raw = await env.MGMT_KV.get(`status:latest:${src.id}`); out[src.id] = raw ? JSON.parse(raw) : null; }
    return jsonResponse(textResult(body.id, out));
  }
  if (name === "get_history") {
    const source = typeof args.source === "string" ? args.source : "", limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
    if (!source) return jsonResponse(makeError(body.id, -32602, "source_required"), 400);
    const rows = await env.MGMT_DB.prepare("SELECT id,fetched_at,ok,duration_ms,payload,error FROM snapshots WHERE source_id=?1 ORDER BY id DESC LIMIT ?2").bind(source, limit).all();
    return jsonResponse(textResult(body.id, rows.results ?? []));
  }
  if (name === "skills.list") return listSkills(body.id, env, args);
  if (name === "skills.get") return getSkill(body.id, env, args);
  if (name === "skills.stage") return stageSkill(body, env, ctx, args);
  if (name === "skills.request_publish") return requestPublish(body.id, env, args);
  if (name === "skills.record_publish") return recordPublish(body.id, env, args);
  return jsonResponse(makeError(body.id, -32601, `unknown_tool: ${name}`), 400);
}

async function listSkills(id: McpRequest["id"], env: Env, args: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 100), status = typeof args.status === "string" ? args.status : null;
  const query = status ? env.MGMT_DB.prepare("SELECT * FROM mcp_skill_drafts WHERE status=?1 ORDER BY updated_at DESC LIMIT ?2").bind(status, limit) : env.MGMT_DB.prepare("SELECT * FROM mcp_skill_drafts ORDER BY updated_at DESC LIMIT ?1").bind(limit);
  const rows = await query.all<SkillDraftRow>(); return jsonResponse(textResult(id, { skills: (rows.results ?? []).map(row => publicDraft(row)) }));
}
async function getSkill(id: McpRequest["id"], env: Env, args: Record<string, unknown>) {
  const row = typeof args.id === "string" ? await env.MGMT_DB.prepare("SELECT * FROM mcp_skill_drafts WHERE id=?1").bind(args.id).first<SkillDraftRow>() : typeof args.slug === "string" ? await env.MGMT_DB.prepare("SELECT * FROM mcp_skill_drafts WHERE slug=?1 ORDER BY updated_at DESC LIMIT 1").bind(args.slug).first<SkillDraftRow>() : null;
  if (!row) return jsonResponse(makeError(id, -32602, "skill_not_found"), 404); return jsonResponse(textResult(id, publicDraft(row, true)));
}
async function stageSkill(body: McpRequest, env: Env, ctx: ExecutionContext, args: Record<string, unknown>) {
  const slug = String(args.slug ?? "").trim(), content = String(args.content ?? ""), frontmatter = content.match(/^---\r?\n([\s\S]{1,8192}?)\r?\n---\r?\n/), title = String(args.title ?? frontmatter?.[1].match(/^name:\s*([^\n]+)/m)?.[1] ?? slug).trim(), description = String(args.description ?? frontmatter?.[1].match(/^description:\s*["']?([^\n"']+)/m)?.[1] ?? "").trim(), validation = skillValidation(slug, title, description, content), now = new Date().toISOString();
  const row: SkillDraftRow = { id: crypto.randomUUID(), slug, title, description, content, content_hash: await sha256(content), status: validation.valid ? "validated" : "rejected", validation: JSON.stringify(validation), target_repo: SKILL_REPOSITORY, target_path: `${SKILL_PATH_PREFIX}/${slug}/SKILL.md`, branch: null, github_pr_url: null, published_commit_sha: null, created_at: now, updated_at: now, published_at: null };
  await env.MGMT_DB.prepare("INSERT INTO mcp_skill_drafts(id,slug,title,description,content,content_hash,status,validation,target_repo,target_path,created_by_key_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,?11,?11)").bind(row.id,row.slug,row.title,row.description,row.content,row.content_hash,row.status,row.validation,row.target_repo,row.target_path,now).run();
  ctx.waitUntil(env.MGMT_DB.prepare("INSERT INTO audit_events(event_type,payload,created_at) VALUES(?1,?2,?3)").bind("mcp.skill_staged",JSON.stringify({draftId:row.id,slug,status:row.status,contentHash:row.content_hash,validation}),now).run());
  return jsonResponse(textResult(body.id, publicDraft(row, true)));
}
async function requestPublish(id: McpRequest["id"], env: Env, args: Record<string, unknown>) {
  const draftId = String(args.draftId ?? ""), row = await env.MGMT_DB.prepare("SELECT * FROM mcp_skill_drafts WHERE id=?1").bind(draftId).first<SkillDraftRow>();
  if (!row) return jsonResponse(makeError(id, -32602, "skill_not_found"), 404);
  if (row.status !== "validated" && row.status !== "publish_requested") return jsonResponse(makeError(id, -32602, "skill_must_be_validated"), 400);
  const now = new Date().toISOString(); await env.MGMT_DB.prepare("UPDATE mcp_skill_drafts SET status='publish_requested',updated_at=?1 WHERE id=?2").bind(now,row.id).run();
  return jsonResponse(textResult(id, { ...publicDraft({ ...row, status: "publish_requested", updated_at: now }), publisher: { command: `npm run skills:publish -- ${row.id}`, repository: SKILL_REPOSITORY, policy: "Creates a branch and pull request; never pushes main." } }));
}
async function recordPublish(id: McpRequest["id"], env: Env, args: Record<string, unknown>) {
  const draftId = String(args.draftId ?? ""), branch = String(args.branch ?? ""), pullRequestUrl = String(args.pullRequestUrl ?? ""), commitSha = typeof args.commitSha === "string" ? args.commitSha : null;
  if (!branch.startsWith("mcp/skill-") || !new RegExp(`^https://github\\.com/${SKILL_REPOSITORY}/pull/\\d+$`).test(pullRequestUrl)) return jsonResponse(makeError(id, -32602, "invalid_publish_target"), 400);
  const row = await env.MGMT_DB.prepare("SELECT * FROM mcp_skill_drafts WHERE id=?1").bind(draftId).first<SkillDraftRow>(); if (!row) return jsonResponse(makeError(id, -32602, "skill_not_found"), 404);
  const now = new Date().toISOString(); await env.MGMT_DB.prepare("UPDATE mcp_skill_drafts SET status='published',branch=?1,github_pr_url=?2,published_commit_sha=?3,published_at=?4,updated_at=?4 WHERE id=?5").bind(branch,pullRequestUrl,commitSha,now,row.id).run();
  return jsonResponse(textResult(id, publicDraft({ ...row, status: "published", branch, github_pr_url: pullRequestUrl, published_commit_sha: commitSha, published_at: now, updated_at: now })));
}
