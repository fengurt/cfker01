const $ = (selector) => document.querySelector(selector);
const translations = {
  "zh-CN": {
    skip: "跳到管理区",
    brand: "TableAI 资源运营",
    publicCatalog: "公开目录",
    logout: "退出",
    loginTitle: "系统管理员登录",
    loginHelp:
      "使用手机号码和密码登录。可信设备会通过安全的 HttpOnly Cookie 保持登录 90 天，并在使用时自动续期。",
    phone: "手机号码",
    password: "密码",
    login: "登录",
    inventory: "项目资源库",
    inventoryHelp: "统一管理本机扫描、技能、Agent、仓库、部署与基准证据。",
    projects: "项目",
    servers: "服务器",
    serversDeployments: "服务器与部署",
    resourceMonitoring: "资源监控",
    cloudResources: "云资源",
    cloudInventory: "云资源清单",
    cloudInventoryHelp:
      "统一筛选腾讯云、Cloudflare、GoDaddy 与链上域名资源。",
    repositories: "仓库",
    region: "地域",
    onlineServers: "在线",
    activeDeployments: "部署项目",
    githubRepositories: "GitHub 仓库",
    addServer: "添加服务器",
    import: "导入本机扫描",
    records: "管理记录",
    discoveries: "本机发现",
    pinned: "已置顶",
    missing: "缺少描述",
    search: "搜索",
    searchPlaceholder: "名称、来源或描述",
    type: "类型",
    allTypes: "全部类型",
    tag: "标签",
    platform: "平台",
    allPlatforms: "全部平台",
    status: "状态",
    allStatuses: "全部状态",
    deployment: "部署",
    all: "全部",
    deployed: "已部署",
    notDeployed: "未部署",
    view: "视图",
    pinnedOnly: "仅置顶",
    sort: "排序",
    pinRank: "置顶顺序",
    sourceUpdate: "最近更新",
    lastScan: "最近扫描",
    name: "名称",
    apply: "筛选",
    resource: "资源",
    classification: "分类",
    updated: "更新时间",
    operations: "运营状态",
    previous: "上一页",
    next: "下一页",
    overview: "概览",
    backup: "备份",
    codebase: "代码地图",
    notes: "加密笔记",
    benchmarks: "基准发现",
    description: "描述",
    visibility: "可见性",
    tags: "标签（逗号分隔）",
    pinProject: "置顶此项目",
    server: "服务器",
    environment: "环境",
    version: "版本",
    saveDeployment: "保存部署",
    branch: "分支",
    saveBackup: "保存备份仓库",
    saveEncrypted: "加密保存",
    benchmarkQuery: "查找基准",
    discover: "开始发现",
    close: "关闭",
    save: "保存概览",
    provider: "提供商",
    architecture: "架构",
    dueDate: "到期日期",
    saveServer: "添加服务器",
    resourceServers: "服务器",
    apiServices: "API 服务",
    domainsEndpoints: "域名与端点",
    storageCloudAssets: "存储与云资产",
    needsAttention: "需处理",
    healthyServers: "健康服务器",
    abnormalApis: "异常 API",
    unreachableEndpoints: "不可达端点",
    expiringSoon: "即将到期",
    noModel: "未选择模型",
    checked: "检查",
    nextCheck: "下次",
    notChecked: "尚未检查",
    queued: "已排队",
    attention: "需关注",
    unconfigured: "未配置",
    connectors: "连接器",
    subscribeOfficial: "订阅 / 充值",
    officialDocs: "官方文档",
    availableModels: "可用模型",
    keyExpiryUnknown: "Key 到期：当前凭据无法查询",
    keyExpires: "Key 到期",
  },
  en: {
    skip: "Skip to admin",
    brand: "TableAI Resource Ops",
    publicCatalog: "Public catalog",
    logout: "Sign out",
    loginTitle: "System admin login",
    loginHelp:
      "Sign in with a phone number and password. A trusted device stays signed in with a secure HttpOnly cookie for 90 days and renews while in use.",
    phone: "Phone number",
    password: "Password",
    login: "Sign in",
    inventory: "Project inventory",
    inventoryHelp:
      "Manage local discoveries, skills, agents, repositories, deployments, and benchmark evidence.",
    projects: "Projects",
    servers: "Servers",
    serversDeployments: "Servers & deployments",
    resourceMonitoring: "Resource monitoring",
    cloudResources: "Cloud resources",
    cloudInventory: "Cloud inventory",
    cloudInventoryHelp:
      "Filter Tencent Cloud, Cloudflare, GoDaddy, and on-chain domain assets in one place.",
    repositories: "Repositories",
    region: "Region",
    onlineServers: "Online",
    activeDeployments: "Deployments",
    githubRepositories: "GitHub repositories",
    addServer: "Add server",
    import: "Import local scan",
    records: "managed records",
    discoveries: "local discoveries",
    pinned: "pinned",
    missing: "missing descriptions",
    search: "Search",
    searchPlaceholder: "Name, source, or description",
    type: "Type",
    allTypes: "All types",
    tag: "Tag",
    platform: "Platform",
    allPlatforms: "All platforms",
    status: "Status",
    allStatuses: "All statuses",
    deployment: "Deployment",
    all: "All",
    deployed: "Deployed",
    notDeployed: "Not deployed",
    view: "View",
    pinnedOnly: "Pinned only",
    sort: "Sort",
    pinRank: "Pin rank",
    sourceUpdate: "Source update",
    lastScan: "Last scan",
    name: "Name",
    apply: "Apply",
    resource: "Resource",
    classification: "Classification",
    updated: "Updated",
    operations: "Operations",
    previous: "Previous",
    next: "Next",
    overview: "Overview",
    backup: "Backup",
    codebase: "Codebase map",
    notes: "Encrypted notes",
    benchmarks: "Benchmarks",
    description: "Description",
    visibility: "Visibility",
    tags: "Tags (comma separated)",
    pinProject: "Pin this project",
    server: "Server",
    environment: "Environment",
    version: "Version",
    saveDeployment: "Save deployment",
    branch: "Branch",
    saveBackup: "Save backup repository",
    saveEncrypted: "Save encrypted",
    benchmarkQuery: "Find benchmarks",
    discover: "Start discovery",
    close: "Close",
    save: "Save overview",
    provider: "Provider",
    architecture: "Architecture",
    dueDate: "Due date",
    saveServer: "Add server",
    resourceServers: "Servers",
    apiServices: "API services",
    domainsEndpoints: "Domains & endpoints",
    storageCloudAssets: "Storage & cloud assets",
    needsAttention: "Needs attention",
    healthyServers: "Healthy servers",
    abnormalApis: "API issues",
    unreachableEndpoints: "Unreachable endpoints",
    expiringSoon: "Expiring soon",
    noModel: "No model",
    checked: "Checked",
    nextCheck: "next",
    notChecked: "Not checked yet",
    queued: "Queued",
    attention: "Attention",
    unconfigured: "Unconfigured",
    connectors: "Connectors",
    subscribeOfficial: "Subscribe / billing",
    officialDocs: "Official docs",
    availableModels: "Available models",
    keyExpiryUnknown: "Key expiry: unavailable to the current credential",
    keyExpires: "Key expires",
  },
};
Object.assign(translations["zh-CN"], {
  prioritySort: "运营优先",
  latestDeployment: "最新部署",
  latestBackup: "最新备份",
});
Object.assign(translations.en, {
  prioritySort: "Operations priority",
  latestDeployment: "Latest deployment",
  latestBackup: "Latest backup",
});
Object.assign(translations["zh-CN"], {
  resourcePath: "资源 / 本地路径",
  github: "GitHub",
  deploymentServerUrl: "部署 / 服务器 / URL",
  deployedProjects: "已部署项目",
  deploymentUrls: "部署 URL",
  activeNow: "实际活跃",
  healthy: "健康",
  incidents: "未恢复事件",
  runMonitor: "立即检查",
});
Object.assign(translations.en, {
  resourcePath: "Resource / local path",
  github: "GitHub",
  deploymentServerUrl: "Deployment / server / URL",
  deployedProjects: "Deployed projects",
  deploymentUrls: "Deployment URLs",
  activeNow: "Active now",
  healthy: "Healthy",
  incidents: "Open incidents",
  runMonitor: "Check now",
});
let locale = localStorage.getItem("tableai-locale") || "zh-CN",
  page = 1,
  pages = 1,
  current = [],
  activeProject = null,
  servers = [],
  serverOptions = [],
  cloudPage = 1,
  cloudPages = 1,
  repositoryPage = 1,
  repositoryPages = 1,
  assetSummary = null,
  billingSummary = null,
  monitorSummary = null,
  projectRequestController = null,
  filterTimer = null,
  sourcePollTimer = null;
let resourceView = "servers";
const projectFilters = {
  type: new Set(),
  platform: new Set(),
  status: new Set(),
  deployed: new Set(),
  pinned: new Set(),
};
function t(key) {
  return translations[locale][key] || key;
}
function applyLocale() {
  document.documentElement.lang = locale;
  document
    .querySelectorAll("[data-i18n]")
    .forEach((node) => (node.textContent = t(node.dataset.i18n)));
  document
    .querySelectorAll("[data-i18n-placeholder]")
    .forEach((node) => (node.placeholder = t(node.dataset.i18nPlaceholder)));
  $("#language").textContent = locale === "zh-CN" ? "EN" : "中文";
}
$("#language").addEventListener("click", () => {
  locale = locale === "zh-CN" ? "en" : "zh-CN";
  localStorage.setItem("tableai-locale", locale);
  applyLocale();
  if (current.length) renderRows(current);
  if (servers.length) renderServers();
  if (resourceView === "api") loadApiProviders().catch((error) => setNotice(error.message, true));
  if (["endpoints", "storage"].includes(resourceView)) switchResourceView(resourceView).catch((error) => setNotice(error.message, true));
});
async function request(path, options = {}) {
  const { skipReauth = false, ...fetchOptions } = options;
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...fetchOptions,
    headers: { "Content-Type": "application/json", ...(fetchOptions.headers || {}) },
  });
  const body = await response
    .json()
    .catch(() => ({ error: "invalid_response" }));
  if (!response.ok) {
    const error = new Error(
      body.error?.message || body.error || `Request failed: ${response.status}`,
    );
    error.status = response.status;
    error.code = body.error?.code || body.error;
    error.details = body.error?.details;
    error.requestId = body.error?.requestId;
    if (!skipReauth && error.code === "reauthentication_required") {
      await promptForReauthentication();
      return request(path, { ...options, skipReauth: true });
    }
    throw error;
  }
  return body;
}
function setAuthState(state) {
  document.documentElement.dataset.authState = state;
  $("#auth-pending").hidden = state !== "pending";
  $("#login-panel").hidden = state !== "anonymous";
  $("#dashboard").hidden = state !== "authenticated";
  $("#session-actions").hidden = state !== "authenticated";
}
function showLogin() {
  setAuthState("anonymous");
  $("#login-panel").hidden = false;
  $("#dashboard").hidden = true;
  $("#session-actions").hidden = true;
}
function showDashboard() {
  setAuthState("authenticated");
  $("#login-panel").hidden = true;
  $("#dashboard").hidden = false;
  $("#session-actions").hidden = false;
}
async function boot() {
  setAuthState("pending");
  $("#auth-pending-message").textContent = locale === "zh-CN" ? "正在恢复可信设备会话…" : "Restoring trusted-device session…";
  $("#auth-retry").hidden = true;
  applyLocale();
  let session;
  try {
    session = await request("/admin/session");
  } catch (error) {
    if (error.status === 401) return showLogin();
    setAuthState("pending");
    $("#auth-pending-message").textContent = locale === "zh-CN" ? "暂时无法验证会话，请重试。" : "Session verification is temporarily unavailable.";
    $("#auth-retry").hidden = false;
    return;
  }
  $("#admin-role").textContent = session.phone || session.role;
  showDashboard();
  await Promise.all([
    loadSourceStatus(),
    loadResourceMonitoring().catch((error) => setNotice(error.message, true)),
  ]);
}
$("#auth-retry").addEventListener("click", () => boot());

