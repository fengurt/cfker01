import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "cancelled",
];
export const TRANSITIONS = {
  backlog: ["todo", "cancelled"],
  todo: ["backlog", "in_progress", "blocked", "cancelled"],
  in_progress: ["todo", "blocked", "in_review", "done", "cancelled"],
  blocked: ["todo", "in_progress", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["backlog"],
};
export const ROLES = { owner: 4, admin: 3, member: 2, guest: 1 };

export function uuid() {
  return randomUUID();
}
export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
export function hmac(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function safeEqual(a, b) {
  const left = Buffer.from(String(a)),
    right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function randomToken(prefix = "") {
  return prefix + randomBytes(32).toString("base64url");
}
export function cleanText(value, max = 240, required = false) {
  const out = String(value ?? "").trim();
  if (required && !out) throw apiError("required_field", 400);
  if (out.length > max) throw apiError("field_too_long", 400);
  return out || null;
}
export function iso(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw apiError("invalid_date", 400);
  return date.toISOString();
}
export function apiError(code, status = 400, details = null) {
  return Object.assign(new Error(code), { code, status, details });
}
export function parseVersion(request, body) {
  const header = request.headers["if-match"];
  const raw = header ? String(header).replace(/[^0-9]/g, "") : body?.version;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function canTransition(from, to) {
  return from === to || (TRANSITIONS[from] || []).includes(to);
}
export function serializeTask(row) {
  return {
    ...row,
    id: String(row.id),
    organizationId: String(row.organization_id),
    identifier: row.identifier,
    version: Number(row.version || 1),
    projectIds: row.project_ids || [],
    primaryProjectId: row.primary_project_id || null,
    projectId: row.primary_project_id || null,
    projectName: row.project_name || null,
    ownerId: row.owner_id ? String(row.owner_id) : null,
    ownerName: row.owner_name || null,
    ownerKind: row.owner_kind || null,
    milestoneId: row.milestone_id ? String(row.milestone_id) : null,
    milestoneName: row.milestone_name || null,
    startAt: row.start_at?.toISOString?.() ?? row.start_at,
    dueAt: row.due_at?.toISOString?.() ?? row.due_at,
    completedAt: row.completed_at?.toISOString?.() ?? row.completed_at,
    expectedValue:
      row.expected_value_minor == null
        ? null
        : Number(row.expected_value_minor) / 100,
    valueConfidence: row.value_confidence,
    strategicValue: row.strategic_value,
    deliveryDomain: row.delivery_domain,
    dependencyCount: Number(row.dependency_count || 0),
    blockedByCount: Number(row.blocked_by_count || 0),
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}
export function encryptSecret(secret, keyValue) {
  const key = Buffer.from(keyValue, "base64");
  if (key.length !== 32)
    throw new Error("TASK_ENCRYPTION_KEY must be base64-encoded 32 bytes");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]),
    tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64url");
}
export function decryptSecret(value, keyValue) {
  const key = Buffer.from(keyValue, "base64"),
    raw = Buffer.from(value, "base64url"),
    iv = raw.subarray(0, 12),
    tag = raw.subarray(12, 28),
    body = raw.subarray(28),
    cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
export function verifySessionCookie(cookie, secret) {
  const raw = String(cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("tableai_admin="))
    ?.slice(14);
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (
    !payload ||
    !signature ||
    !safeEqual(
      signature,
      createHmac("sha256", secret).update(payload).digest("base64url"),
    )
  )
    return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return parsed.uid && parsed.exp > Date.now() / 1000 ? parsed : null;
  } catch {
    return null;
  }
}
export function rankBetween(before, after) {
  const a = before == null ? null : Number(before),
    b = after == null ? null : Number(after);
  if (a == null && b == null) return 1000;
  if (a == null) return b - 1000;
  if (b == null) return a + 1000;
  if (!(a < b)) throw apiError("invalid_rank_bounds", 409);
  return (a + b) / 2;
}
