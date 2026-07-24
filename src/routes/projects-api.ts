import inventory from "../generated/local-projects.json";
import { requireApiKey } from "../lib/apikey";

interface ProjectInput {
  id?: string; name?: string; description?: string | null; resourceTypes?: string[]; platform?: string; sourceKind?: string; sourceRef?: string;
  homepage?: string | null; repositoryUrl?: string | null; languages?: string[]; frameworks?: string[]; status?: string; visibility?: string; discoveredAt?: string; metadata?: Record<string, unknown>;
}

export async function handleProjectsApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url); const parts = url.pathname.split("/").filter(Boolean); const id = parts[3];
  if (request.method === "POST" && !id) { const auth = await requireApiKey(request, env, ctx, "write"); if (auth) return auth; return upsertExternal(request, env); }
  if (request.method !== "GET") return json({ error: { code: "method_not_allowed", message: "Supported methods are GET and authenticated POST." } }, 405);
  if (id) return projectDetail(env, id);
  return projectList(env, url);
}

async function projectList(env: Env, url: URL): Promise<Response> {
  const page = integer(url.searchParams.get("page"), 1); const perPage = integer(url.searchParams.get("per_page"), 50);
  if (!page || !perPage || perPage > 100) return json({ error: { code: "invalid_query", message: "page and per_page must be positive integers; per_page cannot exceed 100." } }, 400);
  const q=url.searchParams.get("q")?.toLowerCase(),platform=url.searchParams.get("platform"),type=url.searchParams.get("type"),sourceKind=url.searchParams.get("source_kind"),tag=url.searchParams.get("tag"),deployed=url.searchParams.get("deployed"),benchmark=url.searchParams.get("benchmark"),updatedSince=url.searchParams.get("updated_since");
  const merged = await allProjects(env);
  const filtered=merged.filter((item:any)=>item.visibility==="public"&&(!platform||item.platform===platform)&&(!type||item.resourceTypes.includes(type))&&(!sourceKind||item.sourceKind===sourceKind)&&(!tag||item.tags?.includes(tag))&&(!deployed||(deployed==="true"?item.deploymentCount>0:item.deploymentCount===0))&&(!benchmark||(benchmark==="true"?item.benchmarkCount>0:item.benchmarkCount===0))&&(!updatedSince||Date.parse(item.sourceUpdatedAt??item.updatedAt??0)>=Date.parse(updatedSince))&&(!q||`${item.name} ${item.description??""} ${item.sourceRef} ${item.frameworks.join(" ")}`.toLowerCase().includes(q)));
  const start = (page - 1) * perPage;
  return json({ data: filtered.slice(start, start + perPage), meta: { page, perPage, total: filtered.length, pages: Math.ceil(filtered.length / perPage), version: "v1", scannedAt: inventory.generatedAt } });
}

async function projectDetail(env: Env, id: string): Promise<Response> {
  const item = (await allProjects(env)).find((project) => project.id === id && project.visibility === "public");
  return item ? json({ data: item, meta: { version: "v1" } }) : json({ error: { code: "not_found", message: "Project not found." } }, 404);
}

async function upsertExternal(request: Request, env: Env): Promise<Response> {
  let input: ProjectInput; try { input = await request.json() as ProjectInput; } catch { return json({ error: { code: "invalid_json", message: "Request body must be JSON." } }, 400); }
  const error = validate(input); if (error) return json({ error: { code: "invalid_project", message: error } }, 400);
  const now = new Date().toISOString(); const id = input.id || `external-${crypto.randomUUID()}`;
  await env.MGMT_DB.prepare(`INSERT INTO catalog_projects (id,name,description,resource_types,platform,source_kind,source_ref,homepage,repository_url,languages,frameworks,status,visibility,discovered_at,updated_at,metadata) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,resource_types=excluded.resource_types,platform=excluded.platform,source_kind=excluded.source_kind,source_ref=excluded.source_ref,homepage=excluded.homepage,repository_url=excluded.repository_url,languages=excluded.languages,frameworks=excluded.frameworks,status=excluded.status,visibility=excluded.visibility,updated_at=excluded.updated_at,metadata=excluded.metadata`)
    .bind(id,input.name,input.description??null,JSON.stringify(input.resourceTypes),input.platform,input.sourceKind,input.sourceRef,input.homepage??null,input.repositoryUrl??null,JSON.stringify(input.languages??[]),JSON.stringify(input.frameworks??[]),input.status??"draft",input.visibility??"public",input.discoveredAt??now,now,JSON.stringify(input.metadata??{})).run();
  return json({ data: { id }, meta: { createdOrUpdatedAt: now, version: "v1" } }, 201);
}