let reauthenticationPromise = null;
function promptForReauthentication() {
  if (reauthenticationPromise) return reauthenticationPromise;
  const dialog = $("#reauth-dialog"), form = $("#reauth-form"), error = $("#reauth-error"), input = form.elements.password, submitButton = form.querySelector("button[type=submit]");
  error.textContent = ""; input.value = ""; submitButton.disabled = false; dialog.showModal(); input.focus();
  reauthenticationPromise = new Promise((resolve, reject) => {
    const cleanup = () => { form.removeEventListener("submit", submit); dialog.removeEventListener("cancel", cancelEvent); dialog.querySelectorAll("[data-reauth-cancel]").forEach((button) => button.removeEventListener("click", cancel)); reauthenticationPromise = null; };
    const cancel = () => { cleanup(); dialog.close(); reject(new Error("reauthentication_cancelled")); };
    const cancelEvent = (event) => { event.preventDefault(); cancel(); };
    const submit = async (event) => {
      event.preventDefault(); submitButton.disabled = true; error.textContent = "";
      try { await request("/admin/reauth", { method: "POST", body: JSON.stringify({ password: input.value }), skipReauth: true }); cleanup(); dialog.close(); resolve(); }
      catch (cause) { error.textContent = cause.message; submitButton.disabled = false; input.select(); }
    };
    form.addEventListener("submit", submit); dialog.addEventListener("cancel", cancelEvent); dialog.querySelectorAll("[data-reauth-cancel]").forEach((button) => button.addEventListener("click", cancel));
  });
  return reauthenticationPromise;
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  $("#login-error").textContent = "";
  if (button) {
    button.disabled = true;
    button.textContent = locale === "zh-CN" ? "登录中…" : "Signing in…";
  }
  try {
    const body = await request("/admin/login", {
      method: "POST",
      body: JSON.stringify({
        phone: $("#admin-phone").value,
        password: $("#admin-password").value,
      }),
    });
    $("#admin-password").value = "";
    $("#admin-role").textContent = body.phone || "system_admin";
    showDashboard();
    await Promise.all([
      loadSourceStatus(),
      loadResourceMonitoring().catch((error) => setNotice(error.message, true)),
    ]);
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = t("login");
    }
  }
});
$("#logout").addEventListener("click", async () => {
  clearTimeout(sourcePollTimer);
  await request("/admin/logout", { method: "POST" }).catch(() => {});
  showLogin();
});
$("#import-local").addEventListener("click", async () => {
  setNotice(locale === "zh-CN" ? "正在导入本机扫描…" : "Importing local scan…");
  try {
    const result = await request("/admin/projects/import-local", {
      method: "POST",
    });
    setNotice(
      `${result.imported} ${locale === "zh-CN" ? "条资源已导入" : "resources imported"}`,
    );
    page = 1;
    await loadProjects();
  } catch (error) {
    setNotice(error.message, true);
  }
});
$("#project-filters").addEventListener("submit", (event) =>
  event.preventDefault(),
);
document
  .querySelectorAll("#project-filters [data-filter] button[data-value]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      const group = button.closest("[data-filter]").dataset.filter,
        values = projectFilters[group],
        value = button.dataset.value;
      if (values.has(value)) values.delete(value);
      else {
        if (group === "deployed" || group === "pinned") values.clear();
        values.add(value);
      }
      button
        .closest("[data-filter]")
        .querySelectorAll("button[data-value]")
        .forEach((node) =>
          node.setAttribute(
            "aria-pressed",
            String(values.has(node.dataset.value)),
          ),
        );
      page = 1;
      loadProjects();
    }),
  );
for (const selector of [
  '#project-filters input[name="q"]',
  '#project-filters input[name="tag"]',
])
  $(selector).addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      page = 1;
      loadProjects();
    }, 180);
  });
$('#project-filters select[name="sort"]').addEventListener("change", () => {
  page = 1;
  loadProjects();
});
$("#previous").addEventListener("click", async () => {
  if (page > 1) {
    page--;
    await loadProjects();
  }
});
$("#next").addEventListener("click", async () => {
  if (page < pages) {
    page++;
    await loadProjects();
  }
});
async function loadProjects() {
  const form = $("#project-filters"),
    query = new URLSearchParams({ page: String(page), per_page: "50" }),
    q = form.elements.namedItem("q").value.trim(),
    tag = form.elements.namedItem("tag").value.trim(),
    sort = form.elements.namedItem("sort").value;
  if (q) query.set("q", q);
  if (tag) query.append("tag", tag.toLowerCase());
  if (sort) query.set("sort", sort);
  for (const [name, values] of Object.entries(projectFilters))
    for (const value of values) query.append(name, value);
  projectRequestController?.abort();
  projectRequestController = new AbortController();
  const controller = projectRequestController;
  document.body.classList.add("projects-loading");
  try {
    const body = await request(`/admin/projects?${query}`, {
      signal: controller.signal,
    });
    if (controller !== projectRequestController) return;
    current = body.data;
    pages = Math.max(body.meta.pages, 1);
    renderRows(current);
    $("#metric-total").textContent = body.meta.total;
    $("#metric-scan").textContent = body.meta.localScanCount;
    $("#metric-pinned").textContent = body.meta.pinnedCount;
    $("#metric-missing").textContent = body.meta.missingCount;
    $("#page-label").textContent = `${page} / ${pages}`;
    $("#previous").disabled = page <= 1;
    $("#next").disabled = page >= pages;
    const browserQuery = new URLSearchParams(query);
    browserQuery.delete("per_page");
    history.replaceState(null, "", `${location.pathname}?${browserQuery}`);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (error.status === 401) return showLogin();
    setNotice(error.message, true);
  } finally {
    if (controller === projectRequestController)
      document.body.classList.remove("projects-loading");
  }
}
function renderRows(items) {
  const rows = $("#project-rows");
  rows.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      locale === "zh-CN"
        ? "没有符合条件的资源。"
        : "No resources match these filters.";
    rows.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = `project-row project-ops-row ${item.pinRank != null ? "is-pinned" : ""}`;
    const identity = document.createElement("div");
    identity.className = "resource-identity";
    const titleLine = document.createElement("div");
    titleLine.className = "title-line";
    const pin = document.createElement("span");
    pin.className = "pin-mark";
    pin.textContent = item.pinRank != null ? "◆" : "◇";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "resource-name-link";
    title.textContent = item.name;
    title.addEventListener("click", () => openEditor(item));
    titleLine.append(pin, title);
    const localPath = document.createElement("a");
    localPath.className = "local-path-link";
    localPath.href = `vscode://file/${encodeURI(item.localPath || item.sourceRef)}`;
    localPath.textContent = item.localPath || item.sourceRef;
    localPath.title =
      locale === "zh-CN"
        ? "在 VS Code 中打开；若未响应可复制路径"
        : "Open in VS Code; copy the path if unavailable";
    localPath.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      navigator.clipboard?.writeText(item.localPath || item.sourceRef);
      setNotice(locale === "zh-CN" ? "路径已复制。" : "Path copied.");
    });
    identity.append(titleLine, localPath);
    const repository = document.createElement("div");
    repository.className = "project-repository";
    if (item.repository?.url || item.repositoryUrl) {
      const url = item.repository?.url || item.repositoryUrl;
      repository.append(externalLink(repositoryName(url), url, "repo-link"));
      const state = document.createElement("small");
      state.textContent = projectRepositoryState(item.repository);
      repository.append(state);
    } else
      repository.append(
        emptyText(
          locale === "zh-CN" ? "未关联 GitHub" : "No GitHub repository",
        ),
      );
    const deployment = document.createElement("div");
    deployment.className = "project-deployments";
    if (item.deployments?.length) {
      for (const value of item.deployments) {
        const line = document.createElement("div");
        line.className = "project-deployment-line";
        const server = document.createElement("button");
        server.type = "button";
        server.className = "server-inline-link";
        server.textContent = value.server?.name || "server";
        server.addEventListener("click", () => openServer(value.server?.id));
        line.append(
          server,
          value.url
            ? externalLink(value.url, value.url, "url-link")
            : emptyText(locale === "zh-CN" ? "未登记 URL" : "No URL"),
          statusBadge(value.healthStatus || "unverified"),
        );
        deployment.append(line);
      }
    } else
      deployment.append(
        emptyText(locale === "zh-CN" ? "未部署" : "Not deployed"),
      );
    const updated = document.createElement("div");
    updated.className = "time-stack";
    const source = document.createElement("strong"),
      scan = document.createElement("span");
    source.textContent = formatDateTime(
      item.repository?.pushedAt || item.sourceUpdatedAt || item.updatedAt,
    );
    scan.textContent = `${locale === "zh-CN" ? "扫描" : "Scan"} ${formatDateTime(item.lastScannedAt)}`;
    updated.append(source, scan);
    const ops = document.createElement("div");
    ops.className = "ops-stack project-actions";
    for (const value of [
      ...(item.resourceTypes || []),
      ...(item.tags || []),
    ].slice(0, 5))
      ops.append(
        filterChip(
          value,
          (item.resourceTypes || []).includes(value) ? "type" : "tag",
        ),
      );
    ops.append(filterChip(item.status, "status"));
    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "manage-compact";
    manage.textContent = locale === "zh-CN" ? "管理" : "Manage";
    manage.addEventListener("click", () => openEditor(item));
    ops.append(manage);
    row.append(identity, repository, deployment, updated, ops);
    rows.append(row);
  }
}
function chip(value) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = value;
  return span;
}
function filterChip(value, group) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip chip-action";
  button.textContent = value;
  button.addEventListener("click", () => {
    if (group === "tag") $("#project-filters input[name=tag]").value = value;
    else {
      projectFilters[group].add(value);
      document
        .querySelector(
          `#project-filters [data-filter="${group}"] [data-value="${CSS.escape(value)}"]`,
        )
        ?.setAttribute("aria-pressed", "true");
    }
    page = 1;
    loadProjects();
  });
  return button;
}
function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}
function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function emptyText(value) {
  const span = document.createElement("span");
  span.className = "muted-text";
  span.textContent = value;
  return span;
}
function statusBadge(value) {
  const span = document.createElement("span");
  span.className = `health-badge health-${String(value).replace(/[^a-z_]/g, "")}`;
  span.textContent = value;
  return span;
}
function projectRepositoryState(repository) {
  if (!repository) return locale === "zh-CN" ? "未验证" : "Unverified";
  const githubHead = repository.metadata?.headSha;
  if (repository.headSha && githubHead)
    return repository.headSha === githubHead
      ? `${locale === "zh-CN" ? "GitHub 最新" : "GitHub current"} / ${String(repository.headSha).slice(0, 10)}`
      : `${locale === "zh-CN" ? "需要同步" : "Sync required"} / ${String(repository.headSha).slice(0, 7)} / ${String(githubHead).slice(0, 7)}`;
  if (Number(repository.ahead) > 0 || Number(repository.behind) > 0)
    return `${locale === "zh-CN" ? "待同步" : "Sync needed"} +${repository.ahead || 0}/-${repository.behind || 0}`;
  const head = String(repository.headSha || "").slice(0, 10);
  return `${repository.branch || "-"} / ${head || (locale === "zh-CN" ? "未验证" : "Unverified")}`;
}
async function openEditor(item) {
  activeProject = item;
  $("#editor-id").value = item.id;
  $("#editor-title").textContent = item.name;
  $("#editor-source").textContent = item.sourceRef;
  $("#editor-description").value = item.description || "";
  $("#editor-status").value = item.status;
  $("#editor-visibility").value = item.visibility;
  $("#editor-tags").value = (item.tags || []).join(", ");
  $("#editor-pinned").checked = item.pinRank != null;
  $("#editor-rank").value = item.pinRank || 100;
  switchTab("overview");
  $("#editor").showModal();
  await Promise.all([
    loadDeployments(),
    loadBackups(),
    loadDocument("content_md"),
    loadDocument("codebase_map"),
    loadProjectBenchmarks(),
    loadProjectReview(),
  ]);
}
document
  .querySelectorAll("[data-tab]")
  .forEach((button) =>
    button.addEventListener("click", () => switchTab(button.dataset.tab)),
  );
