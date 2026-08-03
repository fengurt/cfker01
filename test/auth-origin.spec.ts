import { describe, expect, it } from "vitest";
import { hasAdminRole, isValidRequestOrigin } from "../src/lib/auth";

describe("request origin validation", () => {
  it("orders operator roles without granting viewer mutation authority", () => {
    expect(hasAdminRole("system_admin", "operator")).toBe(true);
    expect(hasAdminRole("operator", "operator")).toBe(true);
    expect(hasAdminRole("editor", "operator")).toBe(false);
    expect(hasAdminRole("viewer", "viewer")).toBe(true);
  });
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

  it("accepts an explicitly configured public origin when proxy headers are unavailable", () => {
    const request = new Request("http://catalog:8787/api/admin/v1/tasks", {
      method: "POST",
      headers: { Origin: "https://g.ksamint.cn" },
    });

    expect(isValidRequestOrigin(request, "https://g.ksamint.cn")).toBe(true);
  });

  it("still rejects a foreign origin when a public origin is configured", () => {
    const request = new Request("http://catalog:8787/api/admin/v1/tasks", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });

    expect(isValidRequestOrigin(request, "https://g.ksamint.cn")).toBe(false);
  });

  it("fails closed when the configured public origin is malformed", () => {
    const request = new Request("http://catalog:8787/api/admin/v1/tasks", {
      method: "POST",
      headers: { Origin: "https://g.ksamint.cn" },
    });

    expect(isValidRequestOrigin(request, "not a URL")).toBe(false);
  });
});
