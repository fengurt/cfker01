import { describe, expect, it } from "vitest";
import workspace from "../src/components/AdminWorkspace.astro?raw";
import adminScript from "../public/admin.js?raw";

describe("admin fleet UI release contract", () => {
  it("keeps authentication neutral until the session check completes", () => {
    expect(workspace).toContain('data-auth-state="pending"');
    expect(workspace).toContain('id="auth-pending"');
    expect(workspace).toContain('id="auth-retry"');
    expect(workspace).toContain('id="reauth-dialog"');
    expect(workspace).toContain('id="login-panel" hidden');
    expect(adminScript).toContain('setAuthState("pending")');
    expect(adminScript).toContain('setAuthState("authenticated")');
    expect(adminScript).toContain('setAuthState("anonymous")');
    expect(adminScript).toContain('if (error.status === 401) return showLogin()');
    expect(adminScript).toContain('error.code === "reauthentication_required"');
  });

  it("cache-busts the fleet assets with the same release key", () => {
    expect(workspace).toContain("/admin-ops-v2.css?v=20260812-api-1");
    expect(workspace).toContain("/admin.js?v=20260812-api-1");
  });

  it("uses one integrated server board without the duplicate cost grid", () => {
    expect(workspace).toContain('id="fleet-server-board"');
    expect(workspace).not.toContain('id="server-cost-panel"');
    expect(adminScript).not.toContain("function renderServerCostPanel");
    expect(adminScript).toContain("fleet-record-advice");
  });

  it("labels retained runtime values as stale instead of calling them insufficient", () => {
    expect(adminScript).toContain('const stalePrefix = locale === "zh-CN" ? "旧数据："');
    expect(adminScript).not.toContain('label: locale === "zh-CN" ? "数据不足"');
  });

  it("uses mutually exclusive resource views instead of duplicate infrastructure panels", () => {
    expect(workspace).toContain('id="resource-view-tabs"');
    expect(workspace).toContain('data-resource-view="servers"');
    expect(workspace).toContain('data-resource-view="api"');
    expect(workspace).toContain('data-resource-view="endpoints"');
    expect(workspace).toContain('data-resource-view="storage"');
    expect(workspace).not.toContain("infrastructure-resource-panel");
  });
});
