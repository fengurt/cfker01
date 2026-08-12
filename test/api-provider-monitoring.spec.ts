import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";

const adminHeaders = {
  Authorization: `Bearer ${env.ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

describe("API provider monitoring", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.MGMT_DB, env.TEST_MIGRATIONS ?? []);
  });

  it("lists the six explicit provider connectors without exposing credentials", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("http://example.com/api/admin/v1/api-providers", {
        headers: adminHeaders,
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as { data: Array<{ id: string; checks: Record<string, string>; officialLinks: { subscriptionUrl: string; documentationUrl: string } }> };
    expect(body.data.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "doubao-ark",
        "minimax-api",
        "minimax-coding-plan",
        "openai",
        "perplexity",
        "moonshot",
        "gemini",
      ]),
    );
    expect(body.data.every((item) => ["auth", "models", "quota", "inference"].every((kind) => kind in item.checks))).toBe(true);
    expect(body.data.every((item) => item.officialLinks.subscriptionUrl.startsWith("https://") && item.officialLinks.documentationUrl.startsWith("https://"))).toBe(true);
    expect(body.data.find((item) => item.id === "minimax-coding-plan")?.officialLinks.subscriptionUrl).toBe("https://platform.minimaxi.com/console/plan");
    expect(body.data.find((item) => item.id === "openai")?.officialLinks.documentationUrl).toBe("https://developers.openai.com/api/docs/quickstart");
    expect(text).not.toMatch(/api.?key|password|secret/i);
  });

  it("accepts idempotent, sanitized probe observations with a scoped key", async () => {
    const createCtx = createExecutionContext();
    const created = await worker.fetch(
      new Request("http://example.com/api/admin/v1/service-keys", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          name: "api-monitor-test",
          scopes: ["api-probes:write"],
          providers: ["api-provider"],
        }),
      }),
      env,
      createCtx,
    );
    expect(created.status).toBe(201);
    const key = ((await created.json()) as { data: { key: string } }).data.key;
    await waitOnExecutionContext(createCtx);

    const payload = {
      runId: "run-minimax-001",
      connectorId: "minimax-api",
      credentialStatus: "configured",
      overallStatus: "healthy",
      observedAt: "2026-08-12T00:00:00.000Z",
      checks: [
        {
          kind: "models",
          status: "healthy",
          httpStatus: 200,
          latencyMs: 42,
          model: "MiniMax-M2.5",
          modelCount: 3,
        },
      ],
    };
    const ingest = async () => {
      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new Request("http://example.com/api/ingest/v1/api-provider-probes", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return response;
    };

    expect((await ingest()).status).toBe(201);
    const replay = await ingest();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ meta: { idempotentReplay: true } });

    const readCtx = createExecutionContext();
    const read = await worker.fetch(
      new Request("http://example.com/api/admin/v1/api-providers/minimax-api", {
        headers: adminHeaders,
      }),
      env,
      readCtx,
    );
    await waitOnExecutionContext(readCtx);
    expect(read.status).toBe(200);
    const text = await read.text();
    expect(text).toContain("MiniMax-M2.5");
    expect(text).not.toContain(key);
  });

  it("rejects provider probe payloads that contain secret-shaped fields", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("http://example.com/api/ingest/v1/api-provider-probes", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          runId: "unsafe-run",
          connectorId: "openai",
          apiKey: "must-not-be-stored",
          checks: [],
        }),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect([400, 401]).toContain(response.status);
    expect(await response.text()).not.toContain("must-not-be-stored");
  });

  it("reports the recorded inference failure instead of treating recency as health", async () => {
    const createCtx = createExecutionContext();
    const created = await worker.fetch(
      new Request("http://example.com/api/admin/v1/service-keys", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ name: "failed-inference-test", scopes: ["api-probes:write"], providers: ["api-provider"] }),
      }),
      env,
      createCtx,
    );
    const key = ((await created.json()) as { data: { key: string } }).data.key;
    await waitOnExecutionContext(createCtx);

    const probeCtx = createExecutionContext();
    const probe = await worker.fetch(
      new Request("http://example.com/api/ingest/v1/api-provider-probes", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "openai-failed-inference-001",
          connectorId: "openai",
          mode: "inference",
          credentialStatus: "configured",
          overallStatus: "down",
          observedAt: new Date().toISOString(),
          checks: [{ kind: "inference", status: "down", latencyMs: 500, model: "gpt-5.5", errorCode: "network_error" }],
        }),
      }),
      env,
      probeCtx,
    );
    expect(probe.status).toBe(201);
    await waitOnExecutionContext(probeCtx);

    const readCtx = createExecutionContext();
    const read = await worker.fetch(new Request("http://example.com/api/admin/v1/api-providers", { headers: adminHeaders }), env, readCtx);
    await waitOnExecutionContext(readCtx);
    const body = (await read.json()) as { data: Array<{ id: string; checks: Record<string, string>; inferenceStatus: string }> };
    const openai = body.data.find((item) => item.id === "openai");
    expect(openai?.checks.inference).toBe("down");
    expect(openai?.inferenceStatus).toBe("down");
  });
});
