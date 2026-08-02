import assert from "node:assert/strict";
import { WebSocket } from "ws";

const base = process.env.TASK_CORE_TEST_URL || "http://127.0.0.1:8790";
const internalToken = process.env.TASK_CORE_INTERNAL_TOKEN || "test-internal";
const actorId = "00000000-0000-4000-8000-000000000001";
const suffix = Date.now().toString(36);
const internalHeaders = {
  "content-type": "application/json",
  "x-task-internal-token": internalToken,
  "x-task-actor-id": actorId,
  "x-task-actor-type": "system",
};

async function call(
  path,
  { method = "GET", body, headers = {}, expected = [200, 201] } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...internalHeaders, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  assert.ok(
    expected.includes(response.status),
    `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`,
  );
  return { response, ...payload };
}

const context = await call("/api/task/v1/context");
const organizationId = context.meta.organizationId;

const projectA = (
  await call("/api/task/v1/projects", {
    method: "POST",
    body: {
      organizationId,
      name: `Integration A ${suffix}`,
      slug: `integration-a-${suffix}`,
    },
  })
).data;
const projectB = (
  await call("/api/task/v1/projects", {
    method: "POST",
    body: {
      organizationId,
      name: `Integration B ${suffix}`,
      slug: `integration-b-${suffix}`,
    },
  })
).data;

const createPayload = {
  organizationId,
  title: `Task core integration ${suffix}`,
  projectId: projectA.id,
  priority: 1,
};
const created = await call("/api/task/v1/tasks", {
  method: "POST",
  headers: { "idempotency-key": `create-${suffix}` },
  body: createPayload,
});
const replayed = await call("/api/task/v1/tasks", {
  method: "POST",
  headers: { "idempotency-key": `create-${suffix}` },
  body: createPayload,
});
assert.equal(
  replayed.data.id,
  created.data.id,
  "idempotent task creation must return the first task",
);

const linked = await call(
  `/api/task/v1/tasks/${created.data.id}/project-links`,
  {
    method: "PUT",
    headers: { "idempotency-key": `link-${suffix}` },
    body: {
      organizationId,
      projectIds: [projectA.id, projectB.id],
      primaryProjectId: projectB.id,
    },
  },
);
assert.deepEqual(
  new Set(linked.data.projectIds),
  new Set([projectA.id, projectB.id]),
);
assert.equal(linked.data.projectName, projectB.name);

const boardA = (
  await call("/api/task/v1/boards", {
    method: "POST",
    body: {
      organizationId,
      name: `Board A ${suffix}`,
      slug: `board-a-${suffix}`,
    },
  })
).data;
const boardB = (
  await call("/api/task/v1/boards", {
    method: "POST",
    body: {
      organizationId,
      name: `Board B ${suffix}`,
      slug: `board-b-${suffix}`,
    },
  })
).data;
await call(`/api/task/v1/boards/${boardA.id}/tasks/${created.data.id}`, {
  method: "POST",
  headers: { "idempotency-key": `board-a-${suffix}` },
  body: { organizationId, laneKey: "todo", beforeRank: 100, afterRank: 200 },
});
await call(`/api/task/v1/boards/${boardB.id}/tasks/${created.data.id}`, {
  method: "POST",
  headers: { "idempotency-key": `board-b-${suffix}` },
  body: {
    organizationId,
    laneKey: "priority",
    beforeRank: 800,
    afterRank: 1000,
  },
});
const boardAView = await call(
  `/api/task/v1/boards/${boardA.id}?organizationId=${organizationId}`,
);
const boardBView = await call(
  `/api/task/v1/boards/${boardB.id}?organizationId=${organizationId}`,
);
assert.equal(boardAView.data.tasks[0].id, created.data.id);
assert.equal(boardBView.data.tasks[0].id, created.data.id);
assert.notEqual(
  boardAView.data.tasks[0].board.rank,
  boardBView.data.tasks[0].board.rank,
  "board rank must be independent",
);

const current = await call(
  `/api/task/v1/tasks/${created.data.id}?organizationId=${organizationId}`,
);
const updated = await call(`/api/task/v1/tasks/${created.data.id}`, {
  method: "PATCH",
  headers: {
    "if-match": String(current.data.version),
    "idempotency-key": `update-${suffix}`,
  },
  body: {
    organizationId,
    version: current.data.version,
    title: `Updated ${suffix}`,
  },
});
assert.equal(updated.data.version, current.data.version + 1);
const conflict = await call(`/api/task/v1/tasks/${created.data.id}`, {
  method: "PATCH",
  headers: {
    "if-match": String(current.data.version),
    "idempotency-key": `conflict-${suffix}`,
  },
  body: { organizationId, version: current.data.version, title: "stale edit" },
  expected: [409],
});
assert.equal(conflict.error.code, "version_conflict");
assert.equal(conflict.error.details.current.version, updated.data.version);

