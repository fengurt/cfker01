(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = { map: null, selected: null, loaded: false };
  const laneDefinitions = [
    ["local_path", "本地 Git"],
    ["repository", "GitHub"],
    ["project", "项目"],
    ["deployment", "部署"],
    ["server", "服务器"],
    ["service", "运行服务"],
    ["endpoint,cloud_asset", "DNS / 云资产"],
  ];

  async function api(path, init = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      ...init,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.error?.message || body.error?.code || `HTTP ${response.status}`,
      );
    }
    return response.status === 204 ? null : response.json();
  }

  async function loadAssetMap(force = false) {
    const canvas = $("#asset-map-canvas");
    if (!canvas || (state.loaded && !force)) return;
    canvas.setAttribute("aria-busy", "true");
    canvas.textContent = "正在读取资产关系…";
    try {
      const response = await api("/api/admin/v1/asset-map");
      state.map = response.data;
      state.loaded = true;
      if ($("#asset-map-relation-editor")?.open) populateRelationSelectors();
      render();
    } catch (error) {
      canvas.textContent = `资产地图读取失败：${error.message}`;
    } finally {
      canvas.removeAttribute("aria-busy");
    }
  }

  function render() {
    if (!state.map) return;
    const form = $("#asset-map-filters"),
      query = String(form.elements.q.value || "")
        .trim()
        .toLocaleLowerCase(),
      kind = form.elements.kind.value,
      edgeStatus = form.elements.edgeStatus.value;
    const matchingEdges = state.map.edges.filter(
      (edge) => !edgeStatus || edge.status === edgeStatus,
    );
    const related = new Set(
      matchingEdges.flatMap((edge) => [edge.source, edge.target]),
    );
    const nodes = state.map.nodes.filter(
      (node) =>
        (!kind || node.kind === kind) &&
        (!edgeStatus || related.has(node.id)) &&
        (!query || searchable(node).includes(query)),
    );
    const visibleIds = new Set(nodes.map((node) => node.id));
    const edgeCount = matchingEdges.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    ).length;
    renderSummary(nodes, edgeCount);
    renderLanes(nodes);
    $("#asset-map-filter-result").textContent =
      `${nodes.length} / ${state.map.nodes.length} 节点，${edgeCount} 条当前关系`;
    if (state.selected && visibleIds.has(state.selected))
      renderInspector(state.selected);
    else if (state.selected) clearInspector();
  }

  function renderSummary(nodes, edgeCount) {
    const summary = $("#asset-map-summary");
    summary.replaceChildren();
    const metrics = [
      [
        nodes.filter((node) => node.kind === "local_path").length,
        "本地 Git 路径",
      ],
      [
        nodes.filter((node) => node.kind === "repository").length,
        "GitHub 仓库",
      ],
      [nodes.filter((node) => node.kind === "deployment").length, "部署记录"],
      [nodes.filter((node) => node.kind === "server").length, "服务器"],
      [nodes.filter((node) => node.kind === "endpoint").length, "DNS / URL"],
      [edgeCount, "可见关系"],
    ];
    for (const [value, label] of metrics)
      summary.append(
        element("div", "asset-map-metric", [
          element("strong", "", String(value)),
          element("span", "", label),
        ]),
      );
  }

  function renderLanes(nodes) {
    const canvas = $("#asset-map-canvas");
    canvas.replaceChildren();
    for (const [kindList, label] of laneDefinitions) {
      const kinds = new Set(kindList.split(",")),
        laneNodes = nodes.filter((node) => kinds.has(node.kind)),
        lane = element("section", "asset-map-lane"),
        heading = element("h3", "", `${label}  ${laneNodes.length}`),
        list = element("div", "asset-map-node-list");
      lane.append(heading, list);
      for (const node of laneNodes.slice(0, 120)) {
        const relations = state.map.edges.filter(
          (edge) => edge.source === node.id || edge.target === node.id,
        ).length;
        const button = element("button", "asset-map-node");
        button.type = "button";
        button.dataset.nodeId = node.id;
        button.setAttribute("aria-current", String(state.selected === node.id));
        button.append(
          element("strong", "", node.label),
          element("em", "", String(relations)),
          element("small", "", nodeSubtitle(node)),
        );
        list.append(button);
      }
      if (laneNodes.length > 120)
        list.append(
          element(
            "p",
            "asset-map-lane-more",
            `还有 ${laneNodes.length - 120} 项，请搜索缩小范围`,
          ),
        );
      canvas.append(lane);
    }
  }

  function renderInspector(nodeId) {
    const node = state.map.nodes.find((item) => item.id === nodeId);
    if (!node) return clearInspector();
    state.selected = nodeId;
    const relatedIds = new Set(
      state.map.edges
        .filter((edge) => edge.source === nodeId || edge.target === nodeId)
        .flatMap((edge) => [edge.source, edge.target]),
    );
    document.querySelectorAll(".asset-map-node").forEach((button) => {
      button.setAttribute(
        "aria-current",
        String(button.dataset.nodeId === nodeId),
      );
      button.toggleAttribute(
        "data-related",
        relatedIds.has(button.dataset.nodeId) &&
          button.dataset.nodeId !== nodeId,
      );
    });
    const inspector = $("#asset-map-inspector");
    inspector.replaceChildren();
    const title = element("h3", "", node.label);
    title.id = "asset-map-inspector-title";
    inspector.append(
      title,
      element("p", "kicker", `${kindLabel(node.kind)} / ${node.status}`),
    );
    const metadata = element("div", "asset-map-inspector-meta");
    for (const [key, value] of Object.entries(node.metadata || {}).slice(
      0,
      12,
    )) {
      const cell = element("div");
      cell.append(element("span", "", humanKey(key)));
      if (/url$/i.test(key) && isHttpUrl(value)) {
        const link = element("a", "", String(value));
        link.href = String(value);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        cell.append(link);
      } else cell.append(element("strong", "", formatValue(value)));
      metadata.append(cell);
    }
    inspector.append(metadata);
    const relations = state.map.edges.filter(
        (edge) => edge.source === nodeId || edge.target === nodeId,
      ),
      relationList = element("div", "asset-map-relations");
    relationList.append(element("h3", "", `关系 ${relations.length}`));
    for (const edge of relations.slice(0, 30)) {
      const outbound = edge.source === nodeId,
        otherId = outbound ? edge.target : edge.source,
        other = state.map.nodes.find((item) => item.id === otherId),
        row = element("div", "asset-map-relation");
      row.append(
        element("span", "", `${outbound ? "→" : "←"} ${edge.relationship}`),
      );
      const button = element("button", "", other?.label || otherId);
      button.type = "button";
      button.dataset.relatedNode = otherId;
      row.append(button);
      relationList.append(row);
    }
    inspector.append(relationList);
    const form = element("form", "asset-map-annotation-form");
    form.dataset.entityId = node.id;
    const labelInput = document.createElement("input");
    labelInput.name = "label";
    labelInput.maxLength = 200;
    labelInput.value = node.annotation?.label || "";
    const tagInput = document.createElement("input");
    tagInput.name = "tags";
    tagInput.value = (node.annotation?.tags || []).join(", ");
    const notes = document.createElement("textarea");
    notes.name = "notes";
    notes.maxLength = 5000;
    notes.value = node.annotation?.notes || "";
    form.append(
      labeled("显示名称", labelInput),
      labeled("标签，逗号分隔", tagInput),
      labeled("维护备注", notes),
      element("button", "", "保存人工补充"),
    );
    inspector.append(form);
  }

  function clearInspector() {
    state.selected = null;
    const inspector = $("#asset-map-inspector");
    inspector.replaceChildren(
      element("div", "asset-map-empty", [
        element("h3", "", "选择一个节点"),
        element("p", "", "查看上下游关系并补充名称、标签和维护备注。"),
      ]),
    );
  }

  function populateRelationSelectors() {
    for (const select of document.querySelectorAll(
      "#asset-map-edge-form select[name=source],#asset-map-edge-form select[name=target]",
    )) {
      select.replaceChildren(new Option("选择节点", ""));
      for (const node of state.map.nodes)
        select.append(
          new Option(`${kindLabel(node.kind)} / ${node.label}`, node.id),
        );
    }
  }

  async function loadVersions() {
    const target = $("#asset-map-version-list");
    target.textContent = "正在读取版本…";
    try {
      const response = await api("/api/admin/v1/asset-map/versions?limit=100");
      target.replaceChildren();
      if (!response.data.length)
        return target.append(
          element(
            "p",
            "asset-map-lane-more",
            "尚无版本。保存一次或等待每日自动快照。",
          ),
        );
      for (const version of response.data) {
        const row = element("div", "asset-map-version"),
          actions = element("div", "asset-map-version-actions"),
          download = element("a", "", "下载 JSON");
        download.href = `/api/admin/v1/asset-map/versions/${encodeURIComponent(version.id)}?download=1`;
        download.download = "";
        const restore = element("button", "", "恢复人工层");
        restore.type = "button";
        restore.dataset.restoreVersion = version.id;
        restore.dataset.version = version.version;
        actions.append(download, restore);
        row.append(
          element("strong", "", `v${version.version}`),
          element("code", "", String(version.contentHash).slice(0, 12)),
          element(
            "small",
            "",
            `${version.reason} / ${formatDate(version.createdAt)} / ${formatBytes(version.snapshotBytes)}`,
          ),
          actions,
        );
        target.append(row);
      }
    } catch (error) {
      target.textContent = `版本读取失败：${error.message}`;
    }
  }

  $("#asset-map-canvas")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-node-id]");
    if (button) renderInspector(button.dataset.nodeId);
  });
  $("#asset-map-inspector")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-related-node]");
    if (button) renderInspector(button.dataset.relatedNode);
  });
  $("#asset-map-inspector")?.addEventListener("submit", async (event) => {
    const form = event.target.closest(".asset-map-annotation-form");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api("/api/admin/v1/asset-map/annotations", {
        method: "PUT",
        body: JSON.stringify({
          entityId: form.dataset.entityId,
          label: form.elements.label.value,
          notes: form.elements.notes.value,
          tags: form.elements.tags.value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      await loadAssetMap(true);
      renderInspector(form.dataset.entityId);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#asset-map-edge-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/api/admin/v1/asset-map/edges", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      await loadAssetMap(true);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#asset-map-filters")?.addEventListener("input", render);
  $("#asset-map-refresh")?.addEventListener("click", () => loadAssetMap(true));
  $("#asset-map-snapshot")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await api("/api/admin/v1/asset-map/versions", {
        method: "POST",
        body: JSON.stringify({ summary: "Manual dashboard backup" }),
      });
      await loadVersions();
    } catch (error) {
      alert(error.message);
    } finally {
      event.currentTarget.disabled = false;
    }
  });
  $("#asset-map-history")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open) loadVersions();
  });
  $("#asset-map-relation-editor")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open && state.map) populateRelationSelectors();
  });
  $("#asset-map-version-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-restore-version]");
    if (
      !button ||
      !confirm(
        `恢复 v${button.dataset.version} 的人工备注和关系？扫描事实不会改变。`,
      )
    )
      return;
    button.disabled = true;
    try {
      await api(
        `/api/admin/v1/asset-map/versions/${encodeURIComponent(button.dataset.restoreVersion)}/restore`,
        { method: "POST", body: "{}" },
      );
      await loadAssetMap(true);
      await loadVersions();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });

  function searchable(node) {
    return `${node.label} ${node.status} ${JSON.stringify(node.metadata || {})} ${node.annotation?.notes || ""}`.toLocaleLowerCase();
  }
  function nodeSubtitle(node) {
    if (node.kind === "local_path") return node.metadata.path || node.status;
    if (node.kind === "repository")
      return `${node.status} / ${String(node.metadata.headSha || "").slice(0, 8)}`;
    if (node.kind === "server")
      return `${node.metadata.provider || "server"} / ${node.metadata.ipAddress || node.status}`;
    return node.metadata.url || node.metadata.region || node.status;
  }
  function kindLabel(kind) {
    return (
      {
        local_path: "本地",
        repository: "仓库",
        project: "项目",
        deployment: "部署",
        server: "服务器",
        service: "服务",
        endpoint: "端点",
        cloud_asset: "云资产",
      }[kind] || kind
    );
  }
  function humanKey(key) {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (value) => value.toUpperCase());
  }
  function formatValue(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "-");
  }
  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  }
  function formatBytes(value) {
    const bytes = Number(value || 0);
    return bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.ceil(bytes / 1024)} KB`;
  }
  function isHttpUrl(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value);
  }
  function element(tag, className = "", content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (Array.isArray(content)) node.append(...content);
    else if (content !== undefined) node.textContent = content;
    return node;
  }
  function labeled(label, control) {
    const node = document.createElement("label");
    node.append(element("span", "", label), control);
    return node;
  }
  window.loadAssetMap = loadAssetMap;
})();