function switchTab(tab) {
  document
    .querySelectorAll("[data-tab]")
    .forEach((node) =>
      node.classList.toggle("active", node.dataset.tab === tab),
    );
  document
    .querySelectorAll("[data-panel]")
    .forEach((node) =>
      node.classList.toggle("active", node.dataset.panel === tab),
    );
}
async function saveProject() {
  const id = activeProject.id;
  try {
    await request(`/admin/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        description: $("#editor-description").value.trim() || null,
        status: $("#editor-status").value,
        visibility: $("#editor-visibility").value,
      }),
    });
    const tags = $("#editor-tags")
      .value.split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    await request(`/admin/resources/${encodeURIComponent(id)}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    });
    if ($("#editor-pinned").checked)
      await request(`/admin/resources/${encodeURIComponent(id)}/pin`, {
        method: "PUT",
        body: JSON.stringify({ rank: Number($("#editor-rank").value) || 100 }),
      });
    else
      await request(`/admin/resources/${encodeURIComponent(id)}/pin`, {
        method: "DELETE",
      });
    $("#editor").close();
    setNotice(locale === "zh-CN" ? "资源已更新。" : "Resource updated.");
    await loadProjects();
  } catch (error) {
    setNotice(error.message, true);
  }
}
$("#save-project").addEventListener("click", saveProject);
function populateServerOptions(items) {
  serverOptions = items;
  const select = $("#deployment-server");
  select.replaceChildren();
  items.forEach((server) => {
    const option = document.createElement("option");
    option.value = server.id;
    option.textContent = `${server.name} / ${server.effective_status || "unverified"}`;
    select.append(option);
  });
}
async function loadServerOptions() {
  const body = await request("/admin/servers?compact=1");
  populateServerOptions(body.data || []);
}
async function loadServers() {
  const [body, monitor] = await Promise.all([
    request("/admin/servers"),
    request("/admin/monitor/summary").catch(() => ({ data: null })),
  ]);
  servers = body.data;
  billingSummary = body.meta?.billing || null;
  monitorSummary = monitor.data;
  populateServerOptions(servers);
  renderServers();
  await loadIncidentInbox();
  await loadExpiringResources();
}
async function loadIncidentInbox() {
  const target = $("#incident-inbox-list"), summary = $("#incident-inbox-summary");
  if (!target) return;
  try {
    const body = await request("/api/admin/v1/incidents?status=open&limit=20"), items = body.data || [];
    target.replaceChildren();
    summary.textContent = locale === "zh-CN" ? `${items.length} 个未恢复事件` : `${items.length} open incidents`;
    if (!items.length) {
      const empty = document.createElement("p"); empty.className = "incident-empty"; empty.textContent = locale === "zh-CN" ? "当前没有需要处理的事件。" : "No incidents need attention."; target.append(empty); return;
    }
    for (const incident of items) {
      const card = document.createElement("article"); card.className = "incident-card"; card.dataset.severity = incident.severity || "p3";
      const severity = document.createElement("strong"); severity.className = "incident-severity"; severity.textContent = String(incident.severity || "p3").toUpperCase();
      const content = document.createElement("div"), title = document.createElement("h3"), detail = document.createElement("p");
      title.textContent = incident.title || incident.entity_id || "Incident"; detail.textContent = `${incident.summary || ""} · ${formatDateTime(incident.last_detected_at)}`; content.append(title, detail);
      const acknowledge = document.createElement("button"); acknowledge.type = "button"; acknowledge.textContent = locale === "zh-CN" ? "确认" : "Acknowledge"; acknowledge.dataset.incidentId = incident.id; acknowledge.dataset.incidentVersion = incident.version;
      card.append(severity, content, acknowledge); target.append(card);
    }
  } catch (error) {
    summary.textContent = locale === "zh-CN" ? "事件读取失败" : "Incident feed unavailable";
    target.replaceChildren(); const empty = document.createElement("p"); empty.className = "incident-empty"; empty.textContent = error.message; target.append(empty);
  }
}
$("#incident-inbox-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-incident-id]"); if (!button) return;
  button.disabled = true;
  try { await request(`/api/admin/v1/incidents/${encodeURIComponent(button.dataset.incidentId)}`, { method: "PATCH", body: JSON.stringify({ version: Number(button.dataset.incidentVersion), status: "acknowledged" }) }); await loadIncidentInbox(); } catch (error) { setNotice(error.message, true); button.disabled = false; }
});
async function loadResourceMonitoring() {
  await Promise.all([loadServers(), loadApiProviders()]);
}