const commentBody = { organizationId, body: "Integration comment" };
const comment = await call(`/api/task/v1/tasks/${created.data.id}/comments`, {
  method: "POST",
  headers: { "idempotency-key": `comment-${suffix}` },
  body: commentBody,
});
const commentReplay = await call(
  `/api/task/v1/tasks/${created.data.id}/comments`,
  {
    method: "POST",
    headers: { "idempotency-key": `comment-${suffix}` },
    body: commentBody,
  },
);
assert.equal(comment.data.id, commentReplay.data.id);

const attachment = await call(
  `/api/task/v1/tasks/${created.data.id}/attachments`,
  {
    method: "POST",
    headers: { "idempotency-key": `attachment-${suffix}` },
    body: {
      organizationId,
      name: "architecture.pdf",
      mediaType: "application/pdf",
      sizeBytes: 2048,
      storageProvider: "cos",
      storageKey: `tasks/${created.data.id}/architecture.pdf`,
      checksum: "sha256:test",
    },
  },
);
const attachments = await call(
  `/api/task/v1/tasks/${created.data.id}/attachments?organizationId=${organizationId}`,
);
assert.equal(attachments.data[0].id, attachment.data.id);

const privateToProjectB = await call("/api/task/v1/tasks", {
  method: "POST",
  headers: { "idempotency-key": `project-b-only-${suffix}` },
  body: {
    organizationId,
    title: `Project B only ${suffix}`,
    projectId: projectB.id,
  },
});

const keyCreated = await call("/api/task/v1/api-keys", {
  method: "POST",
  body: {
    organizationId,
    name: `Scoped agent ${suffix}`,
    scopes: [
      "tasks:read",
      "tasks:write",
      "tasks:transition",
      "comments:write",
      "events:read",
    ],
    projectIds: [projectA.id],
    fieldPolicy: { denyTerminal: true },
  },
});
assert.match(keyCreated.data.key, /^tsk_/);
const scopedListResponse = await fetch(
  `${base}/api/task/v1/tasks?organizationId=${organizationId}`,
  { headers: { authorization: `Bearer ${keyCreated.data.key}` } },
);
assert.equal(scopedListResponse.status, 200);
const scopedList = await scopedListResponse.json();
assert.ok(scopedList.data.some((task) => task.id === created.data.id));
assert.ok(
  !scopedList.data.some((task) => task.id === privateToProjectB.data.id),
  "project-scoped keys must not list tasks from another project",
);
assert.equal(
  Number(scopedList.meta.summary.open),
  scopedList.data.filter((task) => !["done", "cancelled"].includes(task.status))
    .length,
  "project-scoped summary must use the same visibility boundary",
);
const scopedTaskResponse = await fetch(
  `${base}/api/task/v1/tasks/${privateToProjectB.data.id}?organizationId=${organizationId}`,
  { headers: { authorization: `Bearer ${keyCreated.data.key}` } },
);
assert.equal(scopedTaskResponse.status, 403);
const scopedBoardResponse = await fetch(
  `${base}/api/task/v1/boards/${boardA.id}?organizationId=${organizationId}`,
  { headers: { authorization: `Bearer ${keyCreated.data.key}` } },
);
assert.equal(scopedBoardResponse.status, 403);

const mcp = await call("/mcp/task", {
  method: "POST",
  body: {
    jsonrpc: "2.0",
    id: 1,
    method: "resources/read",
    params: { uri: "ops://tasks/snapshot" },
  },
});
assert.ok(mcp.result.contents[0].text.includes(created.data.id));

const events = await call(
  `/api/task/v1/events?organizationId=${organizationId}&cursor=0`,
);
assert.ok(events.data.some((event) => event.event_type === "task.created"));
assert.ok(events.data.some((event) => event.event_type === "comment.created"));

const websocketUrl = new URL(
  base.replace(/^http/, "ws") + "/api/task/v1/realtime",
);
websocketUrl.searchParams.set("organizationId", organizationId);
websocketUrl.searchParams.set("cursor", String(events.meta.cursor));
const ws = new WebSocket(websocketUrl, { headers: internalHeaders });
await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("WebSocket ready timeout")),
    5000,
  );
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "ready") {
      clearTimeout(timeout);
      resolve();
    }
  });
  ws.on("error", reject);
});
const eventPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("WebSocket event timeout")),
    5000,
  );
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "event" && message.eventType === "task.updated") {
      clearTimeout(timeout);
      resolve(message);
    }
  });
});
await call(`/api/task/v1/tasks/${created.data.id}`, {
  method: "PATCH",
  headers: {
    "if-match": String(updated.data.version),
    "idempotency-key": `realtime-${suffix}`,
  },
  body: {
    organizationId,
    version: updated.data.version,
    description: "realtime update",
  },
});
const realtimeEvent = await eventPromise;
assert.equal(realtimeEvent.aggregateId, created.data.id);
ws.close();

console.log(
  JSON.stringify({
    ok: true,
    organizationId,
    taskId: created.data.id,
    projects: 2,
    boards: 2,
    eventCursor: events.meta.cursor,
  }),
);
