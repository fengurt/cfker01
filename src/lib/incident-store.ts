import { classifyIncident, incidentFingerprint, notificationPlan, type IncidentFingerprintInput, type IncidentSignals, type IncidentSeverity } from "./incidents";

type IncidentRow = Record<string, unknown>;

export type OpenIncidentInput = IncidentFingerprintInput & IncidentSignals & {
  projectId?: string | null;
  title: string;
  summary: string;
  ownerUserId?: string | null;
};

export async function openIncident(env: Env, input: OpenIncidentInput): Promise<IncidentRow> {
  const now = new Date().toISOString();
  const fingerprint = incidentFingerprint(input);
  const severity = classifyIncident(input);
  const evidence = [...new Set(input.evidence ?? [])].map(String).sort();
  const existing = await env.MGMT_DB.prepare(`SELECT * FROM incidents WHERE fingerprint=?1`).bind(fingerprint).first<IncidentRow>();
  if (existing) {
    const nextSeverity = maxSeverity(String(existing.severity) as IncidentSeverity, severity);
    await env.MGMT_DB.prepare(`UPDATE incidents SET severity=?1,status=CASE WHEN status='resolved' THEN 'open' ELSE status END,last_detected_at=?2,resolved_at=CASE WHEN status='resolved' THEN NULL ELSE resolved_at END,recurrence_count=recurrence_count+1,version=version+1,updated_at=?2 WHERE id=?3`)
      .bind(nextSeverity, now, existing.id).run();
    await env.MGMT_DB.prepare(`INSERT INTO incident_events(id,incident_id,event_type,actor_type,data,created_at) VALUES(?1,?2,'recurred','system',?3,?4)`)
      .bind(crypto.randomUUID(), existing.id, JSON.stringify({ severity, evidence }), now).run();
    return (await getIncident(env, String(existing.id)))!;
  }

  const id = crypto.randomUUID();
  const taskLinkStatus = "pending";
  const statements = [
    env.MGMT_DB.prepare(`INSERT INTO incidents(id,fingerprint,severity,status,entity_type,entity_id,project_id,title,summary,root_cause,evidence,owner_user_id,task_link_status,first_detected_at,last_detected_at,created_at,updated_at) VALUES(?1,?2,?3,'open',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?13,?13)`)
      .bind(id, fingerprint, severity, input.entityType, input.entityId, input.projectId ?? null, input.title.slice(0, 240), input.summary.slice(0, 2000), input.rootCause.slice(0, 240), JSON.stringify(evidence), input.ownerUserId ?? null, taskLinkStatus, now),
    env.MGMT_DB.prepare(`INSERT INTO incident_events(id,incident_id,event_type,actor_type,data,created_at) VALUES(?1,?2,'opened','system',?3,?4)`)
      .bind(crypto.randomUUID(), id, JSON.stringify({ severity, evidence }), now),
    env.MGMT_DB.prepare(`INSERT INTO incident_task_outbox(id,incident_id,idempotency_key,next_attempt_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?4,?4)`)
      .bind(crypto.randomUUID(), id, `incident:${id}`, now),
    ...notificationPlan(severity, false).map((channel) => env.MGMT_DB.prepare(`INSERT INTO incident_notification_deliveries(id,incident_id,event_type,channel,status,next_attempt_at,created_at,updated_at) VALUES(?1,?2,'opened',?3,'pending',?4,?4,?4)`).bind(crypto.randomUUID(), id, channel, now)),
  ];
  await env.MGMT_DB.batch(statements);
  return (await getIncident(env, id))!;
}

export async function getIncident(env: Env, id: string): Promise<IncidentRow | null> {
  return env.MGMT_DB.prepare(`SELECT * FROM incidents WHERE id=?1`).bind(id).first<IncidentRow>();
}

