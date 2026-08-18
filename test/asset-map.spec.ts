import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  createAssetMapVersion,
  ensurePeriodicAssetMapVersion,
  getAssetMapVersion,
} from "../src/lib/asset-map";

const adminHeaders = {
  Authorization: `Bearer ${env.ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

describe("versioned live asset map", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.MGMT_DB, env.TEST_MIGRATIONS ?? []);
  });

  it("connects local paths through repositories, projects, deployments, servers, and endpoints", async () => {
    const suffix = crypto.randomUUID().slice(0, 8),
      now = new Date().toISOString();
    const projectId = `map-project-${suffix}`,
      serverId = `map-server-${suffix}`,
      repositoryId = `map-repo-${suffix}`,
      deploymentId = `map-deploy-${suffix}`;
    await env.MGMT_DB.batch([
      env.MGMT_DB.prepare(
        `INSERT INTO catalog_projects(id,name,platform,source_kind,source_ref,status,visibility,discovered_at,updated_at) VALUES(?1,?2,'local-filesystem','repository',?3,'reviewed','private',?4,?4)`,
      ).bind(projectId, `Map Project ${suffix}`, `/workspace/${suffix}`, now),
      env.MGMT_DB.prepare(
        `INSERT INTO servers(id,name,provider,status,created_at,updated_at) VALUES(?1,?2,'test','healthy',?3,?3)`,
      ).bind(serverId, `Map Server ${suffix}`, now),
      env.MGMT_DB.prepare(
        `INSERT INTO deployments(id,project_id,server_id,environment,deployed_url,version,status,created_at,updated_at) VALUES(?1,?2,?3,'production',?4,'abc123','healthy',?5,?5)`,
      ).bind(
        deploymentId,
        projectId,
        serverId,
        `https://${suffix}.example.com`,
        now,
      ),
      env.MGMT_DB.prepare(
        `INSERT INTO repository_snapshots(id,project_id,canonical_key,github_owner,github_repo,repository_url,local_paths,head_sha,branch,fingerprint,dossier,dossier_bytes,last_scanned_at,created_at,updated_at,sync_status) VALUES(?1,?2,?3,'example',?4,?5,?6,'abc123','main',?7,'{}',2,?8,?8,?8,'synced')`,
      ).bind(
        repositoryId,
        projectId,
        `github.com/example/map-${suffix}`,
        `map-${suffix}`,
        `https://github.com/example/map-${suffix}`,
        JSON.stringify([`/Users/af/cpro01/map-${suffix}`]),
        `fingerprint-${suffix}`,
        now,
      ),
      env.MGMT_DB.prepare(
        `INSERT INTO discovered_assets(id,provider,account_id,kind,external_id,name,status,server_id,project_id,metadata,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?1,'test','default','runtime_service',?2,?2,'running',?3,?4,?5,?6,?6,?6,?6)`,
      ).bind(
        `map-service-${suffix}`,
        `service-${suffix}`,
        serverId,
        projectId,
        JSON.stringify({
          image: "service:latest",
          nested: { apiKey: "super-secret", safe: "kept" },
        }),
        now,
      ),
    ]);
    const ctx = createExecutionContext();
    const response = await call(
      "/api/admin/v1/asset-map",
      { headers: adminHeaders },
      ctx,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        nodes: Array<{ id: string; kind: string; label: string }>;
        edges: Array<{
          source: string;
          target: string;
          relationship: string;
          status: string;
          evidence: string[];
        }>;
      };
    };
    const local = body.data.nodes.find(
      (node) => node.kind === "local_path" && node.label === `map-${suffix}`,
    );
    const repository = body.data.nodes.find(
      (node) => node.id === `repository:github.com/example/map-${suffix}`,
    );
    expect(local).toBeTruthy();
    expect(repository).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("super-secret");
    expect(JSON.stringify(body)).toContain('"safe":"kept"');
    expect(body.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: local!.id,
          target: repository!.id,
          relationship: "syncs_to",
          status: "confirmed",
          evidence: expect.arrayContaining(["sync_status:synced"]),
        }),
        expect.objectContaining({
          source: repository!.id,
          target: `project:${projectId}`,
          relationship: "implements",
        }),
        expect.objectContaining({
          source: `project:${projectId}`,
          target: `deployment:${deploymentId}`,
          relationship: "deploys_as",
        }),
        expect.objectContaining({
          source: `deployment:${deploymentId}`,
          target: `server:${serverId}`,
          relationship: "runs_on",
        }),
      ]),
    );

    const annotation = await call(
      "/api/admin/v1/asset-map/annotations",
      {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({
          entityId: repository!.id,
          label: "Reviewed map repository",
          tags: ["reviewed"],
          notes: "Confirmed by test.",
        }),
      },
      ctx,
    );
    expect(annotation.status).toBe(200);
    const relation = await call(
      "/api/admin/v1/asset-map/edges",
      {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({
          source: repository!.id,
          target: `server:${serverId}`,
          relationship: "backs_up_to",
          status: "candidate",
          confidence: 0.6,
          evidence: ["test evidence"],
        }),
      },
      ctx,
    );
    expect(relation.status).toBe(200);
    const relationBody = (await relation.json()) as { data: { id: string } };
    const originalEdge = await env.MGMT_DB.prepare(
      `SELECT created_at FROM asset_map_manual_edges WHERE id=?1`,
    )
      .bind(relationBody.data.id)
      .first<{ created_at: string }>();

    const version = await call(
      "/api/admin/v1/asset-map/versions",
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ summary: "Test backup" }),
      },
      ctx,
    );
    expect(version.status).toBe(201);
    const versionBody = (await version.json()) as {
      data: { id: string; contentHash: string };
    };
    expect(versionBody.data.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const downloaded = await call(
      `/api/admin/v1/asset-map/versions/${versionBody.data.id}?download=1`,
      { headers: adminHeaders },
      ctx,
    );
    expect(downloaded.headers.get("Content-Disposition")).toContain(
      "asset-map-",
    );

    const deleted = await call(
      `/api/admin/v1/asset-map/edges/${relationBody.data.id}`,
      { method: "DELETE", headers: adminHeaders },
      ctx,
    );
    expect(deleted.status).toBe(204);
    const restored = await call(
      `/api/admin/v1/asset-map/versions/${versionBody.data.id}/restore`,
      { method: "POST", headers: adminHeaders, body: "{}" },
      ctx,
    );
    expect(restored.status).toBe(201);
    expect(
      await env.MGMT_DB.prepare(
        `SELECT COUNT(*) count,MIN(created_at) created_at FROM asset_map_manual_edges WHERE id=?1`,
      )
        .bind(relationBody.data.id)
        .first<{ count: number; created_at: string }>(),
    ).toMatchObject({ count: 1, created_at: originalEdge?.created_at });
    await waitOnExecutionContext(ctx);
  });

  it("creates a scheduled snapshot only after scanner facts change", async () => {
    await createAssetMapVersion(
      env,
      { type: "admin", id: "periodic-test" },
      "manual",
      "Periodic baseline",
      true,
    );
    const before = await env.MGMT_DB.prepare(
      `SELECT COUNT(*) count FROM asset_map_versions WHERE reason='scheduled'`,
    ).first<{ count: number }>();
    await ensurePeriodicAssetMapVersion(env);
    const unchanged = await env.MGMT_DB.prepare(
      `SELECT COUNT(*) count FROM asset_map_versions WHERE reason='scheduled'`,
    ).first<{ count: number }>();
    expect(unchanged?.count).toBe(Number(before?.count ?? 0));

    const suffix = crypto.randomUUID().slice(0, 8),
      now = new Date().toISOString();
    await env.MGMT_DB.prepare(
      `INSERT INTO discovered_assets(id,provider,account_id,kind,external_id,name,status,metadata,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?1,'test','default','worker',?1,?2,'active','{}',?3,?3,?3,?3)`,
    )
      .bind(`scheduled-change-${suffix}`, `Scheduled change ${suffix}`, now)
      .run();
    await ensurePeriodicAssetMapVersion(env);
    const changed = await env.MGMT_DB.prepare(
      `SELECT COUNT(*) count FROM asset_map_versions WHERE reason='scheduled'`,
    ).first<{ count: number }>();
    expect(changed?.count).toBe(Number(before?.count ?? 0) + 1);
  });

  it("chunks and reconstructs large snapshots without losing Unicode data", async () => {
    const suffix = crypto.randomUUID().slice(0, 8),
      now = new Date().toISOString(),
      longLabel = `大型资产-${suffix}-${"测 ".repeat(2_000)}`,
      statements = Array.from({ length: 180 }, (_, index) =>
        env.MGMT_DB.prepare(
          `INSERT INTO discovered_assets(id,provider,account_id,kind,external_id,name,status,metadata,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?1,'test','default','worker',?1,?2,'active','{}',?3,?3,?3,?3)`,
        ).bind(
          `large-map-${suffix}-${index}`,
          `${longLabel}-${index}`,
          now,
        ),
      );
    for (let index = 0; index < statements.length; index += 50)
      await env.MGMT_DB.batch(statements.slice(index, index + 50));

    const version = await createAssetMapVersion(
      env,
      { type: "admin", id: "large-map-test" },
      "manual",
      "Large map regression",
      true,
    );
    const chunks = await env.MGMT_DB.prepare(
      `SELECT COUNT(*) count,MAX(length(content)) max_length FROM asset_map_version_chunks WHERE version_id=?1`,
    )
      .bind(version.id)
      .first<{ count: number; max_length: number }>();
    expect(Number(chunks?.count)).toBeGreaterThan(1);
    expect(Number(chunks?.max_length)).toBeLessThanOrEqual(64 * 1024);

    const firstChunks = await env.MGMT_DB.prepare(
      `SELECT chunk_index,content FROM asset_map_version_chunks WHERE version_id=?1 ORDER BY chunk_index LIMIT 2`,
    )
      .bind(version.id)
      .all<{ chunk_index: number; content: string }>();
    const first = firstChunks.results[0]!,
      second = firstChunks.results[1]!,
      combined = first.content + second.content,
      whitespaceBoundary = combined.lastIndexOf(" ", first.content.length);
    expect(whitespaceBoundary).toBeGreaterThan(0);
    await env.MGMT_DB.batch([
      env.MGMT_DB.prepare(
        `UPDATE asset_map_version_chunks SET content=?1 WHERE version_id=?2 AND chunk_index=0`,
      ).bind(combined.slice(0, whitespaceBoundary + 1), version.id),
      env.MGMT_DB.prepare(
        `UPDATE asset_map_version_chunks SET content=?1 WHERE version_id=?2 AND chunk_index=1`,
      ).bind(combined.slice(whitespaceBoundary + 1), version.id),
    ]);

    const restored = await getAssetMapVersion(env, String(version.id));
    const snapshot = restored?.snapshot as {
      nodes: Array<{ id: string; label: string }>;
    };
    expect(
      snapshot.nodes.find(
        (node) => node.id === `asset:large-map-${suffix}-179`,
      )
        ?.label,
    ).toBe(`${longLabel}-179`);
  });

  it("exposes scoped MCP read and write interfaces", async () => {
    const ctx = createExecutionContext();
    const keyResponse = await call(
      "/admin/keys",
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          name: "asset-map-agent-test",
          scopes: ["read", "asset-map:read", "asset-map:write"],
        }),
      },
      ctx,
    );
    const key = ((await keyResponse.json()) as { key: string }).key;
    const tools = await call(
      "/mcp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": key },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      ctx,
    );
    expect(JSON.stringify(await tools.json())).toContain("asset_map.annotate");
    const read = await call(
      "/mcp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": key },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "resources/read",
          params: { uri: "ops://asset-map/snapshot" },
        }),
      },
      ctx,
    );
    expect(read.status).toBe(200);
    expect(JSON.stringify(await read.json())).toContain("schemaVersion");

    const genericKeyResponse = await call(
      "/admin/keys",
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          name: "asset-map-generic-read-test",
          scopes: ["read"],
        }),
      },
      ctx,
    );
    const genericKey = ((await genericKeyResponse.json()) as { key: string })
      .key;
    const malformedRead = await call(
      "/mcp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": genericKey,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "resources/read",
          params: { uri: ["ops://asset-map/snapshot"] },
        }),
      },
      ctx,
    );
    expect(malformedRead.status).toBe(400);
    expect(JSON.stringify(await malformedRead.json())).not.toContain(
      "schemaVersion",
    );
    await waitOnExecutionContext(ctx);
  });
});

function call(
  path: string,
  init: RequestInit,
  ctx: ExecutionContext,
): Promise<Response> {
  return worker.fetch(new Request(`http://example.com${path}`, init), env, ctx);
}