async function allProjects(env: Env) {
  const local = inventory.resources;
  try { const result = await env.MGMT_DB.prepare(`SELECT p.*,(SELECT GROUP_CONCAT(t.name) FROM project_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.project_id=p.id) tag_names,(SELECT COUNT(*) FROM deployments d WHERE d.project_id=p.id) deployment_count,(SELECT COUNT(*) FROM benchmark_candidates c WHERE c.project_id=p.id AND c.status='approved') benchmark_count FROM catalog_projects p ORDER BY updated_at DESC`).all<Record<string, unknown>>(); const db = (result.results ?? []).map(fromRow); const byId = new Map(local.map((item:any) => [item.id, {...item,tags:[],deploymentCount:0,benchmarkCount:0}])); for (const item of db) byId.set(item.id, item as never); return [...byId.values()]; } catch { return local.map((item:any)=>({...item,tags:[],deploymentCount:0,benchmarkCount:0})); }
}

function fromRow(row: Record<string, unknown>) { return { id:String(row.id),name:String(row.name),description:row.description?String(row.description):null,resourceTypes:parseArray(row.resource_types),platform:String(row.platform),sourceKind:String(row.source_kind),sourceRef:String(row.source_ref),homepage:row.homepage?String(row.homepage):null,repositoryUrl:row.repository_url?String(row.repository_url):null,languages:parseArray(row.languages),frameworks:parseArray(row.frameworks),status:String(row.status),visibility:String(row.visibility),discoveredAt:String(row.discovered_at),updatedAt:String(row.updated_at),sourceUpdatedAt:row.source_updated_at?String(row.source_updated_at):null,lastScannedAt:row.last_scanned_at?String(row.last_scanned_at):null,tags:row.tag_names?String(row.tag_names).split(","):[],deploymentCount:Number(row.deployment_count??0),benchmarkCount:Number(row.benchmark_count??0),metadata:parseObject(row.metadata) }; }
function parseArray(value: unknown): string[] { try { const parsed=JSON.parse(String(value)); return Array.isArray(parsed)?parsed.map(String):[]; } catch { return []; } }
function parseObject(value: unknown): Record<string,unknown> { try { const parsed=JSON.parse(String(value)); return parsed&&typeof parsed==="object"?parsed:{}; } catch { return {}; } }
function integer(value: string|null, fallback: number) { if (value===null) return fallback; const number=Number(value); return Number.isInteger(number)&&number>0?number:0; }
function validate(input: ProjectInput): string|null { if (!input.name?.trim()) return "name is required"; if (!input.platform?.trim()) return "platform is required"; if (!input.sourceKind?.trim()) return "sourceKind is required"; if (!input.sourceRef?.trim()) return "sourceRef is required"; if (!input.resourceTypes?.length) return "resourceTypes is required"; for (const url of [input.homepage,input.repositoryUrl]) if (url) { try { new URL(url); } catch { return `Invalid URL: ${url}`; } } return null; }
function json(body: unknown,status=200) { return Response.json(body,{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":requestCache(status),"X-Content-Type-Options":"nosniff"}}); }
function requestCache(status:number){return status===200?"public, max-age=60, s-maxage=300":"no-store";}
