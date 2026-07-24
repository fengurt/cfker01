(() => {
  const endpoint = (path) => fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  });

  const list = (id) => document.getElementById(id);
  const state = { loaded: false, loading: false, serverViewRequested: false, snapshotLoaded: false };

  async function allAssets(query) {
    const assets = [];
    let page = 1;
    while (true) {
      const response = await endpoint(`/admin/assets?${query}&per_page=100&page=${page}`);
      assets.push(...(response.data || []));
      if (page >= Number(response.meta?.pages || 1)) return assets;
      page += 1;
    }
  }

  function empty(target, message) {
    target.replaceChildren();
    const node = document.createElement("p");
    node.className = "infrastructure-asset-empty";
    node.textContent = message;
    target.append(node);
  }

  function row(asset, detail, fallbackUrl = null) {
    const item = document.createElement("article");
    item.className = "infrastructure-asset-row";
    const target = asset.url || fallbackUrl;
    const name = target ? document.createElement("a") : document.createElement("strong");
    name.textContent = asset.name;
    if (target) {
      name.href = target;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
    }
    const meta = document.createElement("small");
    meta.textContent = detail;
    item.append(name, meta);
    return item;
  }

  function render(target, assets, makeDetail, fallbackUrl) {
    target.replaceChildren();
    if (!assets.length) return empty(target, "暂无已同步资源");
    const fragment = document.createDocumentFragment();
    for (const asset of assets) fragment.append(row(asset, makeDetail(asset), fallbackUrl?.(asset)));
    target.append(fragment);
  }

  async function loadInfrastructureResources() {
    const dashboard = document.getElementById("dashboard");
    const pages = list("infrastructure-pages-assets");
    const cos = list("infrastructure-cos-assets");
    const dns = list("infrastructure-dns-assets");
    if (!dashboard || dashboard.hidden || state.loaded || state.loading || !pages || !cos || !dns) return;
    state.loading = true;
    empty(pages, "正在检查 Pages URL…");
    empty(cos, "正在读取 COS 资源…");
    empty(dns, "正在读取 URL/DNS 资源…");
    try {
      const [pageAssets, cosAssets, domains, records] = await Promise.all([
        allAssets("provider=cloudflare&kind=pages_project"),
        allAssets("provider=tencent&kind=cos_bucket"),
        allAssets("kind=dns_domain"),
        allAssets("kind=dns_record"),
      ]);
      render(pages, pageAssets, (asset) => {
        const probe = asset.metadata?.probe || {};
        const status = probe.status || "pending";
        const latency = Number.isFinite(Number(probe.latencyMs)) ? `${probe.latencyMs}ms` : "-";
        return `${status} / ${latency} / ${asset.metadata?.performanceAdvice || "待检查"}`;
      });
      render(cos, cosAssets, (asset) => `${asset.region || "-"} / ${asset.status || "unknown"}`);
      const dnsAssets = [...domains, ...records].sort((left, right) => left.name.localeCompare(right.name));
      render(dns, dnsAssets, (asset) => {
        const metadata = asset.metadata || {};
        const probe = metadata.probe || {};
        const response = probe.status ? ` / ${probe.status}${Number.isFinite(Number(probe.latencyMs)) ? ` ${probe.latencyMs}ms` : ""}` : "";
        return metadata.type ? `${asset.provider} / ${metadata.type} → ${metadata.value || "-"}${response}` : `${asset.provider} / ${metadata.recordCount || 0} records / ${asset.status || "unknown"}`;
      }, (asset) => asset.url || `https://${asset.name}`);
      state.loaded = true;
    } catch {
      empty(pages, "Pages URL 暂时不可用");
      empty(cos, "COS 资源暂时不可用");
      empty(dns, "URL/DNS 资源暂时不可用");
    } finally {
      state.loading = false;
    }
  }

  async function loadSnapshotWhenOpened() {
    const disclosure = document.getElementById("resource-snapshot-disclosure");
    if (!disclosure?.open || state.snapshotLoaded) return;
    const status = document.getElementById("resource-snapshot-status");
    if (status) status.textContent = "正在读取最新快照…";
    try {
      const response = await endpoint("/api/admin/v1/resource-snapshots/current");
      if (typeof window.renderResourceSnapshot === "function") window.renderResourceSnapshot(response.data);
      state.snapshotLoaded = true;
    } catch {
      if (status) status.textContent = "暂时无法读取资源快照。";
    }
  }

  const dashboard = document.getElementById("dashboard");
  if (dashboard) new MutationObserver(() => {
    if (!dashboard.hidden && !state.serverViewRequested) {
      state.serverViewRequested = true;
      document.getElementById("manage-servers")?.click();
    }
    loadInfrastructureResources();
  }).observe(dashboard, { attributes: true, attributeFilter: ["hidden"] });
  document.getElementById("manage-servers")?.addEventListener("click", loadInfrastructureResources);
  document.getElementById("resource-snapshot-disclosure")?.addEventListener("toggle", loadSnapshotWhenOpened);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadInfrastructureResources(); });
  loadInfrastructureResources();
})();
