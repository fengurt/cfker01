(() => {
  const $ = (selector) => document.querySelector(selector);
  const TOPOLOGY_NODE_LIMIT = 84;
  const TOPOLOGY_LANE_LIMIT = 14;
  const state = {
    map: null,
    index: null,
    selected: null,
    loaded: false,
    mode: "list",
    renderQueued: false,
    topologyObserver: null,
  };
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
      state.index = buildMapIndex(response.data);
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
      filters = mapFilters(form),
      { query, kind, edgeStatus } = filters;
    const matchingEdges = state.map.edges.filter(
      (edge) => !edgeStatus || edge.status === edgeStatus,
    );
    const related = new Set(
      matchingEdges.flatMap((edge) => [edge.source, edge.target]),
    );
    const nodes = state.map.nodes
      .filter(
        (node) =>
          (!kind || node.kind === kind) &&
          (!edgeStatus || related.has(node.id)) &&
          matchesMapFilters(node, filters),
      )
      .sort((a, b) => compareMapNodes(a, b, filters.sort));
    const nodeIds = new Set(nodes.map((node) => node.id));
    if (state.selected && !nodeIds.has(state.selected)) state.selected = null;
    const directEdgeCount = matchingEdges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    ).length;
    renderSummary(nodes, directEdgeCount);
    const display =
      state.mode === "topology"
        ? renderTopology(nodes, matchingEdges, {
            query,
            kind,
            hasFilters: hasActiveMapFilters(filters),
          })
        : renderLanes(nodes);
    $("#asset-map-filter-result").textContent =
      state.mode === "topology"
        ? state.selected
          ? `聚焦 ${display.nodeCount} 个节点、${display.edgeCount} 条关系；筛选命中 ${nodes.length} / ${state.map.nodes.length}`
          : `显示 ${display.nodeCount} / ${nodes.length} 个节点；选择节点后显示上下游关系`
        : `${nodes.length} / ${state.map.nodes.length} 节点，${directEdgeCount} 条当前关系`;
    if (
      state.selected &&
      state.map.nodes.some((node) => node.id === state.selected)
    )
      renderInspector(state.selected);
    else clearInspector();
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
    state.topologyObserver?.disconnect();
    state.topologyObserver = null;
    canvas.className = "asset-map-canvas is-list";
    canvas.replaceChildren();
    if (!nodes.length) {
      canvas.append(
        element("div", "asset-map-no-results", [
          element("strong", "", "没有匹配资产"),
          element("span", "", "调整筛选条件或重置后再试。"),
        ]),
      );
      return { nodeCount: 0, edgeCount: 0 };
    }
    for (const [kindList, label] of laneDefinitions) {
      const kinds = new Set(kindList.split(",")),
        laneNodes = nodes.filter((node) => kinds.has(node.kind)),
        lane = element("section", "asset-map-lane"),
        heading = element("h3", "", `${label}  ${laneNodes.length}`),
        list = element("div", "asset-map-node-list");
      lane.append(heading, list);
      for (const node of laneNodes.slice(0, 120)) {
        const relations = state.index.degree.get(node.id) || 0;
        const button = element("button", "asset-map-node");
        button.type = "button";
        button.dataset.nodeId = node.id;
        button.setAttribute("aria-current", String(state.selected === node.id));
        button.append(
          element("strong", "", node.label),
          element("em", "", String(relations)),
          element("small", "", nodeSubtitle(node)),
          nodeFacts(node),
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
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      nodeCount: nodes.length,
      edgeCount: state.map.edges.filter(
        (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
      ).length,
    };
  }

  function renderTopology(nodes, matchingEdges, context) {
    const canvas = $("#asset-map-canvas");
    state.topologyObserver?.disconnect();
    canvas.className = "asset-map-canvas is-topology";
    canvas.replaceChildren();

    const topology = topologyNeighborhood(nodes, matchingEdges, context);
    const stage = element("div", "asset-map-topology-stage");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("asset-map-links");
    svg.setAttribute("aria-hidden", "true");
    const grid = element("div", "asset-map-topology-grid");
    const nodeElements = new Map();
    const degree = degreeMap(matchingEdges);

    for (const [kindList, label] of laneDefinitions) {
      const kinds = new Set(kindList.split(","));
      const laneNodes = topology.nodes
        .filter((node) => kinds.has(node.kind))
        .sort(
          (a, b) =>
            Number(b.id === state.selected) - Number(a.id === state.selected) ||
            (degree.get(b.id) || 0) - (degree.get(a.id) || 0) ||
            a.label.localeCompare(b.label),
        )
        .slice(0, TOPOLOGY_LANE_LIMIT);
      const lane = element("section", "asset-map-topology-lane");
      lane.append(
        element("h3", "", [
          element("span", "", label),
          element("strong", "", String(laneNodes.length)),
        ]),
      );
      const list = element("div", "asset-map-topology-nodes");
      for (const node of laneNodes) {
        const button = element("button", "asset-map-topology-node");
        button.type = "button";
        button.setAttribute("data-topology-node-id", node.id);
        button.setAttribute("aria-current", String(state.selected === node.id));
        button.setAttribute(
          "aria-label",
          `${kindLabel(node.kind)} ${node.label}，${degree.get(node.id) || 0} 条关系`,
        );
        button.append(
          element("strong", "", node.label),
          element("small", "", nodeSubtitle(node)),
          element("em", "", String(degree.get(node.id) || 0)),
          nodeFacts(node),
        );
        nodeElements.set(node.id, button);
        list.append(button);
      }
      if (!laneNodes.length)
        list.append(element("p", "asset-map-topology-empty", "暂无映射"));
      lane.append(list);
      grid.append(lane);
    }

    stage.append(svg, grid);
    canvas.append(stage);
    const visibleEdges = state.selected ? topology.edges : [];
    const draw = () =>
      drawTopologyEdges(stage, svg, visibleEdges, nodeElements);
    requestAnimationFrame(draw);
    if (typeof ResizeObserver === "function") {
      state.topologyObserver = new ResizeObserver(() =>
        requestAnimationFrame(draw),
      );
      state.topologyObserver.observe(stage);
    }
    return {
      nodeCount: nodeElements.size,
      edgeCount: visibleEdges.filter(
        (edge) =>
          nodeElements.has(edge.source) && nodeElements.has(edge.target),
      ).length,
    };
  }

  function topologyNeighborhood(nodes, edges, context) {
    const nodeById = new Map(state.map.nodes.map((node) => [node.id, node]));
    const degree = degreeMap(edges);
    const anchors = [...nodes].sort(
      (a, b) =>
        Number(b.id === state.selected) - Number(a.id === state.selected) ||
        (degree.get(b.id) || 0) - (degree.get(a.id) || 0),
    );
    const selectedIds = new Set();
    const laneCounts = new Map();
    const canAdd = (id) => {
      if (selectedIds.has(id)) return true;
      const node = nodeById.get(id);
      if (!node || selectedIds.size >= TOPOLOGY_NODE_LIMIT) return false;
      const lane = laneIndex(node.kind);
      return (laneCounts.get(lane) || 0) < TOPOLOGY_LANE_LIMIT;
    };
    const add = (id) => {
      if (!canAdd(id) || selectedIds.has(id)) return false;
      const lane = laneIndex(nodeById.get(id).kind);
      selectedIds.add(id);
      laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
      return true;
    };
    const addPair = (source, target) => {
      const pending = [...new Set([source, target])].filter(
        (id) => !selectedIds.has(id),
      );
      if (
        pending.some((id) => !nodeById.has(id)) ||
        selectedIds.size + pending.length > TOPOLOGY_NODE_LIMIT
      )
        return false;
      const neededByLane = new Map();
      for (const id of pending) {
        const lane = laneIndex(nodeById.get(id).kind);
        neededByLane.set(lane, (neededByLane.get(lane) || 0) + 1);
      }
      if (
        [...neededByLane].some(
          ([lane, needed]) =>
            (laneCounts.get(lane) || 0) + needed > TOPOLOGY_LANE_LIMIT,
        )
      )
        return false;
      const before = selectedIds.size;
      for (const id of pending) add(id);
      return selectedIds.size > before;
    };

    if (state.selected) {
      add(state.selected);
      let frontier = new Set([state.selected]);
      for (let depth = 0; depth < 2 && frontier.size; depth++) {
        const next = new Set();
        for (const edge of edges) {
          if (frontier.has(edge.source)) {
            if (selectedIds.has(edge.target) || add(edge.target))
              next.add(edge.target);
          }
          if (frontier.has(edge.target)) {
            if (selectedIds.has(edge.source) || add(edge.source))
              next.add(edge.source);
          }
        }
        frontier = next;
      }
    } else if (context.hasFilters) {
      for (const node of anchors.slice(0, 28)) add(node.id);
      expandOneHop(selectedIds, edges, degree, add);
    } else {
      const pairQueues = new Map();
      for (const edge of edges) {
        const source = nodeById.get(edge.source),
          target = nodeById.get(edge.target);
        if (!source || !target) continue;
        const pair = [laneIndex(source.kind), laneIndex(target.kind)]
          .sort((a, b) => a - b)
          .join(":");
        if (!pairQueues.has(pair)) pairQueues.set(pair, []);
        pairQueues.get(pair).push(edge);
      }
      for (const queue of pairQueues.values())
        queue.sort(
          (a, b) =>
            (degree.get(b.source) || 0) +
            (degree.get(b.target) || 0) -
            (degree.get(a.source) || 0) -
            (degree.get(a.target) || 0),
        );
      let added = true;
      while (added && selectedIds.size < TOPOLOGY_NODE_LIMIT) {
        added = false;
        for (const queue of pairQueues.values()) {
          const edge = queue.shift();
          if (!edge) continue;
          added = addPair(edge.source, edge.target) || added;
          if (selectedIds.size >= TOPOLOGY_NODE_LIMIT) break;
        }
      }
    }

    const selectedNodes = [...selectedIds]
      .map((id) => nodeById.get(id))
      .filter(Boolean);
    const visibleIds = new Set(selectedNodes.map((node) => node.id));
    return {
      nodes: selectedNodes,
      edges: edges.filter(
        (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
      ),
    };
  }

  function expandOneHop(selectedIds, edges, degree, add) {
    const candidates = [];
    for (const edge of edges) {
      if (selectedIds.has(edge.source) && !selectedIds.has(edge.target))
        candidates.push([edge.target, degree.get(edge.target) || 0]);
      if (selectedIds.has(edge.target) && !selectedIds.has(edge.source))
        candidates.push([edge.source, degree.get(edge.source) || 0]);
    }
    for (const [id] of candidates.sort((a, b) => b[1] - a[1])) add(id);
  }

  function degreeMap(edges) {
    const degree = new Map();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }
    return degree;
  }

  function laneIndex(kind) {
    return laneDefinitions.findIndex(([kindList]) =>
      kindList.split(",").includes(kind),
    );
  }

  function drawTopologyEdges(stage, svg, edges, nodeElements) {
    svg.replaceChildren();
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "marker",
    );
    marker.id = "asset-map-arrow";
    marker.setAttribute("viewBox", "0 0 8 8");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "4");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto");
    const arrow = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    arrow.setAttribute("d", "M 0 0 L 8 4 L 0 8 z");
    arrow.classList.add("asset-map-arrow");
    marker.append(arrow);
    defs.append(marker);
    svg.append(defs);
    const stageRect = stage.getBoundingClientRect();
    const width = Math.max(stage.scrollWidth, stage.clientWidth);
    const height = Math.max(stage.scrollHeight, stage.clientHeight);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    for (const edge of edges) {
      const source = nodeElements.get(edge.source);
      const target = nodeElements.get(edge.target);
      if (!source || !target) continue;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const forward = sourceRect.left <= targetRect.left;
      const x1 =
        (forward ? sourceRect.right : sourceRect.left) - stageRect.left;
      const x2 =
        (forward ? targetRect.left : targetRect.right) - stageRect.left;
      const y1 = sourceRect.top + sourceRect.height / 2 - stageRect.top;
      const y2 = targetRect.top + targetRect.height / 2 - stageRect.top;
      const bend = Math.max(28, Math.abs(x2 - x1) * 0.42);
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute(
        "d",
        `M ${x1} ${y1} C ${x1 + (forward ? bend : -bend)} ${y1}, ${x2 - (forward ? bend : -bend)} ${y2}, ${x2} ${y2}`,
      );
      path.classList.add("asset-map-link");
      path.setAttribute("marker-end", "url(#asset-map-arrow)");
      path.classList.toggle("is-candidate", edge.status === "candidate");
      path.classList.toggle(
        "is-selected",
        edge.source === state.selected || edge.target === state.selected,
      );
      const title = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "title",
      );
      title.textContent = `${edge.relationship} / ${edge.status}`;
      path.append(title);
      svg.append(path);
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
    document
      .querySelectorAll(".asset-map-node,.asset-map-topology-node")
      .forEach((button) => {
        const buttonId = button.dataset.nodeId || button.dataset.topologyNodeId;
        button.setAttribute("aria-current", String(buttonId === nodeId));
        button.toggleAttribute(
          "data-related",
          relatedIds.has(buttonId) && buttonId !== nodeId,
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
        Object.assign(element("h3", "", "选择一个节点"), {
          id: "asset-map-inspector-title",
        }),
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
    const button = event.target.closest(
      "button[data-node-id],button[data-topology-node-id]",
    );
    if (!button) return;
    const nodeId = button.dataset.nodeId || button.dataset.topologyNodeId;
    state.selected = state.selected === nodeId ? null : nodeId;
    render();
  });
  $("#asset-map-inspector")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-related-node]");
    if (!button) return;
    state.selected = button.dataset.relatedNode;
    render();
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
  $("#asset-map-filters")?.addEventListener("input", scheduleRender);
  $("#asset-map-filters")?.addEventListener("change", scheduleRender);
  $("#asset-map-filters")?.addEventListener("reset", () => {
    state.mode = "list";
    state.selected = null;
    document
      .querySelectorAll("button[data-map-mode]")
      .forEach((item) =>
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.mapMode === state.mode),
        ),
      );
    requestAnimationFrame(render);
  });
  $("#asset-map-filters")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-map-mode]");
    if (!button) return;
    state.mode = button.dataset.mapMode;
    document
      .querySelectorAll("button[data-map-mode]")
      .forEach((item) =>
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.mapMode === state.mode),
        ),
      );
    render();
  });
  $("#asset-map-refresh")?.addEventListener("click", () => loadAssetMap(true));
  $("#asset-map-snapshot")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/admin/v1/asset-map/versions", {
        method: "POST",
        body: JSON.stringify({ summary: "Manual dashboard backup" }),
      });
      await loadVersions();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
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

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      render();
    });
  }

  function buildMapIndex(map) {
    const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
    const degree = degreeMap(map.edges);
    const search = new Map(
      map.nodes.map((node) => [node.id, searchable(node)]),
    );
    const timestamps = new Map(
      map.nodes.map((node) => [node.id, nodeTimestamp(node)]),
    );
    const sync = new Map(
      map.nodes.map((node) => [node.id, normalizedSyncStatus(node)]),
    );
    const roots = new Map();
    const deployed = new Set(
      map.nodes
        .filter((node) => node.kind === "deployment")
        .map((node) => node.id),
    );
    const skills = new Set(
      map.nodes.filter((node) => hasSkillMetadata(node)).map((node) => node.id),
    );

    for (const node of map.nodes) {
      const root = localRoot(node);
      if (root) roots.set(node.id, new Set([root]));
    }
    for (const edge of map.edges) {
      if (edge.relationship === "syncs_to" && !sync.get(edge.source))
        sync.set(edge.source, sync.get(edge.target) || "");
      if (edge.relationship === "contains_skill") {
        skills.add(edge.source);
        skills.add(edge.target);
      }
    }

    const rootRelationships = new Set([
      "syncs_to",
      "contains_project",
      "contains_skill",
      "implements",
      "deploys_as",
      "runs_on",
      "exposes",
    ]);
    for (let pass = 0; pass < 7; pass++) {
      let changed = false;
      for (const edge of map.edges) {
        if (!rootRelationships.has(edge.relationship)) continue;
        const sourceRoots = roots.get(edge.source);
        if (!sourceRoots?.size) continue;
        const targetRoots = roots.get(edge.target) || new Set();
        const before = targetRoots.size;
        for (const root of sourceRoots) targetRoots.add(root);
        if (targetRoots.size !== before) {
          roots.set(edge.target, targetRoots);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const deploymentParents = new Set([
      "deploys_as",
      "implements",
      "syncs_to",
      "contains_project",
      "belongs_to",
    ]);
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const edge of map.edges) {
        if (
          deploymentParents.has(edge.relationship) &&
          deployed.has(edge.target) &&
          !deployed.has(edge.source)
        ) {
          deployed.add(edge.source);
          changed = true;
        }
        if (
          ["runs_on", "exposes"].includes(edge.relationship) &&
          deployed.has(edge.source) &&
          !deployed.has(edge.target)
        ) {
          deployed.add(edge.target);
          changed = true;
        }
      }
      if (!changed) break;
    }

    return {
      nodeById,
      degree,
      search,
      timestamps,
      sync,
      roots,
      deployed,
      skills,
    };
  }

  function mapFilters(form) {
    return {
      query: String(form.elements.q.value || "")
        .trim()
        .toLocaleLowerCase(),
      kind: form.elements.kind.value,
      syncStatus: form.elements.syncStatus.value,
      updated: form.elements.updated.value,
      root: form.elements.root.value,
      deployed: form.elements.deployed.value,
      skills: form.elements.skills.value,
      edgeStatus: form.elements.edgeStatus.value,
      sort: form.elements.sort.value || "updated_desc",
    };
  }

  function matchesMapFilters(node, filters) {
    const index = state.index;
    if (
      filters.query &&
      !filters.query
        .split(/\s+/)
        .every((token) => index.search.get(node.id).includes(token))
    )
      return false;
    if (filters.syncStatus && index.sync.get(node.id) !== filters.syncStatus)
      return false;
    if (
      filters.updated &&
      !matchesUpdatedRange(index.timestamps.get(node.id), filters.updated)
    )
      return false;
    if (filters.root && !index.roots.get(node.id)?.has(filters.root))
      return false;
    if (
      filters.deployed &&
      index.deployed.has(node.id) !== (filters.deployed === "true")
    )
      return false;
    if (
      filters.skills &&
      index.skills.has(node.id) !== (filters.skills === "true")
    )
      return false;
    return true;
  }

  function hasActiveMapFilters(filters) {
    return Boolean(
      filters.query ||
      filters.kind ||
      filters.syncStatus ||
      filters.updated ||
      filters.root ||
      filters.deployed ||
      filters.skills ||
      filters.edgeStatus,
    );
  }

  function matchesUpdatedRange(timestamp, range) {
    if (range === "unknown") return !timestamp;
    if (!timestamp) return false;
    const age = Date.now() - timestamp;
    const day = 24 * 60 * 60 * 1000;
    if (range === "older") return age > 90 * day;
    const limit = {
      "24h": day,
      "7d": 7 * day,
      "30d": 30 * day,
      "90d": 90 * day,
    }[range];
    return limit ? age <= limit : true;
  }

  function compareMapNodes(a, b, sort) {
    const index = state.index;
    if (sort === "name") return a.label.localeCompare(b.label);
    if (sort === "relations")
      return (
        (index.degree.get(b.id) || 0) - (index.degree.get(a.id) || 0) ||
        a.label.localeCompare(b.label)
      );
    if (sort === "sync_risk") {
      const severity = {
        diverged: 90,
        github_not_found_or_no_access: 85,
        dirty_uncommitted: 80,
        local_ahead: 70,
        github_ahead: 65,
        github_head_mismatch: 60,
        no_remote: 55,
        remote_non_github: 30,
        unverified: 20,
        synced: 0,
      };
      return (
        (severity[index.sync.get(b.id)] || 0) -
          (severity[index.sync.get(a.id)] || 0) ||
        (index.timestamps.get(b.id) || 0) - (index.timestamps.get(a.id) || 0) ||
        a.label.localeCompare(b.label)
      );
    }
    const direction = sort === "updated_asc" ? 1 : -1;
    const aTime = index.timestamps.get(a.id) || 0;
    const bTime = index.timestamps.get(b.id) || 0;
    if (!aTime && bTime) return 1;
    if (aTime && !bTime) return -1;
    return direction * (aTime - bTime) || a.label.localeCompare(b.label);
  }

  function searchable(node) {
    return `${node.label} ${node.id} ${node.status} ${JSON.stringify(node.metadata || {})} ${(node.annotation?.tags || []).join(" ")} ${node.annotation?.notes || ""}`.toLocaleLowerCase();
  }

  function nodeTimestamp(node) {
    const value =
      node.metadata?.sourceUpdatedAt ||
      node.metadata?.lastCommitAt ||
      node.metadata?.pushedAt ||
      node.updatedAt;
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function normalizedSyncStatus(node) {
    const raw = String(node.metadata?.syncStatus || node.status || "");
    if (raw === "dirty") return "dirty_uncommitted";
    if (raw === "tracked" && node.metadata?.dirty) return "dirty_uncommitted";
    return [
      "synced",
      "dirty_uncommitted",
      "local_ahead",
      "github_ahead",
      "github_head_mismatch",
      "diverged",
      "no_remote",
      "github_not_found_or_no_access",
      "remote_non_github",
      "unverified",
    ].includes(raw)
      ? raw
      : "";
  }

  function localRoot(node) {
    const path = String(node.metadata?.scanRoot || node.metadata?.path || "");
    if (path === "/Users/af/cpro01" || path.startsWith("/Users/af/cpro01/"))
      return "/Users/af/cpro01";
    if (
      path === "/Users/af/Documents" ||
      path.startsWith("/Users/af/Documents/")
    )
      return "/Users/af/Documents";
    return "";
  }

  function hasSkillMetadata(node) {
    return (
      node.metadata?.resourceType === "skill" ||
      (Array.isArray(node.metadata?.resourceTypes) &&
        node.metadata.resourceTypes.includes("skill")) ||
      (Array.isArray(node.metadata?.skillPaths) &&
        node.metadata.skillPaths.length > 0)
    );
  }

  function nodeFacts(node) {
    const facts = element("span", "asset-map-node-facts");
    const syncStatus = state.index?.sync.get(node.id);
    if (syncStatus)
      facts.append(
        element("span", `is-sync is-${syncStatus}`, syncLabel(syncStatus)),
      );
    const timestamp = state.index?.timestamps.get(node.id);
    facts.append(
      element(
        "time",
        "",
        timestamp ? compactDate(timestamp) : "更新时间未采集",
      ),
    );
    return facts;
  }

  function syncLabel(status) {
    return (
      {
        synced: "已同步",
        dirty_uncommitted: "未提交",
        local_ahead: "本地领先",
        github_ahead: "GitHub 领先",
        github_head_mismatch: "HEAD 不一致",
        diverged: "已分叉",
        no_remote: "无 Remote",
        github_not_found_or_no_access: "GitHub 不可达",
        remote_non_github: "非 GitHub",
        unverified: "未验证",
      }[status] || status
    );
  }

  function compactDate(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp));
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
