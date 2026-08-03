(function taskWorkspace() {
  Object.assign(translations["zh-CN"], {
    tasks: "任务",
    scanSources: "自动扫描来源",
    expand: "展开",
    refreshAll: "立即刷新全部",
    openTasks: "进行中",
    overdueTasks: "已逾期",
    dueSoonTasks: "7 天内到期",
    unassignedTasks: "未分派",
    expectedValue: "预期收益",
    newTask: "新建任务",
    taskList: "列表",
    taskBoard: "看板",
    taskGantt: "甘特图",
    savedViews: "保存的视图",
    viewName: "视图名称",
    saveView: "保存视图",
    taskSearch: "任务、编号或描述",
    projectSearch: "输入项目名或路径",
    resetFilters: "重置",
    owner: "负责人",
    participant: "对接人",
    participants: "参与者 / 对接人",
    milestone: "里程碑",
    milestoneDirectory: "项目里程碑",
    addMilestone: "添加里程碑",
    deliveryDomain: "交付领域",
    task: "任务",
    projectMilestone: "项目 / 里程碑",
    schedule: "排期",
    valueImpact: "收益 / 价值",
    peopleDirectory: "人员、Agent 与对接人目录",
    addPerson: "添加",
    taskTitle: "任务标题",
    priority: "优先级",
    strategicValue: "战略价值",
    createTask: "创建任务",
    creatingTask: "创建中…",
    quickTaskIntro: "先写清结果，其余信息可以稍后补充。",
    quickTaskPlaceholder: "例如：完成资源监控告警接入",
    taskDetailsOptional: "补充信息",
    optional: "可选",
    enterToCreate: "创建",
    escapeToClose: "关闭",
    startDate: "开始日期",
    confidence: "置信度 %",
    dependencies: "前置依赖",
    comments: "评论",
    commentPlaceholder: "添加进展或交付说明",
    add: "添加",
    realtimeOnline: "实时协作",
    realtimeConnecting: "正在连接",
    realtimeOffline: "离线",
  });
  Object.assign(translations.en, {
    tasks: "Tasks",
    scanSources: "Scan sources",
    expand: "Expand",
    refreshAll: "Refresh all",
    openTasks: "Open",
    overdueTasks: "Overdue",
    dueSoonTasks: "Due in 7 days",
    unassignedTasks: "Unassigned",
    expectedValue: "Expected value",
    newTask: "New task",
    taskList: "List",
    taskBoard: "Board",
    taskGantt: "Gantt",
    savedViews: "Saved views",
    viewName: "View name",
    saveView: "Save view",
    taskSearch: "Task, ID, or description",
    projectSearch: "Project name or path",
    resetFilters: "Reset",
    owner: "Owner",
    participant: "Counterpart",
    participants: "Participants / counterparts",
    milestone: "Milestone",
    milestoneDirectory: "Project milestones",
    addMilestone: "Add milestone",
    deliveryDomain: "Delivery domain",
    task: "Task",
    projectMilestone: "Project / milestone",
    schedule: "Schedule",
    valueImpact: "Value / impact",
    peopleDirectory: "People, agents, and contacts",
    addPerson: "Add",
    taskTitle: "Task title",
    priority: "Priority",
    strategicValue: "Strategic value",
    createTask: "Create task",
    creatingTask: "Creating…",
    quickTaskIntro: "Start with the outcome. Add the details now or later.",
    quickTaskPlaceholder: "e.g. Connect resource-monitoring alerts",
    taskDetailsOptional: "Task details",
    optional: "Optional",
    enterToCreate: "Create",
    escapeToClose: "Close",
    startDate: "Start date",
    confidence: "Confidence %",
    dependencies: "Dependencies",
    comments: "Comments",
    commentPlaceholder: "Add progress or delivery context",
    add: "Add",
    realtimeOnline: "Live",
    realtimeConnecting: "Connecting",
    realtimeOffline: "Offline",
  });
  applyLocale();

  let items = [],
    contextData = { projects: [], people: [], milestones: [] },
    taskView = localStorage.getItem("tableai-task-view") || "list",
    filterTimer = null,
    activeTask = null,
    initialized = false,
    organizationId = null,
    realtime = null,
    realtimeCursor = Number(sessionStorage.getItem("tableai-task-cursor") || 0),
    realtimeRetry = null,
    realtimeReload = null,
    heartbeat = null;
  if (!["list", "board", "gantt"].includes(taskView)) taskView = "list";
  const statusOrder = [
    "backlog",
    "todo",
    "in_progress",
    "blocked",
    "in_review",
    "done",
  ];
  const statusLabels =
    locale === "zh-CN"
      ? {
          backlog: "待规划",
          todo: "待处理",
          in_progress: "进行中",
          blocked: "阻塞",
          in_review: "审核中",
          done: "已完成",
          cancelled: "已取消",
        }
      : {
          backlog: "Backlog",
          todo: "Todo",
          in_progress: "In progress",
          blocked: "Blocked",
          in_review: "In review",
          done: "Done",
          cancelled: "Cancelled",
        };

  const disclosure = $("#source-status-disclosure");
  disclosure.open = localStorage.getItem("tableai-source-expanded") === "true";
  disclosure.addEventListener("toggle", () =>
    localStorage.setItem("tableai-source-expanded", String(disclosure.open)),
  );

  window.loadTaskWorkspace = async function loadTaskWorkspace() {
    try {
      if (!initialized) {
        await Promise.all([loadContext(), loadSavedViews()]);
        bindContextOptions();
        initialized = true;
      }
      await loadTasks();
    } catch (error) {
      taskNotice(error.message, true);
    }
  };

  async function loadContext(query = "") {
    const body = await request(
      `/api/admin/v1/task-context${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    );
    contextData = body.data || { projects: [], people: [], milestones: [] };
    organizationId = body.meta?.organizationId || organizationId;
    renderPeople();
    renderMilestones();
    connectRealtime();
  }

  function mutationHeaders(version) {
    return {
      "Idempotency-Key":
        globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      ...(version ? { "If-Match": String(version) } : {}),
    };
  }
  function realtimeState(state) {
    const node = $("#task-realtime-status");
    if (!node) return;
    node.dataset.state = state;
    node.textContent =
      state === "online"
        ? t("realtimeOnline")
        : state === "connecting"
          ? t("realtimeConnecting")
          : t("realtimeOffline");
  }
  function connectRealtime() {
    if (
      !organizationId ||
      realtime?.readyState === WebSocket.OPEN ||
      realtime?.readyState === WebSocket.CONNECTING
    )
      return;
    clearTimeout(realtimeRetry);
    realtimeState("connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:",
      url = new URL(`${protocol}//${location.host}/api/task/v1/realtime`);
    url.searchParams.set("organizationId", organizationId);
    url.searchParams.set("cursor", String(realtimeCursor));
    realtime = new WebSocket(url);
    realtime.addEventListener("open", () => {
      realtimeState("online");
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (realtime?.readyState === WebSocket.OPEN)
          realtime.send(JSON.stringify({ type: "ping" }));
      }, 15000);
    });
    realtime.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.sequence) {
        realtimeCursor = Math.max(realtimeCursor, Number(message.sequence));
        sessionStorage.setItem("tableai-task-cursor", String(realtimeCursor));
      }
      if (message.type === "event") {
        clearTimeout(realtimeReload);
        realtimeReload = setTimeout(() => {
          loadTasks().catch((error) => taskNotice(error.message, true));
          if (
            activeTask &&
            String(message.aggregateId) === String(activeTask.id)
          )
            fetchTaskRelations().catch(() => {});
        }, 80);
      }
    });
    realtime.addEventListener("close", () => {
      clearInterval(heartbeat);
      realtimeState("offline");
      realtimeRetry = setTimeout(
        connectRealtime,
        Math.min(10000, 1000 + Math.random() * 3000),
      );
    });
    realtime.addEventListener("error", () => realtime?.close());
  }
  function sendPresence(type, taskId = null) {
    if (realtime?.readyState === WebSocket.OPEN)
      realtime.send(JSON.stringify({ type, taskId }));
  }

  function replaceOptions(select, items, label, placeholder) {
    const selected = select.value;
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.append(empty);
    for (const item of items) {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = label(item);
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === selected))
      select.value = selected;
  }

  function bindContextOptions() {
    const datalist = $("#task-project-options");
    datalist.replaceChildren();
    for (const project of contextData.projects) {
      const option = document.createElement("option");
      option.value = projectLabel(project);
      datalist.append(option);
    }
    for (const select of document.querySelectorAll('select[name="projectId"]'))
      replaceOptions(
        select,
        contextData.projects,
        (item) => projectLabel(item),
        locale === "zh-CN" ? "不关联项目" : "No project",
      );
    for (const select of document.querySelectorAll(
      'select[name="owner"],select[name="ownerId"]',
    ))
      replaceOptions(
        select,
        contextData.people.filter((item) => item.kind !== "contact"),
        (item) => `${item.display_name || item.displayName} / ${item.kind}`,
        locale === "zh-CN" ? "全部 / 暂不指派" : "All / unassigned",
      );
    for (const select of document.querySelectorAll(
      'select[name="participant"]',
    ))
      replaceOptions(
        select,
        contextData.people,
        (item) => `${item.display_name || item.displayName} / ${item.kind}`,
        locale === "zh-CN" ? "全部对接人" : "All counterparts",
      );
    for (const select of document.querySelectorAll(
      'select[name="milestone"],select[name="milestoneId"]',
    ))
      replaceOptions(
        select,
        contextData.milestones,
        (item) => item.name,
        locale === "zh-CN" ? "全部 / 无里程碑" : "All / no milestone",
      );
  }

  function projectLabel(project) {
    return `${project.name}${project.source_ref ? ` / ${project.source_ref}` : ""}`;
  }
  function syncProjectPicker(input, id) {
    const project = contextData.projects.find(
      (item) => String(item.id) === String(id || ""),
    );
    input.value = project ? projectLabel(project) : "";
  }
  document.querySelectorAll("[data-project-picker]").forEach((input) => {
    const update = () => {
      const hidden = input.parentElement.querySelector('input[type="hidden"]'),
        project = contextData.projects.find(
          (item) => projectLabel(item) === input.value.trim(),
        );
      hidden.value = project ? String(project.id) : "";
      if (input.closest("#task-filters")) {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(
          () => loadTasks().catch((error) => taskNotice(error.message, true)),
          120,
        );
      }
    };
    input.addEventListener("input", update);
    input.addEventListener("change", () => {
      update();
      const project = contextData.projects.find(
        (item) => projectLabel(item) === input.value.trim(),
      );
      if (input.value.trim() && !project)
        taskNotice(
          locale === "zh-CN"
            ? "请选择建议列表中的项目。"
            : "Choose a project from the suggestions.",
          true,
        );
    });
  });

  function taskQuery() {
    const form = new FormData($("#task-filters")),
      query = new URLSearchParams({ limit: "200" });
    for (const [key, value] of form.entries())
      if (String(value).trim()) query.set(key, String(value).trim());
    return query;
  }
  async function loadTasks() {
    const body = await request(`/api/admin/v1/tasks?${taskQuery()}`);
    items = body.data || [];
    const summary = body.meta?.summary || {};
    $("#task-metric-open").textContent = summary.open || 0;
    $("#task-metric-due-soon").textContent = summary.dueSoon || 0;
    $("#task-metric-unassigned").textContent = summary.unassigned || 0;
    $("#task-metric-value").textContent = money(
      summary.openExpectedValue || 0,
      "CNY",
    );
    renderCurrentView();
  }

  function renderCurrentView() {
    for (const button of document.querySelectorAll("[data-task-view]"))
      button.classList.toggle("active", button.dataset.taskView === taskView);
    $("#task-list-view").hidden = taskView !== "list";
    $("#task-board-view").hidden = taskView !== "board";
    $("#task-gantt-view").hidden = taskView !== "gantt";
    if (taskView === "list") renderTaskList();
    else if (taskView === "board") renderTaskBoard();
    else renderTaskGantt();
  }

  function renderTaskList() {
    const target = $("#task-list-rows");
    target.replaceChildren();
    if (!items.length) return target.append(emptyState());
    for (const task of items) {
      const row = document.createElement("article");
      row.className = "task-row";
      const main = document.createElement("div");
      main.className = "task-row-main";
      const priority = document.createElement("span");
      priority.className = `task-priority p${task.priority}`;
      const title = taskButton(task);
      const meta = document.createElement("small");
      meta.append(
        statusPill(task.status),
        document.createTextNode(
          ` ${task.identifier}${task.deliveryDomain ? ` / ${task.deliveryDomain}` : ""}`,
        ),
      );
      main.append(priority, title, meta);
      const project = document.createElement("div");
      project.append(textNode(task.projectName || unassigned("project")));
      const milestone = document.createElement("small");
      milestone.textContent = task.milestoneName || unassigned("milestone");
      project.append(milestone);
      const owner = document.createElement("div");
      owner.append(textNode(task.ownerName || unassigned("owner")));
      const ownerKind = document.createElement("small");
      ownerKind.textContent = task.ownerKind || "";
      owner.append(ownerKind);
      const schedule = document.createElement("div");
      const date = document.createElement("span");
      date.textContent = dateRange(task.startAt, task.dueAt);
      schedule.append(date);
      const risk = document.createElement("small");
      risk.textContent = taskRisk(task);
      schedule.append(risk);
      const value = document.createElement("div");
      const amount = document.createElement("div");
      amount.className = "task-value";
      amount.textContent =
        task.expectedValue == null
          ? "-"
          : money(task.expectedValue, task.currency);
      const impact = document.createElement("span");
      impact.className = "task-strategic";
      impact.textContent = task.strategicValue
        ? `${locale === "zh-CN" ? "战略价值" : "Impact"} ${task.strategicValue}/5${task.valueConfidence != null ? ` / ${task.valueConfidence}%` : ""}`
        : "-";
      value.append(amount, impact);
      row.append(main, project, owner, schedule, value);
      target.append(row);
    }
  }

  function renderTaskBoard() {
    const target = $("#task-board-view");
    target.replaceChildren();
    for (const status of statusOrder) {
      const column = document.createElement("section");
      column.className = "task-board-column";
      column.dataset.status = status;
      const header = document.createElement("header"),
        name = document.createElement("span"),
        count = document.createElement("span");
      name.textContent = statusLabels[status];
      const values = items.filter((task) => task.status === status);
      count.textContent = String(values.length);
      header.append(name, count);
      const cards = document.createElement("div");
      cards.className = "task-board-cards";
      for (const task of values) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "task-board-card";
        const title = document.createElement("strong"),
          detail = document.createElement("small");
        title.textContent = task.title;
        detail.textContent = `${task.identifier} / ${task.projectName || unassigned("project")} / ${task.dueAt ? shortDate(task.dueAt) : "-"}`;
        card.append(title, detail);
        card.addEventListener("click", () => openTask(task.id));
        cards.append(card);
      }
      column.append(header, cards);
      target.append(column);
    }
  }

  function renderTaskGantt() {
    const head = $("#task-gantt-head"),
      rows = $("#task-gantt-rows");
    head.replaceChildren();
    rows.replaceChildren();
    const scheduled = items.filter((task) => task.startAt || task.dueAt);
    if (!scheduled.length) {
      rows.append(
        emptyState(
          locale === "zh-CN"
            ? "当前筛选没有已排期任务。"
            : "No scheduled tasks match the filters.",
        ),
      );
      return;
    }
    let min = Math.min(
        ...scheduled.map((task) =>
          new Date(task.startAt || task.dueAt).getTime(),
        ),
      ),
      max = Math.max(
        ...scheduled.map((task) =>
          new Date(task.dueAt || task.startAt).getTime(),
        ),
      );
    const day = 86400000;
    if (max - min < 14 * day) max = min + 14 * day;
    const span = max - min;
    const label = document.createElement("div");
    label.className = "task-gantt-label";
    label.textContent = locale === "zh-CN" ? "任务 / 项目" : "Task / project";
    const axis = document.createElement("div");
    axis.className = "task-gantt-axis";
    for (let i = 0; i < 12; i++) {
      const tick = document.createElement("span");
      tick.textContent = shortDate(
        new Date(min + (span * i) / 11).toISOString(),
      );
      axis.append(tick);
    }
    head.append(label, axis);
    for (const task of scheduled) {
      const row = document.createElement("div");
      row.className = "task-gantt-row";
      const info = document.createElement("div");
      info.className = "task-gantt-label";
      const button = taskButton(task),
        small = document.createElement("small");
      small.textContent = `${task.projectName || unassigned("project")} / ${task.ownerName || unassigned("owner")}`;
      info.append(button, small);
      const track = document.createElement("div");
      track.className = "task-gantt-track";
      const start = new Date(task.startAt || task.dueAt).getTime(),
        end = new Date(task.dueAt || task.startAt).getTime();
      const bar = document.createElement("div");
      bar.className = `task-gantt-bar ${isOverdue(task) ? "is-overdue" : ""} ${task.status === "blocked" ? "is-blocked" : ""}`;
      bar.style.left = `${Math.max(0, ((start - min) / span) * 100)}%`;
      bar.style.width = `${Math.max(0.7, ((Math.max(end, start + day) - start) / span) * 100)}%`;
      bar.textContent = task.identifier;
      bar.title = `${task.title} / ${dateRange(task.startAt, task.dueAt)}`;
      track.append(bar);
      row.append(info, track);
      rows.append(row);
    }
  }

  async function openTask(id) {
    try {
      const body = await request(
        `/api/admin/v1/tasks/${encodeURIComponent(id)}`,
      );
      activeTask = body.data;
      const form = $("#task-editor-form");
      form.elements.id.value = activeTask.id;
      form.elements.title.value = activeTask.title || "";
      form.elements.description.value = activeTask.description || "";
      for (const key of [
        "status",
        "priority",
        "projectId",
        "milestoneId",
        "ownerId",
        "deliveryDomain",
        "expectedValue",
        "valueConfidence",
        "strategicValue",
      ]) {
        const field = form.elements[key];
        if (field) field.value = activeTask[key] ?? "";
      }
      form.elements.startAt.value = dateInput(activeTask.startAt);
      form.elements.dueAt.value = dateInput(activeTask.dueAt);
      $("#task-editor-identifier").textContent = activeTask.identifier;
      $("#task-editor-title").textContent = activeTask.title;
      renderTaskRelations(activeTask);
      populateDependencyOptions();
      populateParticipantOptions();
      if (!$("#task-dialog").open) $("#task-dialog").showModal();
      sendPresence("presence.viewing", activeTask.id);
    } catch (error) {
      taskNotice(error.message, true);
    }
  }

  function renderTaskRelations(task) {
    const participants = $("#task-participant-list"),
      dependencies = $("#task-dependency-list"),
      comments = $("#task-comment-list");
    participants.replaceChildren();
    dependencies.replaceChildren();
    comments.replaceChildren();
    if (!task.participants?.length)
      participants.append(
        emptyState(locale === "zh-CN" ? "暂无参与者" : "No participants"),
      );
    else
      for (const participant of task.participants) {
        const row = document.createElement("div");
        row.className = "task-relation-row";
        const label = textNode(
            `${participant.display_name || participant.displayName} / ${participant.role}`,
          ),
          remove = document.createElement("button");
        remove.type = "button";
        remove.className = "task-relation-remove";
        remove.textContent = "×";
        remove.setAttribute(
          "aria-label",
          locale === "zh-CN"
            ? `移除 ${participant.display_name || participant.displayName}`
            : `Remove ${participant.display_name || participant.displayName}`,
        );
        remove.addEventListener("click", () =>
          replaceTaskParticipants(
            task.participants.filter((item) => item.id !== participant.id),
          ),
        );
        row.append(label, remove);
        participants.append(row);
      }
    if (!task.dependencies?.length)
      dependencies.append(
        emptyState(locale === "zh-CN" ? "无前置依赖" : "No dependencies"),
      );
    else
      for (const dependency of task.dependencies) {
        const row = document.createElement("div");
        row.className = "task-relation-row";
        row.append(
          textNode(`${dependency.identifier} / ${dependency.title}`),
          statusPill(dependency.status),
        );
        dependencies.append(row);
      }
    if (!task.comments?.length)
      comments.append(
        emptyState(locale === "zh-CN" ? "暂无评论" : "No comments"),
      );
    else
      for (const comment of task.comments) {
        const row = document.createElement("div");
        row.className = "task-relation-row";
        const body = document.createElement("span"),
          meta = document.createElement("small");
        body.textContent = comment.body;
        meta.textContent = `${comment.actor_type} / ${shortDate(comment.created_at)}`;
        row.append(body, meta);
        comments.append(row);
      }
  }
  function populateDependencyOptions() {
    const select = $("#task-dependency-select");
    replaceOptions(
      select,
      items.filter((task) => task.id !== activeTask?.id),
      (task) => `${task.identifier} / ${task.title}`,
      locale === "zh-CN" ? "选择前置任务" : "Choose dependency",
    );
  }
  function populateParticipantOptions() {
    const selected = new Set(
        (activeTask?.participants || []).map((item) => item.id),
      ),
      select = $("#task-participant-select");
    replaceOptions(
      select,
      contextData.people.filter((item) => !selected.has(item.id)),
      (item) => `${item.display_name || item.displayName} / ${item.kind}`,
      locale === "zh-CN" ? "选择参与者" : "Choose participant",
    );
  }
  function refreshRelationsFrom(detail) {
    activeTask = {
      ...activeTask,
      participants: detail.participants || [],
      dependencies: detail.dependencies || [],
      comments: detail.comments || [],
      activity: detail.activity || [],
    };
    renderTaskRelations(activeTask);
    populateDependencyOptions();
    populateParticipantOptions();
  }
  async function fetchTaskRelations() {
    if (!activeTask) return;
    const body = await request(
      `/api/admin/v1/tasks/${encodeURIComponent(activeTask.id)}`,
    );
    refreshRelationsFrom(body.data);
  }
  async function replaceTaskParticipants(participants) {
    if (!activeTask) return;
    try {
      const body = await request(
        `/api/admin/v1/tasks/${activeTask.id}/participants`,
        {
          method: "PUT",
          headers: mutationHeaders(),
          body: JSON.stringify({
            participants: participants.map((item) => ({
              personId: item.id,
              role: item.role || "collaborator",
            })),
          }),
        },
      );
      refreshRelationsFrom(body.data);
    } catch (error) {
      taskNotice(error.message, true);
    }
  }

  function openQuickTask() {
    if ($("#dashboard").hidden || document.querySelector("dialog[open]"))
      return;
    const form = $("#quick-task-form");
    form.reset();
    form.elements.priority.value = "2";
    form.removeAttribute("aria-busy");
    const submit = $("#quick-task-submit"),
      error = $("#quick-task-error");
    submit.disabled = false;
    submit.querySelector("[data-submit-label]").textContent =
      translations[locale].createTask;
    error.hidden = true;
    error.textContent = "";
    $("#quick-task-dialog").showModal();
    setTimeout(() => form.elements.title.focus(), 0);
  }
  $("#quick-task-open").addEventListener("click", openQuickTask);
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k")
      return;
    event.preventDefault();
    openQuickTask();
  });
  $("#quick-task-form").elements.title.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.repeat) return;
    event.preventDefault();
    const form = event.currentTarget.form;
    if (form.reportValidity()) form.requestSubmit($("#quick-task-submit"));
  });

  $("#quick-task-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      submit = $("#quick-task-submit"),
      errorNode = $("#quick-task-error"),
      body = formObject(form);
    if (submit.disabled) return;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    submit.querySelector("[data-submit-label]").textContent =
      translations[locale].creatingTask;
    errorNode.hidden = true;
    errorNode.textContent = "";
    try {
      await request("/api/admin/v1/tasks", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify(body),
      });
      $("#quick-task-dialog").close();
      taskNotice(locale === "zh-CN" ? "任务已创建。" : "Task created.");
      await loadTasks();
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      taskNotice(error.message, true);
      form.elements.title.focus();
    } finally {
      submit.disabled = false;
      form.removeAttribute("aria-busy");
      submit.querySelector("[data-submit-label]").textContent =
        translations[locale].createTask;
    }
  });
  $("#task-editor-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      id = form.elements.id.value,
      body = formObject(form),
      version = activeTask?.version;
    delete body.id;
    body.version = version;
    try {
      const result = await request(
        `/api/admin/v1/tasks/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: mutationHeaders(version),
          body: JSON.stringify(body),
        },
      );
      activeTask = result.data;
      $("#task-dialog").close();
      taskNotice(locale === "zh-CN" ? "任务已更新。" : "Task updated.");
      await loadTasks();
    } catch (error) {
      if (error.status === 409 && error.code === "version_conflict") {
        activeTask = { ...activeTask, ...error.details?.current };
        taskNotice(
          locale === "zh-CN"
            ? "该任务刚被其他成员更新。已保留你的表单，请检查冲突后再次保存。"
            : "Another collaborator updated this task. Your form is preserved; review the conflict and save again.",
          true,
        );
      } else taskNotice(error.message, true);
    }
  });
  $("#add-task-dependency").addEventListener("click", async () => {
    const dependsOnTaskId = $("#task-dependency-select").value;
    if (!activeTask || !dependsOnTaskId) return;
    try {
      await request(`/api/admin/v1/tasks/${activeTask.id}/dependencies`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ dependsOnTaskId }),
      });
      await fetchTaskRelations();
    } catch (error) {
      taskNotice(error.message, true);
    }
  });
  $("#add-task-participant").addEventListener("click", async () => {
    const personId = $("#task-participant-select").value,
      role = $("#task-participant-role").value;
    if (!activeTask || !personId) return;
    await replaceTaskParticipants([
      ...(activeTask.participants || []),
      { id: personId, role },
    ]);
  });
  $("#add-task-comment").addEventListener("click", async () => {
    const body = $("#task-comment-input").value.trim();
    if (!activeTask || !body) return;
    try {
      await request(`/api/admin/v1/tasks/${activeTask.id}/comments`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ body }),
      });
      $("#task-comment-input").value = "";
      await fetchTaskRelations();
    } catch (error) {
      taskNotice(error.message, true);
    }
  });

  $("#task-filters").addEventListener("submit", (event) => {
    event.preventDefault();
    loadTasks().catch((error) => taskNotice(error.message, true));
  });
  $("#task-filters").addEventListener("change", () =>
    loadTasks().catch((error) => taskNotice(error.message, true)),
  );
  $("#task-filters input[name=q]").addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(
      () => loadTasks().catch((error) => taskNotice(error.message, true)),
      180,
    );
  });
  $("#reset-task-filters").addEventListener("click", () => {
    const form = $("#task-filters");
    form.reset();
    for (const hidden of form.querySelectorAll('input[type="hidden"]'))
      hidden.value = "";
    taskNotice("");
    loadTasks().catch((error) => taskNotice(error.message, true));
  });
  document.querySelectorAll("[data-task-view]").forEach((button) =>
    button.addEventListener("click", () => {
      taskView = button.dataset.taskView;
      localStorage.setItem("tableai-task-view", taskView);
      renderCurrentView();
    }),
  );

  async function loadSavedViews() {
    const body = await request("/api/admin/v1/task-views"),
      select = $("#task-saved-view");
    select.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = locale === "zh-CN" ? "保存的视图" : "Saved views";
    select.append(option);
    for (const view of body.data || []) {
      const node = document.createElement("option");
      node.value = view.id;
      node.textContent = view.name;
      node.dataset.view = JSON.stringify(view);
      select.append(node);
    }
  }
  $("#task-saved-view").addEventListener("change", (event) => {
    const option = event.currentTarget.selectedOptions[0];
    if (!option?.dataset.view) return;
    const view = JSON.parse(option.dataset.view);
    taskView = view.viewType || "list";
    for (const [key, value] of Object.entries(view.filters || {})) {
      const field = $("#task-filters").elements[key];
      if (field) field.value = String(value ?? "");
    }
    const projectInput = $("#task-filters [data-project-picker]");
    syncProjectPicker(projectInput, $("#task-filters").elements.project.value);
    renderCurrentView();
    loadTasks().catch((error) => taskNotice(error.message, true));
  });
  $("#save-task-view").addEventListener("click", async () => {
    const name = $("#task-view-name").value.trim();
    if (!name)
      return taskNotice(
        locale === "zh-CN" ? "请输入视图名称。" : "Enter a view name.",
        true,
      );
    const filters = Object.fromEntries(
      [...new FormData($("#task-filters"))].filter(([, value]) =>
        String(value).trim(),
      ),
    );
    try {
      await request("/api/admin/v1/task-views", {
        method: "POST",
        body: JSON.stringify({
          name,
          viewType: taskView,
          filters,
          sortBy: filters.sort || "updated",
        }),
      });
      $("#task-view-name").value = "";
      await loadSavedViews();
      taskNotice(locale === "zh-CN" ? "视图已保存。" : "View saved.");
    } catch (error) {
      taskNotice(error.message, true);
    }
  });

  $("#task-person-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request("/api/admin/v1/task-people", {
        method: "POST",
        body: JSON.stringify(formObject(form)),
      });
      form.reset();
      await loadContext();
      bindContextOptions();
      taskNotice(
        locale === "zh-CN" ? "目录成员已添加。" : "Directory entry added.",
      );
    } catch (error) {
      taskNotice(error.message, true);
    }
  });
  function renderPeople() {
    const target = $("#task-people-list");
    target.replaceChildren();
    for (const person of contextData.people || []) {
      const chip = document.createElement("span");
      chip.className = "task-person-chip";
      chip.textContent = `${person.display_name || person.displayName} / ${person.kind}${person.handle ? ` / ${person.handle}` : ""}`;
      target.append(chip);
    }
  }
  $("#task-milestone-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request("/api/admin/v1/task-milestones", {
        method: "POST",
        body: JSON.stringify(formObject(form)),
      });
      form.reset();
      await loadContext();
      bindContextOptions();
      taskNotice(locale === "zh-CN" ? "里程碑已添加。" : "Milestone added.");
    } catch (error) {
      taskNotice(error.message, true);
    }
  });
  function renderMilestones() {
    const target = $("#task-milestone-list");
    target.replaceChildren();
    for (const milestone of contextData.milestones || []) {
      const chip = document.createElement("span");
      chip.className = "task-person-chip";
      chip.textContent = `${milestone.name}${milestone.target_at ? ` / ${shortDate(milestone.target_at)}` : ""} / ${milestone.status}`;
      target.append(chip);
    }
  }

  function formObject(form) {
    const result = {};
    for (const [key, value] of new FormData(form)) {
      const clean = String(value).trim();
      if (!clean) result[key] = null;
      else if (
        [
          "priority",
          "expectedValue",
          "valueConfidence",
          "strategicValue",
        ].includes(key)
      )
        result[key] = Number(clean);
      else if (["startAt", "dueAt", "targetAt"].includes(key))
        result[key] = `${clean}T12:00:00.000Z`;
      else result[key] = clean;
    }
    return result;
  }
  function taskButton(task) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "task-title-button";
    button.textContent = task.title;
    button.addEventListener("click", () => openTask(task.id));
    return button;
  }
  function statusPill(status) {
    const span = document.createElement("span");
    span.className = "task-status";
    span.dataset.status = status;
    span.textContent = statusLabels[status] || status;
    return span;
  }
  function emptyState(
    message = locale === "zh-CN" ? "暂无任务。" : "No tasks yet.",
  ) {
    const node = document.createElement("div");
    node.className = "task-empty";
    node.textContent = message;
    return node;
  }
  function textNode(value) {
    const span = document.createElement("span");
    span.textContent = value;
    return span;
  }
  function taskNotice(message, error = false) {
    const node = $("#task-notice");
    node.textContent = message;
    node.classList.toggle("error", error);
  }
  function money(value, currency = "CNY") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  }
  function shortDate(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year:
        new Date(value).getFullYear() !== new Date().getFullYear()
          ? "numeric"
          : undefined,
    }).format(new Date(value));
  }
  function dateRange(start, due) {
    if (!start && !due) return locale === "zh-CN" ? "未排期" : "Unscheduled";
    if (start && due) return `${shortDate(start)} - ${shortDate(due)}`;
    return shortDate(start || due);
  }
  function dateInput(value) {
    return value ? new Date(value).toISOString().slice(0, 10) : "";
  }
  function isOverdue(task) {
    return (
      task.dueAt &&
      !["done", "cancelled"].includes(task.status) &&
      new Date(task.dueAt) < new Date()
    );
  }
  function taskRisk(task) {
    if (task.status === "blocked")
      return locale === "zh-CN" ? "阻塞" : "Blocked";
    if (isOverdue(task)) return locale === "zh-CN" ? "已逾期" : "Overdue";
    if (task.blockedByCount)
      return locale === "zh-CN"
        ? `${task.blockedByCount} 个未完成依赖`
        : `${task.blockedByCount} incomplete dependencies`;
    return task.dependencyCount
      ? `${task.dependencyCount} ${locale === "zh-CN" ? "个依赖" : "dependencies"}`
      : "";
  }
  function unassigned(kind) {
    const zh = {
        project: "未关联项目",
        milestone: "无里程碑",
        owner: "未指派",
      },
      en = {
        project: "No project",
        milestone: "No milestone",
        owner: "Unassigned",
      };
    return (locale === "zh-CN" ? zh : en)[kind];
  }
})();