export async function listIncidents(env: Env, filters: { status?: string | null; severity?: IncidentSeverity | null; projectId?: string | null; ownerUserId?: string | null; limit?: number } = {}): Promise<IncidentRow[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  for (const [value, column] of [[filters.status, "status"], [filters.severity, "severity"], [filters.projectId, "project_id"], [filters.ownerUserId, "owner_user_id"]] as const) {
    if (value) { values.push(value); where.push(`${column}=?${values.length}`); }
  }
  const limit = Math.min(200, Math.max(1, Number(filters.limit ?? 100)));
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.MGMT_DB.prepare(`SELECT * FROM incidents ${clause} ORDER BY CASE severity WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END,updated_at DESC LIMIT ?${values.length + 1}`).bind(...values, limit).all<IncidentRow>();
  return rows.results ?? [];
}

export async function updateIncident(env: Env, id: string, input: { version: number; status?: string; ownerUserId?: string | null; severity?: IncidentSeverity }): Promise<IncidentRow | null> {
  const existing = await getIncident(env, id);
  if (!existing) return null;
  const status = input.status ?? String(existing.status);
  if (!["open", "acknowledged", "in_progress", "resolved", "ignored"].includes(status)) throw new Error("invalid_incident_status");
  const severity = input.severity ?? String(existing.severity) as IncidentSeverity;
  if (!(severity in { p0: true, p1: true, p2: true, p3: true })) throw new Error("invalid_incident_severity");
  const now = new Date().toISOString();
  const resolvedAt = status === "resolved" || status === "ignored" ? now : null;
  const result = await env.MGMT_DB.prepare(`UPDATE incidents SET status=?1,severity=?2,owner_user_id=?3,resolved_at=CASE WHEN ?4 IS NULL THEN resolved_at ELSE ?4 END,version=version+1,updated_at=?5 WHERE id=?6 AND version=?7`).bind(status, severity, input.ownerUserId === undefined ? existing.owner_user_id ?? null : input.ownerUserId, resolvedAt, now, id, input.version).run();
  if (!result.meta?.changes) throw new Error("incident_version_conflict");
  await env.MGMT_DB.prepare(`INSERT INTO incident_events(id,incident_id,event_type,actor_type,data,created_at) VALUES(?1,?2,?3,'admin',?4,?5)`).bind(crypto.randomUUID(), id, status === "resolved" ? "resolved" : "updated", JSON.stringify({ status, severity }), now).run();
  return getIncident(env, id);
}

export async function resolveIncidentsForEntity(env: Env, entityType: string, entityId: string): Promise<number> {
  const now = new Date().toISOString();
  const rows = await env.MGMT_DB.prepare(`SELECT id,version FROM incidents WHERE entity_type=?1 AND entity_id=?2 AND status IN ('open','acknowledged','in_progress')`).bind(entityType, entityId).all<{ id: string; version: number }>();
  if (!rows.results?.length) return 0;
  const statements = rows.results.flatMap((row) => [
    env.MGMT_DB.prepare(`UPDATE incidents SET status='resolved',resolved_at=?1,version=version+1,updated_at=?1 WHERE id=?2 AND version=?3`).bind(now, row.id, row.version),
    env.MGMT_DB.prepare(`INSERT INTO incident_events(id,incident_id,event_type,actor_type,data,created_at) VALUES(?1,?2,'resolved','system',?3,?4)`).bind(crypto.randomUUID(), row.id, JSON.stringify({ reason: "health_recovered" }), now),
    env.MGMT_DB.prepare(`INSERT OR IGNORE INTO incident_notification_deliveries(id,incident_id,event_type,channel,status,next_attempt_at,created_at,updated_at) VALUES(?1,?2,'resolved','inbox','pending',?3,?3,?3)`).bind(crypto.randomUUID(), row.id, now),
  ]);
  await env.MGMT_DB.batch(statements);
  return rows.results.length;
}

function maxSeverity(left: IncidentSeverity, right: IncidentSeverity): IncidentSeverity {
  const rank: Record<IncidentSeverity, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
  return rank[left] <= rank[right] ? left : right;
}
