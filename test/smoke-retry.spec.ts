import { describe, expect, it, vi } from "vitest";
import { fetchWithNetworkRetry } from "../scripts/lib/smoke-fetch.mjs";

describe("deployment smoke network retry", () => {
  it("recovers from a bounded transient connection reset", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce(response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithNetworkRetry(fetchImpl, "https://example.test/health", {}, { attempts: 3, delayMs: 10, sleep }),
    ).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("fails after the configured network retry budget", async () => {
    const failure = new Error("read ECONNRESET");
    const fetchImpl = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithNetworkRetry(fetchImpl, "https://example.test/health", {}, { attempts: 3, delayMs: 10, sleep }),
    ).rejects.toBe(failure);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("returns HTTP failures without retrying them", async () => {
    const response = new Response("unavailable", { status: 503 });
    const fetchImpl = vi.fn().mockResolvedValue(response);

    await expect(
      fetchWithNetworkRetry(fetchImpl, "https://example.test/health"),
    ).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
