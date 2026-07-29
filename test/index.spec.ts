import { env, createExecutionContext, waitOnExecutionContext, applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";

describe("cfker01 worker", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.MGMT_DB, env.TEST_MIGRATIONS ?? []);
  });
  it("returns service index at /", async () => {
    const request = new Request("http://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { service: string; routes: string[] };
    expect(body.service).toBe("cfker01");
    expect(body.routes).toContain("/v1/status");
    expect(body.routes).toContain("/mcp");
  });

  it("returns health check", async () => {
    const request = new Request("http://example.com/health");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects /v1/status without an API key", async () => {
    const request = new Request("http://example.com/v1/status");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
  });

  it("exposes the MCP server card at /.well-known/mcp", async () => {
    const request = new Request("http://example.com/.well-known/mcp");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; capabilities: unknown };
    expect(body.name).toBe("cfker01");
    expect(body.capabilities).toBeTruthy();
  });

  it("stages validated skills through a narrowly scoped MCP write key and records PR publication", async () => {
    const ctx = createExecutionContext();
    const keyResponse = await worker.fetch(new Request("http://example.com/admin/keys", {
      method: "POST", headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "mcp-skill-test", scopes: ["read", "skills:write"] }),
    }), env, ctx);
    expect(keyResponse.status).toBe(201);
    const writeKey = ((await keyResponse.json()) as { key: string }).key;
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await worker.fetch(new Request("http://example.com/mcp", { method: "POST", headers: { "Content-Type": "application/json", "X-Api-Key": writeKey }, body: JSON.stringify({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: args } }) }), env, ctx);
      return { response, body: await response.json() as { result?: { content?: Array<{ text: string }> }; error?: { message: string } } };
    };
    const content = "---\nname: safe-skill\ndescription: Safely stage and publish a reusable agent skill through Ksamint.\n---\n\n# Safe skill\n\nUse this workflow for safe publication.\n";
    const staged = await call("skills.stage", { slug: "safe-skill", title: "Safe skill", description: "Safely stage and publish a reusable agent skill through Ksamint.", content });
    expect(staged.response.status).toBe(200);
    const draft = JSON.parse(staged.body.result!.content![0].text) as { id: string; status: string; validation: { valid: boolean } };
    expect(draft).toMatchObject({ status: "validated", validation: { valid: true } });
    const requested = await call("skills.request_publish", { draftId: draft.id });
    expect(JSON.parse(requested.body.result!.content![0].text)).toMatchObject({ status: "publish_requested" });
    const recorded = await call("skills.record_publish", { draftId: draft.id, branch: `mcp/skill-safe-skill-${draft.id.slice(0, 8)}`, pullRequestUrl: "https://github.com/fengurt/cfker01/pull/123", commitSha: "abc123" });
    expect(JSON.parse(recorded.body.result!.content![0].text)).toMatchObject({ status: "published" });
    const rejected = await call("skills.stage", { slug: "unsafe-skill", title: "Unsafe skill", description: "This intentionally verifies credential rejection in staged skill content.", content: "---\nname: unsafe-skill\ndescription: This intentionally verifies credential rejection in staged skill content.\n---\n\ncfk_abcdef0123456789abcdef0123456789\n" });
    expect(JSON.parse(rejected.body.result!.content![0].text)).toMatchObject({ status: "rejected", validation: { valid: false } });
    await waitOnExecutionContext(ctx);
  });

  it("returns the status HTML page", async () => {
    const request = new Request("http://example.com/status");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("lists and filters the public catalog without authentication", async () => {
    const request = new Request("http://example.com/api/v1/catalog?type=benchmark&per_page=3");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage");
    const body = (await response.json()) as { data: Array<{ types: string[] }>; meta: { total: number; perPage: number } };
    expect(body.data).toHaveLength(3);
    expect(body.data.every((entry) => entry.types.includes("benchmark"))).toBe(true);
    expect(body.meta.total).toBeGreaterThan(3);
  });

  it("returns catalog details and a stable not-found envelope", async () => {
    const ctx = createExecutionContext();
    const found = await worker.fetch(new Request("http://example.com/api/v1/catalog/swe-bench"), env, ctx);
    expect(found.status).toBe(200);
    const body = (await found.json()) as { data: { id: string }; meta: { version: string } };
    expect(body.data.id).toBe("swe-bench");
    expect(body.meta.version).toBe("v1");
    const missing = await worker.fetch(new Request("http://example.com/api/v1/catalog/missing"), env, ctx);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
    await waitOnExecutionContext(ctx);
  });

  it("validates catalog query parameters", async () => {
    const request = new Request("http://example.com/api/v1/catalog?type=unknown");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_query" } });
  });

  it("lists local and external article records", async () => {
    const request = new Request("http://example.com/api/v1/articles?kind=external");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ kind: string; canonicalUrl: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((article) => article.kind === "external" && article.canonicalUrl)).toBe(true);
  });

  it("exposes the scanned project inventory through the public API", async () => {
    const request = new Request("http://example.com/api/v1/projects?type=repository&per_page=5");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ sourceRef: string; resourceTypes: string[] }>; meta: { total: number } };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((item) => !item.sourceRef.startsWith("/Users/") && item.resourceTypes.includes("repository"))).toBe(true);
    expect(body.meta.total).toBeGreaterThan(0);
  });

  it("bootstraps a local PBKDF2 admin on first login and creates a session", async () => {
    const ctx = createExecutionContext();
    const credentials = { phone: "13800138000", password: "test-password-123" };
    const login = await worker.fetch(new Request("http://127.0.0.1/admin/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" }, body: JSON.stringify(credentials) }), env, ctx);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain(String(env.ADMIN_TOKEN));
    const session = await worker.fetch(new Request("http://127.0.0.1/admin/session", { headers: { Cookie: cookie!.split(";")[0] } }), env, ctx);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ ok: true, role: "system_admin" });
    const wrong = await worker.fetch(new Request("http://127.0.0.1/admin/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" }, body: JSON.stringify({ ...credentials, password: "incorrect-password" }) }), env, ctx);
    expect(wrong.status).toBe(401);
    const crossOrigin = await worker.fetch(new Request("http://127.0.0.1/admin/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(credentials) }), env, ctx);
    expect(crossOrigin.status).toBe(403);
    const proxiedLogin = await worker.fetch(new Request("http://g.ksamint.cn/admin/login", { method: "POST", headers: { "Content-Type": "application/json", Host: "g.ksamint.cn", Origin: "https://g.ksamint.cn", "X-Forwarded-Proto": "https" }, body: JSON.stringify(credentials) }), env, ctx);
    expect(proxiedLogin.status).toBe(200);
    expect(proxiedLogin.headers.get("set-cookie")).toContain("Secure");
    await waitOnExecutionContext(ctx);
  });

  it("protects, imports, filters, and summarizes discovered assets", async () => {
    const ctx=createExecutionContext();
    const denied=await worker.fetch(new Request("http://example.com/admin/assets"),env,ctx);
    expect(denied.status).toBe(401);
    const headers={Authorization:`Bearer ${env.ADMIN_TOKEN}`,"Content-Type":"application/json"};
    const imported=await worker.fetch(new Request("http://example.com/admin/assets/import",{method:"POST",headers,body:JSON.stringify({provider:"tencent",accountId:"test-account",assets:[{kind:"dns_domain",externalId:"example.com",name:"example.com",status:"enable",url:"https://example.com",metadata:{recordCount:2,expiresAt:"2030-01-01T00:00:00.000Z"}},{kind:"cos_bucket",externalId:"example-bucket",name:"example-bucket",status:"available",region:"ap-guangzhou",metadata:{}}]})}),env,ctx);
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ok:true,imported:2});
    const listed=await worker.fetch(new Request("http://example.com/admin/assets?provider=tencent&kind=dns_domain",{headers}),env,ctx);
    expect(listed.status).toBe(200);
    const body=await listed.json() as {data:Array<{name:string;metadata:{recordCount:number}}>;meta:{total:number}};
    expect(body.meta.total).toBe(1);expect(body.data[0]).toMatchObject({name:"example.com",metadata:{recordCount:2}});
    const expiring=await worker.fetch(new Request("http://example.com/admin/assets?expiring_days=3650&sort=expires",{headers}),env,ctx);
    expect(expiring.status).toBe(200);expect((await expiring.json() as {data:Array<{name:string}>}).data[0]?.name).toBe("example.com");
    const summary=await worker.fetch(new Request("http://example.com/admin/assets/summary",{headers}),env,ctx);
    expect(summary.status).toBe(200);expect(await summary.json()).toMatchObject({data:{groups:expect.any(Array),expiring:expect.arrayContaining([expect.objectContaining({name:"example.com"})])}});
    await waitOnExecutionContext(ctx);
  });

  it("keeps uncertain Docker assets visible without inventing project links", async () => {
    const ctx=createExecutionContext(),headers={Authorization:`Bearer ${env.ADMIN_TOKEN}`,"Content-Type":"application/json"};
    await env.MGMT_DB.prepare("INSERT OR IGNORE INTO servers(id,name,provider,status,created_at,updated_at) VALUES('server-test','test-server','docker','online',?1,?1)").bind(new Date().toISOString()).run();
    const response=await worker.fetch(new Request("http://example.com/admin/assets/import",{method:"POST",headers,body:JSON.stringify({provider:"docker",accountId:"server-test",assets:[{kind:"compose_project",externalId:"server-test:unknown-app",name:"unknown-app",status:"running",serverId:"server-test",metadata:{containerCount:2,workingDir:"/opt/unknown-app"}},{kind:"container",externalId:"container-1",name:"unknown-app-web-1",status:"healthy",serverId:"server-test",parentExternalId:"server-test:unknown-app",metadata:{image:"unknown:latest"}}]})}),env,ctx);
    expect(response.status).toBe(200);
    const runtime=await worker.fetch(new Request("http://example.com/admin/servers/server-test/runtime",{headers}),env,ctx),body=await runtime.json() as {data:Array<{name:string;project_id:null}>};
    expect(runtime.status).toBe(200);expect(body.data.map(item=>item.name)).toEqual(expect.arrayContaining(["unknown-app","unknown-app-web-1"]));expect(body.data.every(item=>item.project_id==null)).toBe(true);
    await waitOnExecutionContext(ctx);
  });

  it("accepts monitor results only with the internal token and debounces outages", async () => {
    const now=new Date().toISOString();
    await env.MGMT_DB.prepare("INSERT OR REPLACE INTO servers(id,name,provider,public_url,status,created_at,updated_at) VALUES('monitor-server','monitor-server','tencent','https://example.com','unknown',?1,?1)").bind(now).run();
    const ctx=createExecutionContext(),adminHeaders={Authorization:`Bearer ${env.ADMIN_TOKEN}`},monitorHeaders={Authorization:`Bearer ${env.INTERNAL_MONITOR_TOKEN}`,"Content-Type":"application/json"};
    const targets=await worker.fetch(new Request("http://example.com/admin/monitor/targets",{headers:monitorHeaders}),env,ctx);
    expect(targets.status).toBe(200);expect(await targets.json()).toMatchObject({data:expect.arrayContaining([expect.objectContaining({entityId:"monitor-server"})])});
    const denied=await worker.fetch(new Request("http://example.com/admin/monitor/results",{method:"POST",headers:{...adminHeaders,"Content-Type":"application/json"},body:JSON.stringify({results:[]})}),env,ctx);
    expect(denied.status).toBe(403);
    for(let attempt=1;attempt<=3;attempt++){const response=await worker.fetch(new Request("http://example.com/admin/monitor/results",{method:"POST",headers:monitorHeaders,body:JSON.stringify({runId:`monitor-run-${attempt}`,results:[{entityType:"server",entityId:"monitor-server",status:"down",checkedAt:new Date(Date.now()+attempt*1000).toISOString(),errorCode:"timeout",latencyMs:5000}]})}),env,ctx);expect(response.status).toBe(200);}
    const server=await env.MGMT_DB.prepare("SELECT health_status,consecutive_failures FROM servers WHERE id='monitor-server'").first<{health_status:string;consecutive_failures:number}>();
    expect(server).toMatchObject({health_status:"down",consecutive_failures:3});
    const summary=await worker.fetch(new Request("http://example.com/admin/monitor/summary",{headers:adminHeaders}),env,ctx);
    expect(summary.status).toBe(200);expect(await summary.json()).toMatchObject({data:{openEvents:1}});
    await waitOnExecutionContext(ctx);
  });
});
