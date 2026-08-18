import { describe, expect, it } from "vitest";
import workspace from "../src/components/AdminWorkspace.astro?raw";
import adminScript from "../public/admin.js?raw";
import adminServersRoute from "../src/routes/admin-servers.ts?raw";
import adminMapScript from "../public/admin-map.js?raw";

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
    expect(adminScript).toContain(
      "if (error.status === 401) return showLogin()",
    );
    expect(adminScript).toContain('error.code === "reauthentication_required"');
  });

  it("cache-busts every admin asset with one shell release key", () => {
    expect(workspace).toContain(
      'const adminAssetVersion = "20260819-asset-map-snapshot-1"',
    );
    for (const asset of [
      "admin.css",
      "admin-visibility.css",
      "admin-compact.css",
      "admin-ops-v2.css",
      "admin-scanner.css",
      "admin-tasks.css",
      "admin-interactions.css",
      "admin-map.css",
      "admin.js",
      "admin-tasks.js",
      "admin-infrastructure.js",
      "admin-interactions.js",
      "admin-map.js",
    ])
      expect(workspace).toContain(`${asset}?v=\${adminAssetVersion}`);
  });

  it("uses one integrated server board without the duplicate cost grid", () => {
    expect(workspace).toContain('id="fleet-server-board"');
    expect(workspace).not.toContain('id="server-cost-panel"');
    expect(adminScript).not.toContain("function renderServerCostPanel");
    expect(adminScript).toContain("fleet-record-advice");
  });

  it("labels retained runtime values as stale instead of calling them insufficient", () => {
    expect(adminScript).toContain(
      'const stalePrefix = locale === "zh-CN" ? "旧数据："',
    );
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

  it("renders official subscription and documentation links for every API connector", () => {
    expect(adminScript).toContain("provider.officialLinks?.subscriptionUrl");
    expect(adminScript).toContain("provider.officialLinks?.documentationUrl");
    expect(adminScript).toContain('t("subscribeOfficial")');
    expect(adminScript).toContain('t("officialDocs")');
    expect(adminScript).toContain("provider.modelCatalog || []");
    expect(adminScript).toContain("provider.validity?.credential?.expiresAt");
  });

  it("renders one project-attribution row with measured resource semantics", () => {
    expect(adminScript).toContain("server.runtime_projects || []");
    expect(adminScript).toContain("项目资源归因");
    expect(adminScript).toContain("project.cpuHostRatio");
    expect(adminScript).toContain("project.memoryHostRatio");
    expect(adminScript).toContain("project.writableDiskRatio");
    expect(adminScript).toContain("project.networkRxBytes");
    expect(adminScript).toContain("project.blockReadBytes");
    expect(adminScript).toContain("project.lastCodeUpdateAt");
    expect(adminScript).toContain("project.lastSampleAt");
    expect(adminScript).toContain("空间仅含容器可写层");
    expect(adminScript).toContain('document.createElement("details")');
    expect(adminScript).toContain("fleet-project-usage-summary");
  });

  it("filters the canonical server board without refetching fleet data", () => {
    expect(workspace).toContain('id="fleet-region-filter"');
    expect(workspace).toContain('id="fleet-server-sort"');
    expect(workspace).toContain('id="fleet-filter-result"');
    expect(adminScript).toContain("serverAvailableDiskBytes");
    expect(adminScript).toContain('"containers-desc"');
    expect(adminScript).toContain('"disk-free-desc"');
    expect(adminScript).toContain("filteredFleetServers");
    expect(adminServersRoute).toContain('["cvm","lighthouse"].includes');
    expect(adminServersRoute).toContain(
      "region:server.region??cloudAsset?.region??null",
    );
  });

  it("ships a lazy, editable asset map with version history", () => {
    expect(workspace).toContain('data-view="map"');
    expect(workspace).toContain('id="asset-map-canvas"');
    expect(workspace).toContain('id="asset-map-inspector"');
    expect(workspace).toContain('id="asset-map-history"');
    expect(adminMapScript).toContain("window.loadAssetMap = loadAssetMap");
    expect(adminMapScript).toContain("/api/admin/v1/asset-map/annotations");
    expect(adminMapScript).toContain("/api/admin/v1/asset-map/edges");
    expect(adminMapScript).toContain("/api/admin/v1/asset-map/versions");
    expect(adminMapScript).toContain("const button = event.currentTarget");
    expect(adminMapScript).not.toContain("event.currentTarget.disabled = false");
  });

  it("renders real asset relationships as a bounded interactive topology", () => {
    expect(workspace).toContain('data-map-mode="topology"');
    expect(workspace).toContain('data-map-mode="list"');
    expect(adminMapScript).toContain("function renderTopology");
    expect(adminMapScript).toContain("function drawTopologyEdges");
    expect(adminMapScript).toMatch(
      /createElementNS\(\s*"http:\/\/www\.w3\.org\/2000\/svg",\s*"path"/,
    );
    expect(adminMapScript).toContain("topologyNeighborhood");
    expect(adminMapScript).toContain("TOPOLOGY_NODE_LIMIT");
    expect(adminMapScript).toContain("data-topology-node-id");
  });

  it("keeps topology focus and inspector accessibility consistent with filters", () => {
    expect(adminMapScript).toContain(
      'state.mode === "list"',
    );
    expect(adminMapScript).toContain("!nodeIds.has(state.selected)");
    expect(adminMapScript).toContain(
      "if (selectedIds.has(edge.target) || add(edge.target))",
    );
    expect(adminMapScript).toContain(
      "if (selectedIds.has(edge.source) || add(edge.source))",
    );
    expect(adminMapScript).toContain('id: "asset-map-inspector-title"');
  });
});
