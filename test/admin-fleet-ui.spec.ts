import { describe, expect, it } from "vitest";
import workspace from "../src/components/AdminWorkspace.astro?raw";
import adminScript from "../public/admin.js?raw";

describe("admin fleet UI release contract", () => {
  it("cache-busts the fleet assets with the same release key", () => {
    expect(workspace).toContain("/admin-ops-v2.css?v=20260811-fleet-3");
    expect(workspace).toContain("/admin.js?v=20260811-fleet-3");
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
});
