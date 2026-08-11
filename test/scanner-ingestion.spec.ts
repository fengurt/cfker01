import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";

const adminHeaders = () => ({ Authorization: `Bearer ${env.ADMIN_TOKEN}`, "Content-Type": "application/json" });

describe("versioned scanner ingestion", () => {
  beforeAll(async () => { await applyD1Migrations(env.MGMT_DB, env.TEST_MIGRATIONS ?? []); });

  it("enforces scoped keys, leases, idempotent batches, safe staling, and annotations", async () => {
    const ctx = createExecutionContext();
    const createdKey = await call("/api/admin/v1/service-keys", {
      method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: "local-test", scopes: ["jobs:poll", "jobs:claim", "ingest:write"], connectorIds: ["local-cpro01"], providers: ["local"], accounts: ["cpro01"] }),
    }, ctx);
    expect(createdKey.response.status).toBe(201);
    const key = createdKey.body.data.key as string;
    expect(key).toMatch(/^tais_/);
    expect(JSON.stringify(await env.MGMT_DB.prepare("SELECT * FROM scanner_service_keys").first())).not.toContain(key);
    const scannerHeaders = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

    const created = await call("/api/admin/v1/scans", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ sourceId: "local-cpro01", mode: "full" }) }, ctx);
    expect(created.response.status).toBe(202);
    const jobId = created.body.data[0].id as string;
    const repeated = await call("/api/admin/v1/scans", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ sourceId: "local-cpro01" }) }, ctx);
    expect(repeated.body.data[0]).toMatchObject({ id: jobId, created: false });

    const jobs = await call("/api/ingest/v1/jobs", { headers: scannerHeaders }, ctx);
    expect(jobs.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: jobId })]));
    const claimed = await call(`/api/ingest/v1/jobs/${jobId}/claim`, { method: "POST", headers: scannerHeaders, body: "{}" }, ctx);
    expect(claimed.response.status).toBe(200);
    const secondClaim = await call(`/api/ingest/v1/jobs/${jobId}/claim`, { method: "POST", headers: scannerHeaders, body: "{}" }, ctx);
    expect(secondClaim.response.status).toBe(409);

    const started = await call("/api/ingest/v1/runs", { method: "POST", headers: scannerHeaders, body: JSON.stringify({ jobId, schemaVersion: "asset-discovery-v1", fingerprint: "first" }) }, ctx);
    expect(started.response.status).toBe(201);
    const runId = started.body.data.id as string;
    const asset = { provider: "local", accountId: "cpro01", kind: "repository", externalId: "repo-one", name: "repo-one", status: "available", url: "https://github.com/example/repo-one", metadata: { headSha: "abc" } };
    const batchBody = JSON.stringify({ assets: [asset] });
    const batch = await call(`/api/ingest/v1/runs/${runId}/batches/0`, { method: "PUT", headers: scannerHeaders, body: batchBody }, ctx);
    expect(batch.response.status).toBe(201);
    expect(batch.body.data).toMatchObject({ newCount: 1, changedCount: 0, unchangedCount: 0 });
    const replay = await call(`/api/ingest/v1/runs/${runId}/batches/0`, { method: "PUT", headers: scannerHeaders, body: batchBody }, ctx);
    expect(replay.body.meta.idempotentReplay).toBe(true);
    const conflict = await call(`/api/ingest/v1/runs/${runId}/batches/0`, { method: "PUT", headers: scannerHeaders, body: JSON.stringify({ assets: [{ ...asset, name: "different" }] }) }, ctx);
    expect(conflict.response.status).toBe(409);
    const completed = await call(`/api/ingest/v1/runs/${runId}/complete`, { method: "POST", headers: scannerHeaders, body: JSON.stringify({ authoritative: true, errors: [] }) }, ctx);
    expect(completed.body.data).toMatchObject({ status: "completed", new_count: 1, changed_count: 0, unchanged_count: 0 });

    const assetRow = await env.MGMT_DB.prepare("SELECT id,status FROM discovered_assets WHERE provider='local' AND external_id='repo-one'").first<{ id: string; status: string }>();
    expect(assetRow?.status).toBe("available");
    const annotated = await call(`/api/admin/v1/resources/${assetRow!.id}`, { method: "PATCH", headers: adminHeaders(), body: JSON.stringify({ description: "Human description", tags: ["important"], pinned: true, visibility: "internal" }) }, ctx);
    expect(annotated.response.status).toBe(200);

    const partialJob = (await call("/api/admin/v1/scans", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ sourceId: "local-cpro01" }) }, ctx)).body.data[0].id as string;
    await call(`/api/ingest/v1/jobs/${partialJob}/claim`, { method: "POST", headers: scannerHeaders, body: "{}" }, ctx);
    const partialRun = (await call("/api/ingest/v1/runs", { method: "POST", headers: scannerHeaders, body: JSON.stringify({ jobId: partialJob, schemaVersion: "asset-discovery-v1", fingerprint: "partial" }) }, ctx)).body.data.id as string;
    const partial = await call(`/api/ingest/v1/runs/${partialRun}/complete`, { method: "POST", headers: scannerHeaders, body: JSON.stringify({ authoritative: true, errors: [{ code: "offline", message: "network unavailable" }] }) }, ctx);
    expect(partial.body.data.status).toBe("partial");
    expect((await env.MGMT_DB.prepare("SELECT status FROM discovered_assets WHERE id=?1").bind(assetRow!.id).first<{ status: string }>())?.status).toBe("available");

    const finalJob = (await call(`/api/admin/v1/scans/${partialJob}/retry`, { method: "POST", headers: adminHeaders(), body: "{}" }, ctx)).body.data.id as string;
    await call(`/api/ingest/v1/jobs/${finalJob}/claim`, { method: "POST", headers: scannerHeaders, body: "{}" }, ctx);
    const finalRun = (await call("/api/ingest/v1/runs", { method: "POST", headers: scannerHeaders, body: JSON.stringify({ jobId: finalJob, schemaVersion: "asset-discovery-v1", fingerprint: "empty-full" }) }, ctx)).body.data.id as string;
    await call(`/api/ingest/v1/runs/${finalRun}/complete`, { method: "POST", headers: scannerHeaders, body: JSON.stringify({ authoritative: true, errors: [] }) }, ctx);
    const stale = await env.MGMT_DB.prepare("SELECT status FROM discovered_assets WHERE id=?1").bind(assetRow!.id).first<{ status: string }>();
    expect(stale?.status).toBe("stale");
    const annotation = await env.MGMT_DB.prepare("SELECT description,tags,pinned FROM asset_annotations WHERE asset_id=?1").bind(assetRow!.id).first<{ description: string; tags: string; pinned: number }>();
    expect(annotation).toMatchObject({ description: "Human description", tags: '["important"]', pinned: 1 });

    const keyId = createdKey.body.data.id as string;
    const revoked = await call(`/api/admin/v1/service-keys/${keyId}`, { method: "DELETE", headers: adminHeaders() }, ctx);
    expect(revoked.response.status).toBe(204);
    const denied = await call("/api/ingest/v1/jobs", { headers: scannerHeaders }, ctx);
    expect(denied.response.status).toBe(401);
    await waitOnExecutionContext(ctx);
  });

  it("rejects invalid schema versions and cross-origin admin mutations", async () => {
    const ctx = createExecutionContext();
    const denied = await call("/api/admin/v1/scans", { method: "POST", headers: { ...adminHeaders(), Cookie: "tableai_admin=invalid", Origin: "https://evil.example" }, body: "{}" }, ctx);
    expect(denied.response.status).toBe(403);
    const unauthenticated = await call("/api/ingest/v1/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: "future-v99" }) }, ctx);
    expect(unauthenticated.response.status).toBe(401);
    const invalidCursor = await call("/api/admin/v1/resources?cursor=not-a-cursor", { headers: adminHeaders() }, ctx);
    expect(invalidCursor.response.status).toBe(400);
    expect(invalidCursor.body).toMatchObject({ error: { code: "invalid_cursor" } });
    await waitOnExecutionContext(ctx);
  });

  it("retains assets when provider relationships reference unknown D1 records", async () => {
    const ctx = createExecutionContext();
    const createdKey = await call("/api/admin/v1/service-keys", {
      method: "POST", headers: adminHeaders(), body: JSON.stringify({ name: `relationship-test-${crypto.randomUUID()}`, scopes: ["jobs:poll", "jobs:claim", "ingest:write"], connectorIds: ["local-cpro01"], providers: ["local"], accounts: ["cpro01"] }),
    }, ctx);
    const key = createdKey.body.data.key as string;
    const scannerHeaders = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const created = await call("/api/admin/v1/scans", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ sourceId: "local-cpro01", mode: "full" }) }, ctx);
    const jobId = created.body.data[0].id as string;
    await call(`/api/ingest/v1/jobs/${jobId}/claim`, { method: "POST", headers: scannerHeaders, body: "{}" }, ctx);
    const started = await call("/api/ingest/v1/runs", { method: "POST", headers: scannerHeaders, body: JSON.stringify({ jobId, schemaVersion: "asset-discovery-v1", fingerprint: crypto.randomUUID() }) }, ctx);
    const runId = started.body.data.id as string;
    const batch = await call(`/api/ingest/v1/runs/${runId}/batches/0`, {
      method: "PUT", headers: scannerHeaders, body: JSON.stringify({ assets: [{
        provider: "local", accountId: "cpro01", kind: "repository", externalId: `relationship-${crypto.randomUUID()}`, name: "relationship-fixture", status: "available",
        serverId: "provider-instance-that-is-not-a-d1-server", projectId: "project-that-is-not-in-d1", metadata: { headSha: "abc123" },
      }] }),
    }, ctx);
    expect(batch.response.status).toBe(201);
    const assetId = batch.body.data.runId ? (await env.MGMT_DB.prepare("SELECT id FROM discovered_assets WHERE name='relationship-fixture' ORDER BY created_at DESC LIMIT 1").first<{ id: string }>())?.id : null;
    expect(assetId).toBeTruthy();
    const stored = await env.MGMT_DB.prepare("SELECT server_id,project_id,metadata FROM discovered_assets WHERE id=?1").bind(assetId).first<{ server_id: string | null; project_id: string | null; metadata: string }>();
    expect(stored?.server_id).toBeNull();
    expect(stored?.project_id).toBeNull();
    expect(JSON.parse(stored?.metadata ?? "{}")).toMatchObject({ relationshipCandidates: expect.arrayContaining([
      expect.objectContaining({ type: "server", value: "provider-instance-that-is-not-a-d1-server" }),
      expect.objectContaining({ type: "project", value: "project-that-is-not-in-d1" }),
    ]) });
    await waitOnExecutionContext(ctx);
  });

  it("exposes repository audit and server status through the admin API", async () => {
    const ctx = createExecutionContext();
    const canonicalKey = `github.com/example/audit-${crypto.randomUUID().slice(0, 8)}`;
    const imported = await call("/admin/repository-reviews/snapshots", {
      method: "POST", headers: adminHeaders(), body: JSON.stringify({
        canonicalKey, githubOwner: "example", githubRepo: "audit", repositoryUrl: "https://github.com/example/audit", fingerprint: crypto.randomUUID(), dossier: "{\"identity\":{\"key\":\"safe\"}}",
        syncStatus: "synced", hygiene: { status: "pass", checks: { readme: "pass" } }, deploymentStatus: "not_checked", deploymentEvidence: [],
      }),
    }, ctx);
    expect(imported.response.status).toBe(200);
    const list = await call(`/api/admin/v1/repository-audit/repositories?q=${encodeURIComponent(canonicalKey)}&limit=5`, { headers: adminHeaders() }, ctx);
    expect(list.response.status).toBe(200);
    expect(list.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ canonical_key: canonicalKey, sync_status: "synced", hygiene: expect.objectContaining({ status: "pass" }) })]));
    const servers = await call("/api/admin/v1/server-status", { headers: adminHeaders() }, ctx);
    expect(servers.response.status).toBe(200);
    expect(Array.isArray(servers.body.data)).toBe(true);
    await waitOnExecutionContext(ctx);
  });
});

async function call(path: string, init: RequestInit, ctx: ExecutionContext): Promise<{ response: Response; body: any }> {
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), env, ctx);
  const body = response.status === 204 ? null : await response.clone().json().catch(() => null);
  return { response, body };
}
