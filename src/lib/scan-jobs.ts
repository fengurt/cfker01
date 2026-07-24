export async function ensureDueScanJobs(env: Env, now = new Date()): Promise<number> {
  const stamp = now.toISOString();
  await env.MGMT_DB.prepare(`
    UPDATE scan_jobs SET status='failed',lease_owner=NULL,lease_until=NULL,completed_at=?1,updated_at=?1,
      error_code='lease_exhausted',error_message='Scanner lease expired and the retry limit was reached.'
    WHERE status IN ('claimed','running') AND lease_until IS NOT NULL AND lease_until<?1
      AND cancel_requested=0 AND attempt>=max_attempts
  `).bind(stamp).run();
  await env.MGMT_DB.prepare(`
    UPDATE scan_jobs SET status='queued',lease_owner=NULL,lease_until=NULL,updated_at=?1,
      error_code='lease_expired',error_message='Previous scanner lease expired.'
    WHERE status IN ('claimed','running') AND lease_until IS NOT NULL AND lease_until<?1
      AND cancel_requested=0 AND attempt<max_attempts
  `).bind(stamp).run();
  await env.MGMT_DB.prepare(`
    UPDATE scan_jobs SET status='cancelled',completed_at=?1,updated_at=?1
    WHERE status IN ('queued','claimed') AND cancel_requested=1
  `).bind(stamp).run();
  const due = await env.MGMT_DB.prepare(`
    SELECT c.* FROM source_connectors c
    WHERE c.enabled=1 AND (c.next_due_at IS NULL OR c.next_due_at<=?1)
      AND NOT EXISTS(
        SELECT 1 FROM scan_jobs j WHERE j.connector_id=c.id
        AND j.status IN ('queued','claimed','running')
      )
  `).bind(stamp).all<Record<string, unknown>>();
  for (const connector of due.results ?? []) await createScanJob(env, String(connector.id), "incremental", "schedule", 0, stamp);
  return due.results?.length ?? 0;
}

export async function createScanJob(
  env: Env,
  connectorId: string,
  mode = "incremental",
  requestedBy = "admin",
  priority = 10,
  now = new Date().toISOString(),
): Promise<{ id: string; created: boolean }> {
  const existing = await env.MGMT_DB.prepare(`
    SELECT id FROM scan_jobs WHERE connector_id=?1 AND status IN ('queued','claimed','running')
    ORDER BY created_at DESC LIMIT 1
  `).bind(connectorId).first<{ id: string }>();
  if (existing) return { id: existing.id, created: false };
  const connector = await env.MGMT_DB.prepare(`SELECT id FROM source_connectors WHERE id=?1 AND enabled=1`)
    .bind(connectorId).first();
  if (!connector) throw new Error("connector_not_found_or_disabled");
  const id = crypto.randomUUID();
  await env.MGMT_DB.prepare(`
    INSERT INTO scan_jobs(id,connector_id,mode,status,priority,requested_by,queued_at,created_at,updated_at)
    VALUES(?1,?2,?3,'queued',?4,?5,?6,?6,?6)
  `).bind(id, connectorId, mode, priority, requestedBy, now).run();
  return { id, created: true };
}
