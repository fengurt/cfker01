import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("cfker01 worker", () => {
  it("returns service index at /", async () => {
    const request = new Request("http://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { service: string };
    expect(body.service).toBe("cfker01");
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
});
