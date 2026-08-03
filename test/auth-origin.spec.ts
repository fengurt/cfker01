import { describe, expect, it } from "vitest";
import { isValidRequestOrigin } from "../src/lib/auth";

describe("request origin validation", () => {
  it("accepts the public origin forwarded by the trusted reverse proxy", () => {
    const request = new Request("http://catalog:8787/api/admin/v1/tasks", {
      method: "POST",
      headers: {
        Host: "catalog:8787",
        Origin: "https://g.ksamint.cn",
        "X-Forwarded-Host": "g.ksamint.cn",
        "X-Forwarded-Proto": "https",
      },
    });

    expect(isValidRequestOrigin(request)).toBe(true);
  });

  it("rejects an origin that does not match the forwarded public host", () => {
    const request = new Request("http://catalog:8787/api/admin/v1/tasks", {
      method: "POST",
      headers: {
        Host: "catalog:8787",
        Origin: "https://attacker.example",
        "X-Forwarded-Host": "g.ksamint.cn",
        "X-Forwarded-Proto": "https",
      },
    });

    expect(isValidRequestOrigin(request)).toBe(false);
  });

  it("normalizes default ports before comparing origins", () => {
    const request = new Request("http://catalog:8787/admin/session", {
      method: "POST",
      headers: {
        Origin: "https://g.ksamint.cn",
        "X-Forwarded-Host": "g.ksamint.cn:443",
        "X-Forwarded-Proto": "https",
      },
    });

    expect(isValidRequestOrigin(request)).toBe(true);
  });
});