async function switchResourceView(view) {
  resourceView = view;
  document.querySelectorAll("#resource-view-tabs [data-resource-view]").forEach((button) => {
    const active = button.dataset.resourceView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("#servers-view [data-resource-panel]").forEach((panel) => {
    const target = panel.dataset.resourcePanel;
    panel.hidden = target === "cloud" ? !["endpoints", "storage"].includes(view) : target !== view;
  });
  if (view === "servers" && !servers.length) await loadServers();
  if (view === "api") await loadApiProviders();
  if (["endpoints", "storage"].includes(view)) {
    const heading = $("#cloud-resource-title");
    heading.textContent = view === "endpoints" ? t("domainsEndpoints") : t("storageCloudAssets");
    const allowedKinds = new Set(view === "endpoints" ? ["", "dns_domain", "chain_domain", "dns_record", "edgeone_zone", "worker", "pages_project"] : ["", "cos_bucket", "r2_bucket", "kv_namespace", "d1_database", "cbs_disk", "billing_account", "billing_resource"]);
    const kindSelect = $("#cloud-filters select[name=kind]");
    if (!allowedKinds.has(kindSelect.value)) kindSelect.value = "";
    for (const option of kindSelect.options) option.hidden = !allowedKinds.has(option.value);
    cloudPage = 1;
    await Promise.all([loadAssetSummary(), loadCloudAssets()]);
  }
}
document.querySelectorAll("#resource-view-tabs [data-resource-view]").forEach((button) => button.addEventListener("click", () => {
  switchResourceView(button.dataset.resourceView).catch((error) => setNotice(error.message, true));
}));
function switchWorkspace(view) {
  const normalizedView = view === "cloud" ? "servers" : view;
  for (const name of ["tasks", "projects", "servers", "repositories"]) {
    $("#" + name + "-view").hidden = name !== normalizedView;
    document
      .querySelector(`[data-view="${name}"]`)
      ?.classList.toggle("active", name === normalizedView);
  }
  if (normalizedView === "tasks") window.loadTaskWorkspace?.();
  if (normalizedView === "projects")
    loadProjects().catch((error) => setNotice(error.message, true));
  if (normalizedView === "servers")
    loadResourceMonitoring().catch((error) =>
      setNotice(error.message, true),
    );
  if (normalizedView === "repositories")
    Promise.all([loadAssetSummary(), loadRepositoryAssets()]).catch((error) =>
      setNotice(error.message, true),
    );
}
$("#manage-tasks").addEventListener("click", () => switchWorkspace("tasks"));
$("#manage-projects").addEventListener("click", () =>
  switchWorkspace("projects"),
);
$("#manage-servers").addEventListener("click", () =>
  switchWorkspace("servers"),
);
$("#manage-repositories").addEventListener("click", () =>
  switchWorkspace("repositories"),
);
$("#manage-reviews").addEventListener("click", async () => {
  await loadReviewSummary();
  $("#reviews-dialog").showModal();
});
$("#start-incremental-review").addEventListener("click", () =>
  requestReviewRun("incremental"),
);
$("#start-full-review").addEventListener("click", () =>
  requestReviewRun("full"),
);
$("#request-project-review").addEventListener("click", () =>
  requestReviewRun("incremental", activeProject?.id),
);
async function requestReviewRun(mode, projectId = null) {
  try {
    const body = await request("/admin/repository-reviews/runs", {
      method: "POST",
      body: JSON.stringify({ mode, projectId }),
    });
    setNotice(
      `${locale === "zh-CN" ? "审查请求已登记" : "Review requested"}: ${body.command}`,
    );
    if ($("#reviews-dialog").open) await loadReviewSummary();
  } catch (error) {
    setNotice(error.message, true);
  }
}
async function loadReviewSummary() {
  const body = await request("/admin/repository-reviews");
  const data = body.data,
    items = [
      {
        title: `${data.snapshots?.count || 0} repositories`,
        detail: `${data.snapshots?.dirty || 0} dirty · ${data.snapshots?.missing_remote || 0} missing remote`,
      },
      {
        title: `${data.reviews?.count || 0} reviews`,
        detail: `${data.reviews?.cache_hits || 0} cache hits · ${data.reviews?.input_tokens || 0}/${data.reviews?.output_tokens || 0} tokens`,
      },
      {
        title: `${data.pendingCandidates || 0} pending candidates`,
        detail: data.runs?.[0]
          ? `${data.runs[0].mode} · ${data.runs[0].status}`
          : "no scan runs",
      },
    ];
  renderSubList(
    $("#review-summary"),
    items,
    (item) => item.title,
    (item) => item.detail,
  );
}
async function loadProjectReview() {
  const target = $("#project-review");
  try {
    const body = await request(
        `/admin/repository-reviews/projects/${encodeURIComponent(activeProject.id)}`,
      ),
      snapshot = body.data.snapshot,
      reviews = body.data.reviews;
    const items = [
      {
        title: snapshot.canonical_key,
        detail: `${snapshot.branch || "detached"} · ${snapshot.head_sha?.slice(0, 10) || "no SHA"} · ${snapshot.dirty ? "dirty" : "clean"}`,
      },
      ...reviews.map((review) => ({
        title: `${review.status} · ${Math.round((review.confidence || 0) * 100)}%`,
        detail: `${formatDate(review.reviewed_at)} · ${review.cache_hit ? "cache hit" : review.fingerprint.slice(0, 10)}`,
      })),
    ];
    renderSubList(
      target,
      items,
      (item) => item.title,
      (item) => item.detail,
    );
  } catch (error) {
    target.replaceChildren();
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      error.status === 404
        ? locale === "zh-CN"
          ? "尚未生成仓库档案。"
          : "No repository dossier yet."
        : error.message;
    target.append(p);
  }
}
function repositoryName(url) {
  if (!url) return locale === "zh-CN" ? "未关联仓库" : "No repository";
  try {
    const parts = new URL(url).pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    return parts.slice(-2).join("/") || url;
  } catch {
    return url;
  }
}
function githubState(deployment) {
  if (!deployment.repository_url && !deployment.backup_repository_url)
    return locale === "zh-CN" ? "未关联 GitHub" : "No GitHub link";
  let metadata = {};
  try {
    metadata = JSON.parse(deployment.github_metadata || "{}");
  } catch {}
  const githubHead = metadata.headSha;
  if (deployment.github_head_sha && githubHead) {
    if (deployment.github_head_sha === githubHead)
      return `${locale === "zh-CN" ? "GitHub 最新" : "GitHub current"} / ${String(githubHead).slice(0, 10)}`;
    return `${locale === "zh-CN" ? "需要同步" : "Sync required"} / local ${String(deployment.github_head_sha).slice(0, 7)} / GitHub ${String(githubHead).slice(0, 7)}`;
  }
  if (deployment.repository_ahead > 0 || deployment.repository_behind > 0)
    return locale === "zh-CN"
      ? `待同步 +${deployment.repository_ahead || 0}/-${deployment.repository_behind || 0}`
      : `Sync needed +${deployment.repository_ahead || 0}/-${deployment.repository_behind || 0}`;
  if (
    deployment.backup_status === "verified" ||
    deployment.backup_status === "current"
  )
    return locale === "zh-CN" ? "GitHub 已验证" : "GitHub verified";
  if (deployment.github_pushed_at)
    return `${locale === "zh-CN" ? "最近 push" : "Last push"} ${formatDate(deployment.github_pushed_at)}`;
  return locale === "zh-CN" ? "GitHub 待验证" : "GitHub unverified";
}
function fleetState(server) {
  const state = String(server.effective_status || "unverified").toLowerCase();
  if (["healthy", "reachable", "online", "active"].includes(state))
    return "healthy";
  if (
    ["degraded", "recovering", "stale", "warning", "maintenance"].includes(
      state,
    )
  )
    return "unknown";
  return "attention";
}
function runtimeHost(server) {
  return (
    (server.runtime_assets || []).find(
      (asset) => asset.kind === "server_runtime",
    )?.metadata || null
  );
}
function ratio(value, total) {
  const numerator = Number(value || 0),
    denominator = Number(total || 0);
  return denominator > 0
    ? Math.max(0, Math.min(1, numerator / denominator))
    : null;
}
function capacityTone(value) {
  return value === null
    ? ""
    : value >= 0.9
      ? "is-danger"
      : value >= 0.75
        ? "is-warning"
        : "";
}
function capacitySpec(server, host) {
  const cpu = numericCpu(server.cpu) || numericCpu(host?.cpuCount);
  return `${serverClass(server)} · ${cpu > 0 ? `${cpu} vCPU` : "CPU -"}`;
}
function capacitySize(server, host, dimension) {
  if (dimension === "RAM") {
    const memoryMb = Number(server.memory_mb || 0) || Number(host?.memoryTotalKb || 0) / 1024;
    return compactServerSize(memoryMb / 1024, "G");
  }
  const diskGb = Number(server.disk_gb || 0) || Number(host?.diskTotalBytes || 0) / 1024 / 1024 / 1024;
  return compactServerSize(diskGb, "G");
}
function activeRuntimeAsset(item) {
  const metadata = item.metadata || {};
  const state = String(metadata.health || metadata.state || item.status || "").toLowerCase();
  return /(healthy|running|up|active|reachable|available)/.test(state) && !/(down|error|unhealthy|exited|dead|unreachable|stale|expired)/.test(state);
}
function compactServerSize(value, unit) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  const rounded =
    number >= 10 ? Math.round(number) : Math.round(number * 10) / 10;
  return `${rounded}${unit}`;
}
function serverClass(server) {
  const provider = String(server.provider || "").toLowerCase();
  if (provider.includes("lighthouse"))
    return locale === "zh-CN" ? "腾讯轻量" : "Tencent Lighthouse";
  if (provider.includes("cvm"))
    return locale === "zh-CN" ? "腾讯 CVM" : "Tencent CVM";
  if (provider.includes("tencent"))
    return locale === "zh-CN" ? "腾讯云" : "Tencent Cloud";
  return server.provider || "-";
}
function numericCpu(value) {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = String(value || "").match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : 0;
}
function serverSpec(server) {
  const host = runtimeHost(server) || {},
    cpu = numericCpu(server.cpu) || numericCpu(host.cpuCount),
    memoryMb =
      Number(server.memory_mb || 0) || Number(host.memoryTotalKb || 0) / 1024,
    diskGb =
      Number(server.disk_gb || 0) ||
      Number(host.diskTotalBytes || 0) / 1024 / 1024 / 1024;
  return `${serverClass(server)} · ${cpu > 0 ? `${cpu} vCPU` : "CPU -"} · ${compactServerSize(memoryMb / 1024, "G")} RAM · ${compactServerSize(diskGb, "G")}`;
}
function serverHardwareSpec(server) {
  const host = runtimeHost(server) || {},
    cpu = numericCpu(server.cpu) || numericCpu(host.cpuCount),
    memoryMb = Number(server.memory_mb || 0) || Number(host.memoryTotalKb || 0) / 1024,
    diskGb = Number(server.disk_gb || 0) || Number(host.diskTotalBytes || 0) / 1024 / 1024 / 1024;
  return `${cpu > 0 ? `${cpu} vCPU` : "CPU -"} · ${compactServerSize(memoryMb / 1024, "G")} RAM · ${compactServerSize(diskGb, "G")}`;
}
function dueState(server) {
  const dueAt = server.due_at ? new Date(server.due_at).getTime() : NaN;
  if (!Number.isFinite(dueAt)) return "";
  const days = (dueAt - Date.now()) / 86400000;
  return days < 0 ? "is-danger" : days <= 30 ? "is-warning" : "";
}
function dueLabel(server) {
  return server.due_at
    ? `${locale === "zh-CN" ? "到期" : "Due"} ${formatDate(server.due_at)}`
    : locale === "zh-CN"
      ? "未登记到期日"
      : "No due date";
}
function appendFleetCount(target, count, label, state) {
  const item = document.createElement("span"),
    number = document.createElement("strong"),
    text = document.createElement("span");
  item.className = `fleet-status-count is-${state}`;
  number.textContent = count;
  text.textContent = label;
  item.append(number, text);
  target.append(item);
}
function appendCoverageStat(target, value, label) {
  const item = document.createElement("div"),
    term = document.createElement("dt"),
    definition = document.createElement("dd");
  term.textContent = label;
  definition.textContent = value;
  item.append(term, definition);
  target.append(item);
}
function renderFleetOverview(allDeployments, allRuntime) {
  const distribution = $("#fleet-status-distribution"),
    availability = $("#fleet-availability-grid"),
    capacity = $("#fleet-capacity-list"),
    coverage = $("#fleet-coverage-stats"),
    board = $("#fleet-server-board");
  distribution.replaceChildren();
  availability.replaceChildren();
  capacity.replaceChildren();
  coverage.replaceChildren();
  board.replaceChildren();
  const groups = { healthy: [], unknown: [], attention: [] };
  for (const server of servers) groups[fleetState(server)].push(server);
  appendFleetCount(
    distribution,
    groups.healthy.length,
    locale === "zh-CN" ? "健康" : "healthy",
    "healthy",
  );
  appendFleetCount(
    distribution,
    groups.unknown.length,
    locale === "zh-CN" ? "待确认" : "needs review",
    "unknown",
  );
  appendFleetCount(
    distribution,
    groups.attention.length,
    locale === "zh-CN" ? "需处理" : "needs attention",
    "attention",
  );
  const scanned = servers.filter(
    (server) => server.runtime_coverage?.status === "scanned",
  ).length;
  $("#fleet-health-summary").textContent =
    locale === "zh-CN"
      ? `${scanned}/${servers.length} 台已完成运行时采集`
      : `${scanned}/${servers.length} servers have a runtime snapshot`;
  const observedBilling = servers.filter((server) => server.billing?.status === "observed"),
    observedTotal = observedBilling.reduce((sum, server) => sum + Number(server.billing?.monthlyCostCNY || 0), 0),
    billingLabel = $("#fleet-billing-summary");
  if (billingLabel) {
    if (billingSummary?.status === "available") {
      const balance = Number(billingSummary.balanceCNY),
        balanceText = Number.isFinite(balance) ? ` · ${locale === "zh-CN" ? "余额" : "balance"} ¥${balance.toFixed(2)}` : "";
      billingLabel.textContent = `${locale === "zh-CN" ? "账单快照" : "Billing snapshot"} ${billingSummary.month || "-"} · ${observedBilling.length}/${servers.length} ${locale === "zh-CN" ? "台已关联" : "servers linked"} · ¥${observedTotal.toFixed(2)}${balanceText}`;
    } else {
      billingLabel.textContent = locale === "zh-CN" ? "账单未验证 · 容量建议不包含价格推断" : "Billing unverified · capacity guidance excludes price assumptions";
    }
  }
  for (const server of servers) {
    const tile = document.createElement("a"),
      state = fleetState(server),
      coverage = server.runtime_coverage || {};
    tile.className = `fleet-server-tile is-${state}`;
    tile.href = `#server-${server.id}`;
    tile.setAttribute(
      "aria-label",
      `${server.name}: ${server.effective_status || "unverified"}. ${serverSpec(server)}. ${dueLabel(server)}`,
    );
    const name = document.createElement("strong"),
      details = document.createElement("small"),
      due = document.createElement("small");
    name.textContent = server.name;
    details.textContent = `${coverage.service_count || 0} ${locale === "zh-CN" ? "服务" : "services"} / ${coverage.container_count || 0} containers`;
    due.className = `fleet-server-due ${dueState(server)}`;
    due.textContent = dueLabel(server);
    tile.append(name, details, due);
    availability.append(tile);
    board.append(renderFleetServerRecord(server));
  }
  const capacities = servers
    .map((server) => {
      const host = runtimeHost(server);
      if (!host) return null;
      const memoryUsed =
        Math.max(
          0,
          Number(host.memoryTotalKb || 0) - Number(host.memoryAvailableKb || 0),
        ) * 1024;
      const memory = ratio(memoryUsed, Number(host.memoryTotalKb || 0) * 1024),
        disk = ratio(host.diskUsedBytes, host.diskTotalBytes),
        load = ratio(host.load1, host.cpuCount);
      return {
        server,
        host,
        memory,
        disk,
        load,
        risk: Math.max(memory || 0, disk || 0, load || 0),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.risk - left.risk);
  $("#fleet-capacity-summary").textContent = capacities.length
    ? locale === "zh-CN"
      ? `按最高资源使用率排序，${capacities.length} 台有采样。`
      : `Sorted by highest measured utilisation across ${capacities.length} servers.`
    : locale === "zh-CN"
      ? "暂无主机容量采样。"
      : "No host capacity snapshots yet.";
  if (!capacities.length) {
    const empty = document.createElement("p");
    empty.className = "fleet-capacity-empty";
    empty.textContent =
      locale === "zh-CN"
        ? "运行时扫描完成后会显示内存、磁盘和负载。"
        : "Memory, disk, and load appear after a runtime scan.";
    capacity.append(empty);
  }
  for (const item of capacities.slice(0, 6)) {
    const row = document.createElement("div"),
      identity = document.createElement("div"),
      measures = document.createElement("div"),
      link = document.createElement("a"),
      detail = document.createElement("small");
    row.className = "fleet-capacity-row";
    identity.className = "fleet-capacity-name";
    link.href = `#server-${item.server.id}`;
    link.textContent = item.server.name;
    detail.textContent = `${capacitySpec(item.server, item.host)} · load ${item.host.load1 ?? "-"}`;
    identity.append(link, detail);
    for (const [label, value, detailText] of [
      [
        "RAM",
        item.memory,
        `${formatBytes(Math.max(0, Number(item.host.memoryTotalKb || 0) - Number(item.host.memoryAvailableKb || 0)) * 1024)} / ${formatBytes(Number(item.host.memoryTotalKb || 0) * 1024)}`,
      ],
      [
        "Disk",
        item.disk,
        `${formatBytes(item.host.diskUsedBytes || 0)} / ${formatBytes(item.host.diskTotalBytes || 0)}`,
      ],
    ]) {
      if (value === null) continue;
      const measure = document.createElement("div"),
        caption = document.createElement("span"),
        meter = document.createElement("meter"),
        percent = document.createElement("span");
      measure.className = `fleet-capacity-measure ${capacityTone(value)}`;
      caption.textContent = `${label} ${capacitySize(item.server, item.host, label)}`;
      meter.min = 0;
      meter.max = 1;
      meter.value = value;
      meter.setAttribute(
        "aria-label",
        `${item.server.name} ${label} ${detailText}`,
      );
      percent.textContent = `${Math.round(value * 100)}%`;
      measure.append(caption, meter, percent);
      measures.append(measure);
    }
    row.append(identity, measures);
    capacity.append(row);
  }
  const linkedRepositories = [
      ...allDeployments.filter(
        (item) => item.repository_url || item.backup_repository_url,
      ),
      ...allRuntime.filter((item) => item.repository?.url),
    ].length,
    dnsRecords = servers.reduce(
      (sum, server) => sum + (server.dns_records?.length || 0),
      0,
    );
  appendCoverageStat(
    coverage,
    allRuntime.length,
    locale === "zh-CN" ? "发现服务" : "discovered services",
  );
  appendCoverageStat(
    coverage,
    servers.reduce(
      (sum, server) => sum + (server.runtime_coverage?.container_count || 0),
      0,
    ),
    locale === "zh-CN" ? "运行容器" : "runtime containers",
  );
  appendCoverageStat(
    coverage,
    linkedRepositories,
    locale === "zh-CN" ? "已关联仓库" : "linked repositories",
  );
  appendCoverageStat(
    coverage,
    dnsRecords,
    locale === "zh-CN" ? "关联 DNS" : "linked DNS",
  );
  $("#fleet-coverage-summary").textContent =
    locale === "zh-CN"
      ? "仅计算确定性项目、仓库和 IP 匹配；未确认关联不会自动写入。"
      : "Only deterministic project, repository, and IP matches are included; uncertain links stay unlinked.";
}

function serverCloudAsset(server) {
  return (server.runtime_assets || []).find((asset) => ["cvm", "lighthouse"].includes(String(asset.kind)));
}

function serverBandwidth(server) {
  const metadata = serverCloudAsset(server)?.metadata || {};
  const value = Number(metadata.bandwidthMbps ?? metadata.internetMaxBandwidthOut ?? metadata.bandwidth ?? 0);
  return Number.isFinite(value) && value > 0 ? value + " Mbps" : locale === "zh-CN" ? "未采集" : "Not collected";
}

function loadMeaning(server, host) {
  const raw = Number(host?.load1);
  if (!Number.isFinite(raw)) return locale === "zh-CN" ? "Load 未采集" : "Load not collected";
  const cpu = numericCpu(server.cpu) || numericCpu(host?.cpuCount);
  return cpu > 0
    ? (locale === "zh-CN" ? "负载 " : "Load ") + raw.toFixed(2) + " · " + (locale === "zh-CN" ? "1 分钟平均可运行任务数 / " : "1-minute runnable-task average / ") + cpu + " vCPU"
    : (locale === "zh-CN" ? "负载 " : "Load ") + raw.toFixed(2) + " · " + (locale === "zh-CN" ? "1 分钟平均可运行任务数" : "1-minute runnable-task average");
}

function appendFleetMetric(target, label, value, detail, tone = "") {
  const row = document.createElement("div"), heading = document.createElement("div"), name = document.createElement("span"), amount = document.createElement("strong"), meter = document.createElement("meter"), note = document.createElement("small");
  row.className = "fleet-record-metric " + tone;
  heading.className = "fleet-record-metric-head";
  name.textContent = label;
  amount.textContent = value === null ? "-" : Math.round(value * 100) + "%";
  heading.append(name, amount);
  meter.min = 0; meter.max = 1; meter.value = value === null ? 0 : value; meter.setAttribute("aria-label", label + " " + detail);
  note.textContent = detail;
  row.append(heading, meter, note);
  target.append(row);
}

function renderFleetServerRecord(server) {
  const record = document.createElement("article"), state = fleetState(server), coverage = server.runtime_coverage || {}, host = runtimeHost(server), header = document.createElement("header"), identity = document.createElement("div"), name = document.createElement("a"), meta = document.createElement("p"), summary = document.createElement("div"), body = document.createElement("div"), profile = document.createElement("section"), operations = document.createElement("section");
  record.className = "fleet-server-record is-" + state;
  record.id = "server-" + server.id;
  name.href = "#server-" + server.id; name.textContent = server.name; name.className = "fleet-record-name";
  meta.className = "fleet-record-meta";
  meta.textContent = serverClass(server) + " · " + (server.region || (locale === "zh-CN" ? "地域未采集" : "Region not collected")) + " · " + (server.architecture || "-") + " · " + (server.ip_address || (locale === "zh-CN" ? "IP 未公开" : "IP private"));
  const due = document.createElement("small"); due.className = "fleet-record-due " + dueState(server); due.textContent = dueLabel(server);
  identity.append(name, meta, due);
  summary.className = "fleet-record-summary";
  const stats = [[locale === "zh-CN" ? "部署" : "Deployments", server.deployments?.length || 0], [locale === "zh-CN" ? "服务" : "Services", coverage.service_count || 0], [locale === "zh-CN" ? "容器" : "Containers", coverage.container_count || 0], ["DNS", server.dns_records?.length || 0]];
  for (const [label, value] of stats) { const stat = document.createElement("span"), count = document.createElement("strong"), caption = document.createElement("small"); count.textContent = value; caption.textContent = label; stat.append(count, caption); summary.append(stat); }
  header.className = "fleet-record-head"; header.append(identity, summary, statusBadge(server.effective_status || "unverified"));

  profile.className = "fleet-record-profile fleet-record-section";
  const profileTitle = document.createElement("h3"); profileTitle.textContent = locale === "zh-CN" ? "基本信息与性能" : "Profile & performance"; profile.append(profileTitle);
  const facts = document.createElement("div"); facts.className = "fleet-record-facts";
  const factValues = [[locale === "zh-CN" ? "类型" : "Type", serverClass(server)], [locale === "zh-CN" ? "规格" : "Spec", serverHardwareSpec(server)], [locale === "zh-CN" ? "带宽" : "Bandwidth", serverBandwidth(server)], [locale === "zh-CN" ? "系统" : "OS", server.operating_system || "-"]];
  for (const [label, value] of factValues) { const fact = document.createElement("div"), key = document.createElement("small"), val = document.createElement("strong"); key.textContent = label; val.textContent = value; fact.append(key, val); facts.append(fact); }
  profile.append(facts);
  const meters = document.createElement("div"); meters.className = "fleet-record-metrics";
  if (host) {
    const memoryTotal = Number(host.memoryTotalKb || 0) * 1024, memoryUsed = Math.max(0, Number(host.memoryTotalKb || 0) - Number(host.memoryAvailableKb || 0)) * 1024, diskTotal = Number(host.diskTotalBytes || 0), diskUsed = Number(host.diskUsedBytes || 0), load = ratio(host.load1, numericCpu(server.cpu) || numericCpu(host.cpuCount)), memoryRatio = ratio(memoryUsed, memoryTotal), diskRatio = ratio(diskUsed, diskTotal);
    appendFleetMetric(meters, "RAM", memoryRatio, formatBytes(memoryUsed) + " / " + formatBytes(memoryTotal), capacityTone(memoryRatio));
    appendFleetMetric(meters, "Disk", diskRatio, formatBytes(diskUsed) + " / " + formatBytes(diskTotal), capacityTone(diskRatio));
    appendFleetMetric(meters, locale === "zh-CN" ? "负载" : "Load", load, loadMeaning(server, host), capacityTone(load));
  } else {
    const empty = document.createElement("p"); empty.className = "fleet-record-empty"; empty.textContent = locale === "zh-CN" ? "尚无近期运行时采样，性能数据不可判定。" : "No recent runtime sample; performance cannot be determined."; meters.append(empty);
  }
  profile.append(meters);
  const recommendation = serverRecommendation(server), advice = document.createElement("div"), adviceHead = document.createElement("div"), adviceBadge = document.createElement("strong"), billing = document.createElement("span"), adviceReason = document.createElement("p"), billingRecords = server.billing?.records || [], billingLastSeen = billingRecords.map((item) => item.lastSeenAt).filter(Boolean).sort().at(-1);
  advice.className = `fleet-record-advice is-${recommendation.tone}`;
  adviceHead.className = "fleet-record-advice-head";
  adviceBadge.textContent = recommendation.label;
  billing.textContent = server.billing?.status === "observed"
    ? `${locale === "zh-CN" ? "历史账单" : "Observed bill"} ¥${Number(server.billing.monthlyCostCNY || 0).toFixed(2)} · ${server.billing.month || "-"}${billingLastSeen ? ` · ${formatDateTime(billingLastSeen)}` : ""}`
    : (locale === "zh-CN" ? "账单未关联" : "Billing not linked");
  adviceReason.textContent = recommendation.reason;
  adviceHead.append(adviceBadge, billing); advice.append(adviceHead, adviceReason); profile.append(advice);

  operations.className = "fleet-record-operations";
  const deployBlock = document.createElement("section"), deployTitle = document.createElement("h3"); deployBlock.className = "fleet-record-section fleet-record-deployments"; deployTitle.textContent = locale === "zh-CN" ? "部署与关联仓库" : "Deployments & repositories"; deployBlock.append(deployTitle, renderRegisteredDeployments(server));
  operations.append(deployBlock, renderFleetServices(server), renderServerDns(server));
  body.className = "fleet-record-body"; body.append(profile, operations); record.append(header, body);
  return record;
}

function renderFleetServices(server) {
  const section = document.createElement("section"), heading = document.createElement("div"), title = document.createElement("h3"), note = document.createElement("p"), assets = server.runtime_assets || [], containers = assets.filter((item) => ["container", "runtime_container"].includes(item.kind)), projects = (server.runtime_projects || []).map((project) => ({ ...project, containers: containers.filter((container) => (container.metadata?.composeProject || container.name) === project.name) }));
  section.className = "fleet-record-section fleet-record-services";
  heading.className = "fleet-project-usage-heading";
  title.textContent = (locale === "zh-CN" ? "项目资源归因" : "Project resource attribution") + " · " + projects.length;
  note.textContent = locale === "zh-CN" ? "CPU 为瞬时采样；网络与块 I/O 为容器启动后累计；空间仅含容器可写层。" : "CPU is sampled; network and block I/O are cumulative since start; space is container writable layer only.";
  heading.append(title, note); section.append(heading);
  if (!projects.length) { const empty = document.createElement("p"); empty.className = "fleet-record-empty"; empty.textContent = locale === "zh-CN" ? "暂无可归因的运行项目。" : "No runtime project can be attributed yet."; section.append(empty); return section; }
  const list = document.createElement("div"); list.className = "fleet-project-usage-list";
  for (const project of projects) list.append(renderProjectUsage(project));
  section.append(list); return section;
}

function renderProjectUsage(project) {
  const row = document.createElement("article"), head = document.createElement("div"), identity = document.createElement("div"), name = project.url ? externalLink(project.name, project.url, "url-link") : plainStrong(project.name), status = document.createElement("span"), meta = document.createElement("small"), measures = document.createElement("div"), activity = document.createElement("div");
  row.className = `fleet-project-usage is-${project.status || "unavailable"}`;
  head.className = "fleet-project-usage-head"; identity.className = "fleet-project-identity"; status.className = `fleet-project-observation is-${project.status || "unavailable"}`;
  status.textContent = project.status === "observed" ? (locale === "zh-CN" ? "已采样" : "Observed") : project.status === "partial" ? (locale === "zh-CN" ? "部分采样" : "Partial") : (locale === "zh-CN" ? "等待新扫描" : "Awaiting scan");
  meta.textContent = `${project.containerCount || 0} containers · ${project.workingDir || (locale === "zh-CN" ? "工作目录未采集" : "working directory unknown")}`;
  identity.append(name, meta);
  if (project.repository?.url) { const repo = document.createElement("small"); repo.className = "fleet-project-repository"; repo.append(locale === "zh-CN" ? "仓库 " : "Repo ", externalLink(project.repository.name || repositoryName(project.repository.url), project.repository.url, "repo-link")); identity.append(repo); }
  head.append(identity, status);
  measures.className = "fleet-project-measures";
  appendProjectMeasure(measures, "CPU", project.cpuHostRatio, project.cpuPercent === null ? null : `${Number(project.cpuPercent).toFixed(1)}% Docker · ${formatRatio(project.cpuHostRatio)} ${locale === "zh-CN" ? "整机" : "host"}`);
  appendProjectMeasure(measures, "RAM", project.memoryHostRatio, project.memoryUsageBytes === null ? null : `${formatBytes(project.memoryUsageBytes)} · ${formatRatio(project.memoryHostRatio)} ${locale === "zh-CN" ? "整机" : "host"}`);
  appendProjectMeasure(measures, locale === "zh-CN" ? "可写层" : "Writable", project.writableDiskRatio, project.writableBytes === null ? null : `${formatBytes(project.writableBytes)} · ${formatRatio(project.writableDiskRatio)} ${locale === "zh-CN" ? "主机盘" : "host disk"}`);
  appendProjectMeasure(measures, locale === "zh-CN" ? "网络累计" : "Network total", null, project.networkRxBytes === null && project.networkTxBytes === null ? null : `↓ ${formatBytes(project.networkRxBytes || 0)} · ↑ ${formatBytes(project.networkTxBytes || 0)}`);
  appendProjectMeasure(measures, locale === "zh-CN" ? "块 I/O 累计" : "Block I/O total", null, project.blockReadBytes === null && project.blockWriteBytes === null ? null : `R ${formatBytes(project.blockReadBytes || 0)} · W ${formatBytes(project.blockWriteBytes || 0)}`);
  activity.className = "fleet-project-activity";
  activity.append(projectActivity(locale === "zh-CN" ? "代码更新" : "Code update", project.lastCodeUpdateAt), projectActivity(locale === "zh-CN" ? "运行变更" : "Runtime change", project.lastRuntimeChangeAt), projectActivity(locale === "zh-CN" ? "使用量采样" : "Usage sampled", project.lastSampleAt));
  row.append(head, measures, activity);
  if (project.containers?.length) { const disclosure = document.createElement("details"), summary = document.createElement("summary"), body = document.createElement("div"); disclosure.className = "fleet-project-containers"; summary.textContent = `${project.containers.length} ${locale === "zh-CN" ? "个容器明细" : "container details"}`; for (const container of project.containers) body.append(renderRuntimeContainer(container)); disclosure.append(summary, body); row.append(disclosure); }
  return row;
}

function appendProjectMeasure(parent, label, ratioValue, detailValue) {
  const measure = document.createElement("div"), head = document.createElement("div"), labelNode = document.createElement("small"), value = document.createElement("strong");
  measure.className = `fleet-project-measure ${ratioValue === null ? "is-unavailable" : capacityTone(ratioValue)}`;
  labelNode.textContent = label; value.textContent = detailValue || (locale === "zh-CN" ? "旧扫描无此字段" : "Not in retained scan"); head.append(labelNode, value); measure.append(head);
  if (ratioValue !== null) { const meter = document.createElement("meter"); meter.min = 0; meter.max = 1; meter.value = Math.max(0, Math.min(1, Number(ratioValue))); meter.setAttribute("aria-label", `${label} ${formatRatio(ratioValue)}`); measure.append(meter); }
  parent.append(measure);
}

function projectActivity(label, value) { const item = document.createElement("span"), key = document.createElement("small"), time = document.createElement("strong"); key.textContent = label; time.textContent = value ? formatDateTime(value) : "-"; item.append(key, time); return item; }
function formatRatio(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${(Number(value) * 100).toFixed(Number(value) < .01 ? 2 : 1)}%`; }

function serverRecommendation(server) {
  const host = runtimeHost(server) || {};
  const coverage = server.runtime_coverage || {};
  const scannedAt = coverage.last_scanned_at ? Date.parse(coverage.last_scanned_at) : NaN;
  const hasRuntimeSample = coverage.status === "scanned" && Number.isFinite(scannedAt);
  const sampleAgeMinutes = hasRuntimeSample ? Math.max(0, Math.round((Date.now() - scannedAt) / 60000)) : null;
  const runtimeFresh = hasRuntimeSample && sampleAgeMinutes <= 15;
  if (!hasRuntimeSample)
    return { tone: "unknown", label: locale === "zh-CN" ? "尚未采集" : "Not collected", reason: locale === "zh-CN" ? "没有运行时采样，无法判断容量或给出部署建议。" : "No runtime sample is available for capacity or placement guidance." };
  const stalePrefix = locale === "zh-CN" ? "旧数据：" : "Stale data: ";
  const staleReason = locale === "zh-CN"
    ? `采样已过期约 ${sampleAgeMinutes} 分钟（${formatDateTime(coverage.last_scanned_at)}），以下建议仅供参考。`
    : `Sample is about ${sampleAgeMinutes} minutes old (${formatDateTime(coverage.last_scanned_at)}); use this guidance as provisional.`;
  const recommendationLabel = (label) => runtimeFresh ? label : stalePrefix + label;
  const recommendationReason = (reason) => runtimeFresh ? reason : `${staleReason} ${reason}`;
  const memory = ratio(
    Math.max(0, Number(host.memoryTotalKb || 0) - Number(host.memoryAvailableKb || 0)),
    Number(host.memoryTotalKb || 0),
  );
  const disk = ratio(host.diskUsedBytes, host.diskTotalBytes);
  const load = ratio(host.load1, host.cpuCount);
  const pressure = Math.max(memory || 0, disk || 0, load || 0);
  const state = fleetState(server);
  if (state === "attention" || state === "unknown" && !host.cpuCount)
    return { tone: "danger", label: recommendationLabel(locale === "zh-CN" ? "先恢复 / 暂不部署" : "Recover before deploying"), reason: recommendationReason(locale === "zh-CN" ? "服务器不可用，部署前需要先恢复。" : "The server is unavailable and must recover before deployment.") };
  if (pressure >= 0.85)
    return { tone: "warning", label: recommendationLabel(locale === "zh-CN" ? (dueState(server) === "is-warning" ? "优先新开服务器" : "评估升级") : (dueState(server) === "is-warning" ? "Open a new server" : "Review upgrade")), reason: recommendationReason(locale === "zh-CN" ? `当前峰值使用率约 ${Math.round(pressure * 100)}%，建议先核对账单和规格。` : `Peak measured utilisation is about ${Math.round(pressure * 100)}%; verify billing and capacity first.`) };
  if (pressure < 0.5 && Number(server.deployment_count || 0) === 0)
    return { tone: runtimeFresh ? "healthy" : "unknown", label: recommendationLabel(locale === "zh-CN" ? "优先使用" : "Prefer for next deployment"), reason: recommendationReason(locale === "zh-CN" ? "采样容量充足且暂无登记部署。" : "Healthy capacity with no registered deployments.") };
  return { tone: runtimeFresh ? "neutral" : "unknown", label: recommendationLabel(locale === "zh-CN" ? "保持" : "Keep"), reason: recommendationReason(locale === "zh-CN" ? "当前采样没有触发扩容条件。" : "Current sample does not trigger scaling.") };
}
function renderServers() {
  const list = $("#server-list");
  list.replaceChildren();
  const allDeployments = servers.flatMap((server) => server.deployments || []),
    allRuntime = servers.flatMap((server) =>
      (server.runtime_assets || []).filter((item) =>
        ["compose_project", "runtime_service"].includes(item.kind),
      ),
    );
  const deployedProjectKeys = new Set(
      [...allDeployments, ...allRuntime]
        .map((item) => item.project_id || item.project_name || (item.repository?.url ? item.repository.url : null))
        .filter(Boolean),
    ),
    deploymentUrls = new Set(
      [...allDeployments.map((item) => item.deployed_url), ...allRuntime.map((item) => item.url)]
        .filter(Boolean),
    ),
    latestHealthy = Number(monitorSummary?.latestRun?.healthy_count),
    activeNow = Number.isFinite(latestHealthy)
      ? latestHealthy
      : allRuntime.filter(activeRuntimeAsset).length + allDeployments.filter((item) => /healthy|reachable|active|deployed|running/i.test(String(item.effective_health_status || item.status || ""))).length;
  $("#server-online").textContent = servers.filter(
    (server) => fleetState(server) === "healthy",
  ).length;
  $("#server-incidents").textContent = monitorSummary?.openEvents || 0;
  $("#server-endpoint-down").textContent = Number(monitorSummary?.latestRun?.down_count || 0);
  const latest = monitorSummary?.latestRun;
  $("#monitor-status").textContent = latest
    ? `${locale === "zh-CN" ? "端点最近检查" : "Latest endpoint check"} ${formatDateTime(latest.completed_at || latest.started_at)} / ${latest.healthy_count || 0} healthy / ${latest.degraded_count || 0} degraded / ${latest.down_count || 0} down`
    : locale === "zh-CN"
      ? "尚无端点健康检查结果。"
      : "No endpoint health check results yet.";
  renderFleetOverview(allDeployments, allRuntime);
  list.hidden = true;
  return;
  servers.forEach((server) => {
    const item = document.createElement("section");
    item.className = "server-group";
    item.id = `server-${server.id}`;
    const head = document.createElement("div");
    head.className = "server-group-head";
    const identity = document.createElement("div"),
      usage = document.createElement("div"),
      status = statusBadge(server.effective_status || "unverified");
    const title = document.createElement("strong");
    title.textContent = server.name;
    const meta = document.createElement("small");
    meta.textContent = `${server.provider} / ${server.architecture || "-"} / ${server.ip_address || "-"}`;
    identity.append(title, meta);
    usage.className = "server-usage";
    const coverage = server.runtime_coverage || {};
    usage.textContent = `${server.deployments?.length || 0} ${locale === "zh-CN" ? "登记部署" : "registered"} / ${coverage.service_count || 0} ${locale === "zh-CN" ? "发现服务" : "services"} / ${coverage.container_count || 0} containers / ${server.cpu || "CPU -"} / ${server.memory_mb || 0} MB / ${server.disk_gb || 0} GB / ${locale === "zh-CN" ? "到期" : "due"} ${formatDate(server.due_at)} / ${coverage.source || "no runtime scanner"} ${formatDateTime(coverage.last_scanned_at)}`;
    head.append(identity, usage, status);
    item.append(head);
    item.append(
      renderRegisteredDeployments(server),
      renderRuntimeInventory(server),
      renderServerDns(server),
    );
    list.append(item);
  });
}

function renderRegisteredDeployments(server) {
  const projects = document.createElement("div");
  projects.className = "server-projects";
  for (const deployment of server.deployments || []) {
    const row = document.createElement("article");
    row.className = "server-project";
    const project = document.createElement("div"),
      repository = document.createElement("div"),
      deploymentInfo = document.createElement("div");
    project.className = "server-project-name";
    const projectName = document.createElement("strong");
    projectName.textContent = deployment.project_name;
    const projectMeta = document.createElement("small");
    projectMeta.textContent = `${deployment.environment} / ${deployment.status} / ${deployment.version || "-"} / ${deployment.effective_health_status || "unverified"}`;
    project.append(projectName, projectMeta);
    const repoUrl =
      deployment.repository_url || deployment.backup_repository_url;
    repository.className = "server-repository";
    repository.append(
      repoUrl
        ? externalLink(repositoryName(repoUrl), repoUrl, "repo-link")
        : plainStrong(repositoryName(repoUrl)),
    );
    const repoStatus = document.createElement("small");
    repoStatus.textContent = githubState(deployment);
    repository.append(repoStatus);
    deploymentInfo.className = "server-deployment-url";
    deploymentInfo.append(
      deployment.deployed_url
        ? externalLink(
            deployment.deployed_url,
            deployment.deployed_url,
            "url-link",
          )
        : document.createTextNode(
            locale === "zh-CN" ? "未登记部署 URL" : "No deployment URL",
          ),
      statusBadge(deployment.effective_health_status || "unverified"),
    );
    row.append(project, repository, deploymentInfo);
    projects.append(row);
  }
  if (!server.deployments?.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      locale === "zh-CN"
        ? "没有人工登记部署；以下仍显示自动发现服务。"
        : "No registered deployment; discovered runtime services are still listed below.";
    projects.append(empty);
  }
  return projects;
}

function renderRuntimeInventory(server) {
  const runtime = document.createElement("div");
  runtime.className = "docker-runtime";
  const coverage = server.runtime_coverage || {},
    assets = server.runtime_assets || [],
    services = assets.filter((item) =>
      ["compose_project", "runtime_service"].includes(item.kind),
    ),
    containers = assets.filter((item) =>
      ["container", "runtime_container"].includes(item.kind),
    ),
    host = assets.find((item) => item.kind === "server_runtime"),
    title = document.createElement("h3");
  title.textContent = `Runtime / ${coverage.status || "not_scanned"} / ${services.length} Services / ${containers.length} Containers`;
  runtime.append(title);
  if (host) {
    const metrics = document.createElement("p");
    metrics.className = "runtime-metrics";
    const m = host.metadata || {},
      used =
        m.memoryTotalKb && m.memoryAvailableKb
          ? Math.max(0, m.memoryTotalKb - m.memoryAvailableKb)
          : 0;
    metrics.textContent = `${m.hostname || server.name} / CPU ${m.cpuCount || "-"} / load ${m.load1 ?? "-"} / RAM ${formatBytes(used * 1024)} of ${formatBytes((m.memoryTotalKb || 0) * 1024)} / Disk ${formatBytes(m.diskUsedBytes || 0)} of ${formatBytes(m.diskTotalBytes || 0)} / Docker ${m.dockerVersion || "not detected"}`;
    runtime.append(metrics);
  }
  if (!services.length && !containers.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      coverage.status === "not_scanned"
        ? locale === "zh-CN"
          ? "未安装或未完成运行时采集；这不表示服务器没有服务。"
          : "Runtime scanner is not installed or has not completed; this does not mean the server is empty."
        : locale === "zh-CN"
          ? "已扫描，未发现 Docker 服务。"
          : "Scanned; no Docker services found.";
    runtime.append(empty);
    return runtime;
  }
  for (const service of services) {
    const row = document.createElement("article");
    row.className = "runtime-project";
    const name = service.url
        ? externalLink(service.name, service.url, "url-link")
        : plainStrong(service.name),
      meta = document.createElement("small"),
      repo = service.repository;
    meta.textContent = `${service.metadata?.containerCount || service.metadata?.containers?.length || 0} containers / ${service.metadata?.workingDir || "working directory unknown"} / ${service.project_id ? "linked" : "auto-discovered"}`;
    row.append(name, meta);
    if (repo?.url) {
      const repoLine = document.createElement("small");
      repoLine.className = "runtime-repository";
      repoLine.append(
        locale === "zh-CN" ? "仓库 " : "Repo ",
        externalLink(repo.name, repo.url, "repo-link"),
        document.createTextNode(
          ` / ${locale === "zh-CN" ? "最后推送" : "last push"} ${formatDateTime(repo.metadata?.pushedAt || repo.metadata?.updatedAt || repo.last_seen_at)}`,
        ),
      );
      row.append(repoLine);
    }
    const serviceContainers = containers.filter(
      (container) =>
        (container.metadata?.composeProject || container.name) === service.name,
    );
    for (const container of serviceContainers)
      row.append(renderRuntimeContainer(container));
    runtime.append(row);
  }
  const listed = new Set(services.map((service) => service.name));
  for (const container of containers.filter(
    (item) => !listed.has(item.metadata?.composeProject || item.name),
  ))
    runtime.append(renderRuntimeContainer(container));
  return runtime;
}

function renderRuntimeContainer(container) {
  const line = document.createElement("div");
  line.className = "runtime-container";
  const name = document.createElement("strong");
  name.textContent = container.name;
  const m = container.metadata || {},
    details = document.createElement("small");
  const usage = m.stats ? ` / CPU ${m.stats.cpuPercent === null || m.stats.cpuPercent === undefined ? m.stats.cpu || "-" : `${Number(m.stats.cpuPercent).toFixed(1)}%`} / RAM ${m.stats.memoryUsageBytes === null || m.stats.memoryUsageBytes === undefined ? m.stats.memory || "-" : formatBytes(m.stats.memoryUsageBytes)} / RW ${m.sizeRwBytes === null || m.sizeRwBytes === undefined ? "-" : formatBytes(m.sizeRwBytes)}` : "";
  details.textContent = `${m.composeService || "standalone"} / ${m.image || "image unknown"} / ${m.health || m.state || container.status || "unknown"} / ${Array.isArray(m.ports) ? m.ports.join(", ") : m.ports || "no published ports"}${usage}`;
  line.append(name, details);
  return line;
}

function renderServerDns(server) {
  const section = document.createElement("div");
  section.className = "server-dns";
  const records = server.dns_records || [],
    title = document.createElement("h3");
  title.textContent = `DNS / ${records.length} ${locale === "zh-CN" ? "条关联记录" : "linked records"}`;
  section.append(title);
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      locale === "zh-CN"
        ? "没有可确定关联到该服务器公网 IP 的 DNS 记录。"
        : "No DNS record is deterministically linked to this server public IP.";
    section.append(empty);
    return section;
  }
  const grid = document.createElement("div");
  grid.className = "server-dns-grid";
  for (const record of records) {
    const m = record.metadata || {},
      row = document.createElement("div");
    row.className = "server-dns-record";
    row.append(
      record.url
        ? externalLink(record.name, record.url, "url-link")
        : plainStrong(record.name),
    );
    const detail = document.createElement("small");
    detail.textContent = `${m.type || "-"} → ${m.value || "-"} / ${record.status} / ${m.probe?.status || "not probed"}`;
    row.append(detail);
    grid.append(row);
  }
  section.append(grid);
  return section;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes,
    index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
function openServer(serverId) {
  switchWorkspace("servers");
  setTimeout(
    () =>
      document
        .getElementById(`server-${serverId}`)
        ?.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        }),
    120,
  );
}
$("#run-monitor").addEventListener("click", async () => {
  const button = $("#run-monitor");
  button.disabled = true;
  try {
    await request("/admin/monitor/run", { method: "POST" });
    $("#monitor-status").textContent =
      locale === "zh-CN"
        ? "检查请求已登记，监控容器将在下一轮处理。"
        : "Check requested; the monitor will process it on its next cycle.";
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function assetExpiry(asset) {
  const m = asset.metadata || {};
  return m.expiresAt || m.expiredAt || m.deadline || m.dueAt || null;
}
function expiryTone(value) {
  const days = (new Date(value).getTime() - Date.now()) / 86400000;
  return days < 0 ? "is-danger" : days <= 30 ? "is-warning" : "";
}
function expirySource(asset) {
  const m = asset.metadata || {};
  if (m.expirationSource || m.expirationModel)
    return m.expirationSource || m.expirationModel;
  if (m.renewAuto === true) return "auto-renew";
  if (m.renewAuto === false) return "manual renewal";
  return asset.provider;
}
function renderExpiringResources(items) {
  const target = $("#expiring-resource-list");
  $("#server-expiring").textContent = items.length;
  target.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "expiring-resource-empty";
    empty.textContent =
      locale === "zh-CN"
        ? "未来 90 天内没有已验证的到期资源。"
        : "No verified resources expire in the next 90 days.";
    target.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("article"),
      expiry = assetExpiry(item),
      title = item.url
        ? externalLink(item.name, item.url, "url-link")
        : plainStrong(item.name),
      detail = document.createElement("small");
    row.className = `expiring-resource-row ${expiryTone(expiry)}`;
    detail.textContent = `${item.provider} / ${item.kind} · ${locale === "zh-CN" ? "到期" : "expires"} ${formatDate(expiry)} · ${expirySource(item)}`;
    row.append(title, detail);
    target.append(row);
  }
}
async function loadExpiringResources() {
  try {
    const body = await request(
      "/admin/assets?expiring_days=90&sort=expires&per_page=18",
    );
    renderExpiringResources(body.data || []);
  } catch (error) {
    if (error.status !== 401) setNotice(error.message, true);
  }
}

async function loadAssetSummary() {
  if (!assetSummary)
    assetSummary = (await request("/admin/assets/summary")).data;
  renderAssetSummaries();
}

async function loadApiProviders() {
  const target = $("#api-provider-list"), summary = $("#api-provider-summary");
  target.replaceChildren();
  const loading = document.createElement("p"); loading.className = "empty"; loading.textContent = locale === "zh-CN" ? "正在检查 API 服务状态…" : "Loading API provider health…"; target.append(loading);
  try {
    const body = await request("/api/admin/v1/api-providers"), providers = body.data || [];
    const problem = providers.filter((item) => ["down", "degraded", "stale"].includes(item.overallStatus)).length;
    renderMetricStrip(summary, [[providers.filter((item) => item.overallStatus === "healthy").length, t("healthy")], [problem, t("attention")], [providers.filter((item) => item.credentialStatus === "unconfigured").length, t("unconfigured")], [providers.length, t("connectors")]]);
    $("#server-api-issues").textContent = problem;
    target.replaceChildren();
    for (const provider of providers) {
      const row = document.createElement("article"), identity = document.createElement("div"), name = document.createElement("strong"), meta = document.createElement("small"), links = document.createElement("nav"), models = document.createElement("details"), modelSummary = document.createElement("summary"), modelList = document.createElement("div"), checks = document.createElement("div"), timing = document.createElement("small"), action = document.createElement("button");
      row.className = "api-provider-row"; row.dataset.status = provider.overallStatus;
      name.textContent = provider.accountLabel; meta.textContent = `${provider.provider} · ${provider.credentialType}`;
      links.className = "api-provider-links"; links.setAttribute("aria-label", locale === "zh-CN" ? `${provider.accountLabel} 官方入口` : `${provider.accountLabel} official resources`);
      if (provider.officialLinks?.subscriptionUrl) links.append(externalLink(t("subscribeOfficial"), provider.officialLinks.subscriptionUrl, "api-provider-link"));
      if (provider.officialLinks?.documentationUrl) links.append(externalLink(t("officialDocs"), provider.officialLinks.documentationUrl, "api-provider-link"));
      models.className = "api-provider-models"; modelList.className = "api-provider-model-list";
      modelSummary.textContent = `${t("availableModels")} ${Number(provider.modelCount || 0)}`;
      for (const modelId of provider.modelCatalog || []) { const code = document.createElement("code"); code.textContent = modelId; modelList.append(code); }
      if ((provider.modelCatalog || []).length) models.append(modelSummary, modelList);
      identity.append(name, meta, links, models);
      checks.className = "api-provider-checks"; checks.append(statusBadge(provider.overallStatus), textCell(provider.model || t("noModel")), textCell(provider.latencyMs == null ? "—" : `${provider.latencyMs} ms`));
      const expiry = provider.validity?.credential?.expiresAt ? `${t("keyExpires")} ${formatDate(provider.validity.credential.expiresAt)}` : t("keyExpiryUnknown");
      timing.textContent = provider.lastCheckedAt ? `${t("checked")} ${formatDateTime(provider.lastCheckedAt)} · ${t("nextCheck")} ${formatDateTime(provider.nextDueAt)} · ${expiry}` : `${t("notChecked")} · ${expiry}`;
      action.type = "button"; action.dataset.providerProbe = provider.id; action.textContent = locale === "zh-CN" ? "立即检查" : "Check now";
      row.append(identity, checks, timing, action); target.append(row);
    }
  } catch (error) {
    target.replaceChildren(); const failed = document.createElement("p"); failed.className = "empty error"; failed.textContent = error.message; target.append(failed);
  }
}
$("#api-provider-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-provider-probe]"); if (!button) return;
  button.disabled = true;
  try {
    await request(`/api/admin/v1/api-providers/${encodeURIComponent(button.dataset.providerProbe)}/probe`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ mode: "standard" }) });
    button.textContent = t("queued");
  } catch (error) { setNotice(error.message, true); button.disabled = false; }
});
function renderAssetSummaries() {
  if (!assetSummary) return;
  const groups = assetSummary.groups || [],
    count = (provider, kind) =>
      groups
        .filter(
          (x) =>
            (!provider || x.provider === provider) &&
            (!kind || x.kind === kind),
        )
        .reduce((sum, x) => sum + Number(x.count || 0), 0);
  renderMetricStrip($("#cloud-summary"), [
    [
      count("tencent", "dns_domain") + count("godaddy", "dns_domain"),
      "DNS domains",
    ],
    [
      count("tencent", "dns_record") + count("godaddy", "dns_record"),
      "DNS records",
    ],
    [count("tencent", "cos_bucket"), "COS buckets"],
    [count("cloudflare"), "Cloudflare assets"],
  ]);
  renderMetricStrip($("#repository-summary"), [
    [count("github", "repository"), "GitHub"],
    [count("local", "repository"), "Local repositories"],
    [count("docker", "compose_project"), "Compose projects"],
    [
      (assetSummary.links || []).reduce((s, x) => s + Number(x.count || 0), 0),
      "Linked",
    ],
  ]);
}
function renderMetricStrip(target, values) {
  target.replaceChildren();
  for (const [value, label] of values) {
    const div = document.createElement("div"),
      strong = document.createElement("strong"),
      span = document.createElement("span");
    strong.textContent = value;
    span.textContent = label;
    div.append(strong, span);
    target.append(div);
  }
}
async function loadCloudAssets() {
  const query = assetQuery($("#cloud-filters"), cloudPage);
  query.set("scope", "cloud");
  if (!query.has("kind")) query.set("kinds", resourceView === "endpoints" ? "dns_domain,dns_record,chain_domain,pages_project,worker,edgeone_zone" : "cos_bucket,r2_bucket,kv_namespace,d1_database,cbs_disk,billing_account,billing_resource");
  const body = await request(`/admin/assets?${query}`);
  cloudPages = Math.max(body.meta.pages, 1);
  renderAssets($("#cloud-assets"), body.data, false);
  updateAssetPager("cloud", cloudPage, cloudPages);
}
async function loadRepositoryAssets() {
  const query = assetQuery($("#repository-filters"), repositoryPage);
  query.set("kind", "repository");
  const body = await request(`/admin/assets?${query}`);
  repositoryPages = Math.max(body.meta.pages, 1);
  renderAssets($("#repository-assets"), body.data, true);
  updateAssetPager("repository", repositoryPage, repositoryPages);
}
function assetQuery(form, currentPage) {
  const query = new URLSearchParams({
    page: String(currentPage),
    per_page: "50",
  });
  for (const name of [
    "q",
    "provider",
    "account",
    "kind",
    "status",
    "region",
    "probe",
  ]) {
    const field = form.elements.namedItem(name);
    if (field?.value?.trim()) query.set(name, field.value.trim());
  }
  return query;
}
function renderAssets(target, items, repositories) {
  target.replaceChildren();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      locale === "zh-CN" ? "没有符合条件的资源" : "No matching assets";
    target.append(p);
    return;
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "asset-row";
    const identity = document.createElement("div");
    identity.append(
      item.url
        ? externalLink(
            item.name,
            item.url,
            repositories ? "repo-link" : "url-link",
          )
        : plainStrong(item.name),
    );
    const external = document.createElement("small");
    external.textContent = item.external_id;
    identity.append(external);
    if (repositories) {
      const source = textCell(`${item.provider} / ${item.account_id}`),
        sync = textCell(repositorySync(item)),
        branch = textCell(
          `${item.metadata?.branch || item.metadata?.defaultBranch || "-"} / ${(item.metadata?.headSha || item.metadata?.githubHeadSha || "").slice(0, 10) || "-"}`,
        ),
        updated = textCell(
          formatDate(
            item.metadata?.pushedAt ||
              item.metadata?.sourceUpdatedAt ||
              item.last_verified_at,
          ),
        );
      row.append(identity, source, sync, branch, updated);
    } else {
      const probe = item.metadata?.probe,
        probeText = probe ? ` · ${dnsProbeLabel(probe)} ` : "";
      row.append(
        identity,
        textCell(item.kind),
        textCell(`${item.account_id} / ${item.region || "-"}`),
        statusCell(`${item.status}${probeText}`, item.isStale),
        textCell(
          formatDate(
            probe?.checkedAt || item.last_verified_at || item.last_seen_at,
          ),
        ),
      );
    }
    target.append(row);
  }
}
function dnsProbeLabel(probe) {
  const labels = {
    reachable: locale === "zh-CN" ? "HTTPS 可达" : "HTTPS reachable",
    reachable_insecure: locale === "zh-CN" ? "仅 HTTP" : "HTTP only",
    client_error: `HTTP ${probe.httpStatus || "4xx"}`,
    server_error: `HTTP ${probe.httpStatus || "5xx"}`,
    server_error_insecure: `HTTP ${probe.httpStatus || "5xx"}`,
    unreachable: locale === "zh-CN" ? "不可达" : "unreachable",
    dns_error: locale === "zh-CN" ? "DNS 错误" : "DNS error",
    skipped_private: locale === "zh-CN" ? "私网跳过" : "private skipped",
  };
  const latency = Number.isFinite(probe.latencyMs)
    ? ` / ${probe.latencyMs}ms`
    : "";
  return (labels[probe.status] || probe.status) + latency;
}
function repositorySync(item) {
  const value = item.metadata?.syncStatus;
  if (value)
    return (
      {
        current: "GitHub 最新",
        local_ahead: "本地领先",
        github_ahead: "GitHub 领先",
        diverged: "已分叉",
        no_remote: "无 remote",
        unverified: "未验证",
      }[value] || value
    );
  return item.provider === "github"
    ? item.metadata?.private
      ? "private"
      : "public"
    : "未验证";
}
function textCell(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "-";
  return div;
}
function statusCell(value, stale) {
  const span = document.createElement("span");
  span.className = `asset-status ${stale ? "is-stale" : ""}`;
  span.textContent = stale ? `${value} / stale` : value;
  return span;
}
function plainStrong(value) {
  const strong = document.createElement("strong");
  strong.textContent = value;
  return strong;
}
function externalLink(label, url, className) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = className;
  link.textContent = label;
  return link;
}
function updateAssetPager(prefix, current, total) {
  $("#" + prefix + "-page-label").textContent = `${current} / ${total}`;
  $("#" + prefix + "-previous").disabled = current <= 1;
  $("#" + prefix + "-next").disabled = current >= total;
}
$("#cloud-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  cloudPage = 1;
  loadCloudAssets().catch((error) => setNotice(error.message, true));
});
$("#repository-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  repositoryPage = 1;
  loadRepositoryAssets().catch((error) => setNotice(error.message, true));
});
$("#cloud-previous").addEventListener("click", () => {
  if (cloudPage > 1) {
    cloudPage--;
    loadCloudAssets();
  }
});
$("#cloud-next").addEventListener("click", () => {
  if (cloudPage < cloudPages) {
    cloudPage++;
    loadCloudAssets();
  }
});
$("#repository-previous").addEventListener("click", () => {
  if (repositoryPage > 1) {
    repositoryPage--;
    loadRepositoryAssets();
  }
});
$("#repository-next").addEventListener("click", () => {
  if (repositoryPage < repositoryPages) {
    repositoryPage++;
    loadRepositoryAssets();
  }
});
$("#save-server").addEventListener("click", async () => {
  try {
    await request("/admin/servers", {
      method: "POST",
      body: JSON.stringify({
        name: $("#server-name").value,
        provider: $("#server-provider").value,
        ipAddress: $("#server-ip").value || null,
        architecture: $("#server-arch").value || null,
        cpu: $("#server-cpu").value || null,
        memoryMb: Number($("#server-memory").value) || null,
        diskGb: Number($("#server-disk").value) || null,
        operatingSystem: $("#server-os").value || null,
        dueAt: $("#server-due").value || null,
        publicUrl: $("#server-public-url").value || null,
        healthUrl: $("#server-health-url").value || null,
      }),
    });
    await loadServers();
    setNotice(locale === "zh-CN" ? "服务器已添加。" : "Server added.");
  } catch (error) {
    setNotice(error.message, true);
  }
});
async function loadDeployments() {
  const body = await request(
    `/admin/resources/${activeProject.id}/deployments`,
  );
  renderSubList(
    $("#deployment-list"),
    body.data,
    (item) => `${item.environment} · ${item.server_name} · ${item.status}`,
    (item) =>
      `${item.deployed_url || "-"} · ${item.architecture || "-"} · ${item.ip_address || "-"} · ${formatDate(item.due_at)}`,
  );
}
$("#save-deployment").addEventListener("click", async () => {
  try {
    await request(`/admin/resources/${activeProject.id}/deployments`, {
      method: "POST",
      body: JSON.stringify({
        serverId: $("#deployment-server").value,
        environment: $("#deployment-environment").value,
        deployedUrl: $("#deployment-url").value || null,
        version: $("#deployment-version").value || null,
        status: "active",
      }),
    });
    await loadDeployments();
  } catch (error) {
    setNotice(error.message, true);
  }
});
async function loadBackups() {
  const body = await request(`/admin/resources/${activeProject.id}/backup`);
  renderSubList(
    $("#backup-list"),
    body.data,
    (item) => `${item.repository_url} · ${item.branch}`,
    (item) =>
      `${item.status} · ${formatDate(item.last_verified_at)} · ${formatDate(item.last_backup_at)}`,
  );
}
$("#save-backup").addEventListener("click", async () => {
  try {
    await request(`/admin/resources/${activeProject.id}/backup`, {
      method: "PUT",
      body: JSON.stringify({
        repositoryUrl: $("#backup-url").value,
        branch: $("#backup-branch").value,
      }),
    });
    await loadBackups();
  } catch (error) {
    setNotice(error.message, true);
  }
});
async function loadDocument(type) {
  const target =
    type === "content_md" ? $("#notes-content") : $("#codebase-content");
  try {
    const body = await request(
      `/admin/resources/${activeProject.id}/documents/${type}`,
    );
    target.value = body.data.content;
  } catch (error) {
    target.value = "";
    if (error.status !== 404 && error.status !== 503)
      setNotice(error.message, true);
  }
}
async function saveDocument(type) {
  const target =
    type === "content_md" ? $("#notes-content") : $("#codebase-content");
  try {
    await request(`/admin/resources/${activeProject.id}/documents/${type}`, {
      method: "PUT",
      body: JSON.stringify({ content: target.value }),
    });
    setNotice(
      locale === "zh-CN" ? "文档已加密保存。" : "Document encrypted and saved.",
    );
  } catch (error) {
    setNotice(error.message, true);
  }
}
$("#save-notes").addEventListener("click", () => saveDocument("content_md"));
$("#save-codebase").addEventListener("click", () =>
  saveDocument("codebase_map"),
);
$("#start-benchmark").addEventListener("click", async () => {
  const query = $("#benchmark-query").value.trim();
  if (!query) {
    setNotice(
      locale === "zh-CN" ? "请输入基准查询。" : "Enter a benchmark query.",
      true,
    );
    return;
  }
  try {
    await request("/admin/benchmarks", {
      method: "POST",
      body: JSON.stringify({ projectId: activeProject.id, query }),
    });
    setNotice(
      locale === "zh-CN"
        ? "基准发现任务已加入队列。"
        : "Benchmark discovery queued.",
    );
  } catch (error) {
    setNotice(error.message, true);
  }
});
async function loadProjectBenchmarks() {
  const body = await request(`/admin/resources/${activeProject.id}/benchmarks`);
  renderSubList(
    $("#benchmark-list"),
    body.data,
    (item) => item.title || item.canonical_url,
    (item) =>
      `${item.provider} · ${item.status} · ${Math.round((item.confidence || 0) * 100)}%`,
  );
}
function renderSubList(container, items, title, detail) {
  container.replaceChildren();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = locale === "zh-CN" ? "暂无记录" : "No records yet";
    container.append(p);
    return;
  }
  items.forEach((value) => {
    const item = document.createElement("div");
    item.className = "sub-item";
    const strong = document.createElement("strong"),
      small = document.createElement("small");
    strong.textContent = title(value);
    small.textContent = detail(value);
    item.append(strong, small);
    container.append(item);
  });
}
async function loadSourceStatus() {
  clearTimeout(sourcePollTimer);
  try {
    const body = await request("/api/admin/v1/sources"),
      sources = body.data || [],
      busy = sources.some((item) =>
        ["queued", "claimed", "running"].includes(item.latest_job_status),
      );
    renderSourceStatus(sources);
    $("#source-poll-label").textContent = busy
      ? locale === "zh-CN"
        ? "扫描任务运行中；每 5 秒更新"
        : "Scan running; updating every 5 seconds"
      : locale === "zh-CN"
        ? "空闲时每 60 秒更新；本机 Agent 每 15 分钟领取任务"
        : "Updates every 60 seconds while idle; Mac agent polls every 15 minutes";
    sourcePollTimer = setTimeout(loadSourceStatus, busy ? 5000 : 60000);
  } catch (error) {
    if (error.status === 401) return showLogin();
    $("#source-poll-label").textContent = error.message;
    sourcePollTimer = setTimeout(loadSourceStatus, 60000);
  }
}
function renderSourceStatus(sources) {
  const target = $("#source-connector-list"),
    busyCount = sources.filter((source) =>
      ["queued", "claimed", "running"].includes(source.latest_job_status),
    ).length,
    errorCount = sources.filter(
      (source) =>
        source.credential_status === "error" || source.last_error_message,
    ).length,
    unconfiguredCount = sources.filter(
      (source) => source.credential_status === "unconfigured",
    ).length,
    assetCount = sources.reduce(
      (sum, source) => sum + Number(source.asset_count || 0),
      0,
    );
  $("#source-summary-stats").textContent =
    locale === "zh-CN"
      ? `${sources.length} 个来源 / ${assetCount} 项 / ${busyCount} 运行中 / ${errorCount} 错误 / ${unconfiguredCount} 未配置`
      : `${sources.length} sources / ${assetCount} assets / ${busyCount} running / ${errorCount} errors / ${unconfiguredCount} unconfigured`;
  target.replaceChildren();
  for (const source of sources) {
    const card = document.createElement("article"),
      title = document.createElement("strong"),
      state = document.createElement("span"),
      detail = document.createElement("small"),
      button = document.createElement("button"),
      busy = ["queued", "claimed", "running"].includes(
        source.latest_job_status,
      ),
      failure = source.last_error_message
        ? `${locale === "zh-CN" ? "最近错误" : "last error"}: ${source.last_error_message}`
        : "";
    card.className = `source-connector ${busy ? "is-running" : ""} ${failure ? "has-error" : ""}`;
    title.textContent = source.name;
    state.className = `source-state ${source.credential_status}`;
    state.textContent = source.credential_status || "unknown";
    detail.textContent = `${source.provider} / ${source.account_id} · ${source.asset_count || 0} ${locale === "zh-CN" ? "项" : "assets"} · ${locale === "zh-CN" ? "最近" : "last"} ${formatDateTime(source.last_success_at)} · ${locale === "zh-CN" ? "下次" : "next"} ${formatDateTime(source.next_due_at)} · ${source.latest_job_status || "idle"}${failure ? ` · ${failure}` : ""}`;
    button.type = "button";
    button.textContent = busy
      ? locale === "zh-CN"
        ? "取消"
        : "Cancel"
      : locale === "zh-CN"
        ? "刷新"
        : "Refresh";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (busy && source.latest_job_id)
          await request(
            `/api/admin/v1/scans/${encodeURIComponent(source.latest_job_id)}/cancel`,
            { method: "POST", body: "{}" },
          );
        else
          await request("/api/admin/v1/scans", {
            method: "POST",
            body: JSON.stringify({ sourceId: source.id }),
          });
        await loadSourceStatus();
      } catch (error) {
        setNotice(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    card.append(title, button, state, detail);
    target.append(card);
  }
}
$("#scan-all-sources").addEventListener("click", async () => {
  const button = $("#scan-all-sources");
  button.disabled = true;
  try {
    const body = await request("/api/admin/v1/scans", {
      method: "POST",
      body: JSON.stringify({ mode: "incremental" }),
    });
    setNotice(
      `${body.data.length} ${locale === "zh-CN" ? "个来源已进入刷新队列" : "sources queued"}`,
    );
    await loadSourceStatus();
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});
function renderResourceSnapshot(snapshot) {
  const status = $("#resource-snapshot-status"),
    preview = $("#resource-snapshot-preview");
  if (!snapshot) {
    status.textContent =
      locale === "zh-CN"
        ? "暂时无法读取资源快照。"
        : "Resource snapshot is currently unavailable.";
    preview.textContent = "";
    return;
  }
  const placement = snapshot.imbalance || {},
    fleet = snapshot.fleet || {},
    freshness = snapshot.freshness || {};
  status.textContent =
    locale === "zh-CN"
      ? `${formatDateTime(snapshot.generatedAt)} · ${fleet.healthyServers || 0}/${fleet.totalServers || 0} 台健康 · 运行时覆盖 ${fleet.runtimeCoverage || 0} · ${placement.recommendation || ""}`
      : `${formatDateTime(snapshot.generatedAt)} · ${fleet.healthyServers || 0}/${fleet.totalServers || 0} healthy · runtime coverage ${fleet.runtimeCoverage || 0} · ${placement.recommendation || ""}`;
  const copy = {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    purpose: snapshot.purpose,
    safeguards: snapshot.safeguards,
    freshness,
    placementPolicy: snapshot.placementPolicy,
    fleet,
    imbalance: placement,
    serverPlacement: snapshot.serverPlacement,
  };
  preview.textContent = JSON.stringify(copy, null, 2);
  preview.dataset.snapshot = JSON.stringify(copy);
}
async function copyResourceSnapshot() {
  const text = $("#resource-snapshot-preview").dataset.snapshot;
  if (!text) {
    setNotice(
      locale === "zh-CN"
        ? "请先生成或加载资源快照。"
        : "Generate or load a snapshot first.",
      true,
    );
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setNotice(
      locale === "zh-CN"
        ? "资源快照 JSON 已复制。"
        : "Resource snapshot JSON copied.",
    );
  } catch {
    setNotice(
      locale === "zh-CN"
        ? "浏览器未允许复制，请从下方文本复制。"
        : "Clipboard access was denied; copy the text below.",
      true,
    );
  }
}
$("#generate-resource-snapshot").addEventListener("click", async () => {
  const button = $("#generate-resource-snapshot");
  button.disabled = true;
  try {
    const body = await request("/api/admin/v1/resource-snapshots", {
      method: "POST",
      body: "{}",
    });
    renderResourceSnapshot(body.data);
    setNotice(
      locale === "zh-CN" ? "资源快照已生成。" : "Resource snapshot generated.",
    );
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("#copy-resource-snapshot").addEventListener("click", copyResourceSnapshot);
function setNotice(message, isError = false) {
  $("#notice").textContent = message;
  $("#notice").classList.toggle("error", isError);
}
function hydrateProjectFilters() {
  const query = new URLSearchParams(location.search);
  page = Math.max(1, Number(query.get("page") || 1));
  for (const group of Object.keys(projectFilters))
    for (const value of query.getAll(group)) projectFilters[group].add(value);
  $("#project-filters input[name=q]").value = query.get("q") || "";
  $("#project-filters input[name=tag]").value = query.get("tag") || "";
  if (query.get("sort"))
    $("#project-filters select[name=sort]").value = query.get("sort");
  document
    .querySelectorAll("#project-filters [data-filter] button[data-value]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(
          projectFilters[button.closest("[data-filter]").dataset.filter].has(
            button.dataset.value,
          ),
        ),
      ),
    );
}
hydrateProjectFilters();
boot();
