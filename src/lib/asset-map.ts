const ASSET_MAP_SCHEMA_VERSION = "1.0";
const PERIODIC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SCHEDULED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SNAPSHOT_CHUNK_FORMAT = "chunked-json-v1";
const SNAPSHOT_CHUNK_CHARS = 64 * 1024;

export type AssetMapNodeKind =
  | "local_path"
  | "repository"
  | "project"
  | "deployment"
  | "server"
  | "endpoint"
  | "service"
  | "cloud_asset";

export interface AssetMapNode {
  id: string;
  kind: AssetMapNodeKind;
  label: string;
  status: string;
  source: "scan" | "manual";
  updatedAt: string | null;
  metadata: Record<string, unknown>;
  annotation?: AssetMapAnnotation;
}

export interface AssetMapEdge {
  id: string;
  source: string;
  target: string;
  relationship: string;
  status: string;
  confidence: number;
  sourceType: "derived" | "scanner" | "manual";
  evidence: unknown[];
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AssetMapAnnotation {
  id: string;
  entityId: string;
  label: string | null;
  notes: string | null;
  tags: string[];
  source: string;
  actorType: string;
  actorId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetMapSnapshot {
  schemaVersion: string;
  generatedAt: string;
  fingerprint: string;
  summary: Record<
    AssetMapNodeKind | "edges" | "confirmedEdges" | "candidateEdges",
    number
  >;
  nodes: AssetMapNode[];
  edges: AssetMapEdge[];
  manualAnnotations: AssetMapAnnotation[];
  manualEdges: AssetMapEdge[];
}

export interface AssetMapActor {
  type: "admin" | "agent" | "system";
  id?: string | null;
}

type Row = Record<string, unknown>;

export async function getAssetMap(env: Env): Promise<AssetMapSnapshot> {
  const [
    repositories,
    projects,
    deployments,
    servers,
    assets,
    scannerLinks,
    annotationRows,
    manualEdgeRows,
  ] = await Promise.all([
    env.MGMT_DB.prepare(
      `SELECT id,project_id,canonical_key,github_owner,github_repo,repository_url,local_paths,head_sha,branch,dirty,ahead,behind,pushed_at,visibility,sync_status,deployment_status,last_scanned_at,updated_at FROM repository_snapshots ORDER BY canonical_key`,
    ).all<Row>(),
    env.MGMT_DB.prepare(
      `SELECT id,name,platform,source_kind,source_ref,homepage,repository_url,status,visibility,source_updated_at,last_scanned_at,updated_at FROM catalog_projects ORDER BY name`,
    ).all<Row>(),
    env.MGMT_DB.prepare(
      `SELECT id,project_id,server_id,environment,deployed_url,version,status,deployed_at,last_checked_at,updated_at FROM deployments ORDER BY id`,
    ).all<Row>(),
    env.MGMT_DB.prepare(
      `SELECT id,name,provider,ip_address,architecture,cpu,memory_mb,disk_gb,operating_system,due_at,health_url,public_url,status,last_checked_at,updated_at FROM servers ORDER BY name`,
    ).all<Row>(),
    env.MGMT_DB.prepare(
      `SELECT id,provider,account_id,kind,external_id,parent_external_id,name,status,region,url,server_id,project_id,metadata,last_seen_at,last_verified_at,updated_at FROM discovered_assets WHERE kind IN ('repository','project','skill','agent','runtime_service','compose_project','runtime_container','container','dns_domain','dns_record','worker','pages_project','edgeone_zone','cos_bucket','r2_bucket') ORDER BY kind,name`,
    ).all<Row>(),
    env.MGMT_DB.prepare(
      `SELECT id,source_asset_id,target_asset_id,project_id,relationship,confidence,status,evidence FROM resource_links WHERE status!='rejected' ORDER BY id`,
    ).all<Row>(),
    env.MGMT_DB.prepare(
      `SELECT * FROM asset_map_annotations ORDER BY entity_id`,
    ).all<Row>(),
    env.MGMT_DB.prepare(
      `SELECT * FROM asset_map_manual_edges ORDER BY source_id,target_id,relationship`,
    ).all<Row>(),
  ]);

  const nodes = new Map<string, AssetMapNode>();
  const edges = new Map<string, AssetMapEdge>();
  const annotations = (annotationRows.results ?? []).map(serializeAnnotation);
  const annotationByEntity = new Map(
    annotations.map((item) => [item.entityId, item]),
  );
  const addNode = (node: AssetMapNode) => {
    const annotation = annotationByEntity.get(node.id);
    nodes.set(node.id, {
      ...node,
      label: annotation?.label || node.label,
      annotation,
    });
  };
  const addEdge = (edge: Omit<AssetMapEdge, "id"> & { id?: string }) => {
    const id =
      edge.id ??
      edgeId(edge.source, edge.target, edge.relationship, edge.sourceType);
    if (nodes.has(edge.source) && nodes.has(edge.target))
      edges.set(id, { ...edge, id });
  };

  for (const row of servers.results ?? []) {
    addNode({
      id: `server:${row.id}`,
      kind: "server",
      label: text(row.name) || text(row.id),
      status: text(row.status) || "unknown",
      source: "scan",
      updatedAt: nullableText(row.last_checked_at ?? row.updated_at),
      metadata: compact({
        provider: row.provider,
        ipAddress: row.ip_address,
        architecture: row.architecture,
        cpu: row.cpu,
        memoryMb: row.memory_mb,
        diskGb: row.disk_gb,
        operatingSystem: row.operating_system,
        dueAt: row.due_at,
        healthUrl: row.health_url,
        publicUrl: row.public_url,
      }),
    });
  }

  for (const row of projects.results ?? []) {
    const projectId = `project:${row.id}`;
    addNode({
      id: projectId,
      kind: "project",
      label: text(row.name) || text(row.id),
      status: text(row.status) || "unknown",
      source: "scan",
      updatedAt: nullableText(
        row.source_updated_at ?? row.last_scanned_at ?? row.updated_at,
      ),
      metadata: compact({
        platform: row.platform,
        sourceKind: row.source_kind,
        sourceRef: row.source_ref,
        homepage: row.homepage,
        repositoryUrl: row.repository_url,
        visibility: row.visibility,
      }),
    });
    const sourceRef = text(row.source_ref);
    if (
      sourceRef &&
      [
        "local",
        "local-filesystem",
        "filesystem",
        "detected-project",
        "git-repository",
      ].includes(text(row.source_kind))
    ) {
      const localId = `local:${await digest(sourceRef)}`;
      const leaf = sourceRef.split("/").filter(Boolean).at(-1) || sourceRef;
      addNode({
        id: localId,
        kind: "local_path",
        label: leaf,
        status: "discovered",
        source: "scan",
        updatedAt: nullableText(row.last_scanned_at ?? row.updated_at),
        metadata: { path: sourceRef },
      });
      addEdge({
        source: localId,
        target: projectId,
        relationship: "contains_project",
        status: "confirmed",
        confidence: 1,
        sourceType: "derived",
        evidence: ["catalog_projects.source_ref"],
      });
    }
  }

  for (const row of repositories.results ?? []) {
    const repoId = `repository:${text(row.canonical_key)}`;
    addNode({
      id: repoId,
      kind: "repository",
      label: repositoryLabel(row),
      status: text(row.sync_status) || "unverified",
      source: "scan",
      updatedAt: nullableText(
        row.pushed_at ?? row.last_scanned_at ?? row.updated_at,
      ),
      metadata: compact({
        canonicalKey: row.canonical_key,
        githubOwner: row.github_owner,
        githubRepo: row.github_repo,
        repositoryUrl: row.repository_url,
        headSha: row.head_sha,
        branch: row.branch,
        dirty: Boolean(row.dirty),
        ahead: row.ahead,
        behind: row.behind,
        visibility: row.visibility,
        deploymentStatus: row.deployment_status,
      }),
    });
    for (const localPath of jsonStrings(row.local_paths)) {
      const localId = `local:${await digest(localPath)}`;
      const leaf = localPath.split("/").filter(Boolean).at(-1) || localPath;
      addNode({
        id: localId,
        kind: "local_path",
        label: leaf,
        status: Boolean(row.dirty) ? "dirty" : "tracked",
        source: "scan",
        updatedAt: nullableText(row.last_scanned_at ?? row.updated_at),
        metadata: { path: localPath },
      });
      addEdge({
        source: localId,
        target: repoId,
        relationship: "syncs_to",
        status: "confirmed",
        confidence: 1,
        sourceType: "derived",
        evidence: [
          "repository_snapshots.local_paths",
          `sync_status:${text(row.sync_status) || "unverified"}`,
        ],
      });
    }
    if (row.project_id)
      addEdge({
        source: repoId,
        target: `project:${row.project_id}`,
        relationship: "implements",
        status: "confirmed",
        confidence: 1,
        sourceType: "derived",
        evidence: ["repository_snapshots.project_id"],
      });
  }

  for (const row of deployments.results ?? []) {
    const deploymentId = `deployment:${row.id}`;
    addNode({
      id: deploymentId,
      kind: "deployment",
      label: `${text(row.environment) || "deployment"} · ${text(row.version) || text(row.id)}`,
      status: text(row.status) || "unknown",
      source: "scan",
      updatedAt: nullableText(
        row.last_checked_at ?? row.deployed_at ?? row.updated_at,
      ),
      metadata: compact({
        environment: row.environment,
        version: row.version,
        deployedUrl: row.deployed_url,
        deployedAt: row.deployed_at,
      }),
    });
    addEdge({
      source: `project:${row.project_id}`,
      target: deploymentId,
      relationship: "deploys_as",
      status: "confirmed",
      confidence: 1,
      sourceType: "derived",
      evidence: ["deployments.project_id"],
    });
    addEdge({
      source: deploymentId,
      target: `server:${row.server_id}`,
      relationship: "runs_on",
      status: "confirmed",
      confidence: 1,
      sourceType: "derived",
      evidence: ["deployments.server_id"],
    });
    if (row.deployed_url) {
      const endpointId = `endpoint:${await digest(normalizeUrl(text(row.deployed_url)))}`;
      addNode({
        id: endpointId,
        kind: "endpoint",
        label: text(row.deployed_url),
        status: text(row.status) || "unknown",
        source: "scan",
        updatedAt: nullableText(row.last_checked_at ?? row.updated_at),
        metadata: { url: row.deployed_url, origin: "deployment" },
      });
      addEdge({
        source: deploymentId,
        target: endpointId,
        relationship: "exposes",
        status: "confirmed",
        confidence: 1,
        sourceType: "derived",
        evidence: ["deployments.deployed_url"],
      });
    }
  }

  const assetNodeIds = new Map<string, string>();
  const localRepositories: Array<{
    path: string;
    localId: string;
    repositoryId: string | null;
  }> = [];
  const localSkills: Array<{ path: string; localId: string }> = [];
  for (const row of assets.results ?? []) {
    const metadata = safeMetadata(row.metadata);
    if (
      text(row.provider) === "local" &&
      ["repository", "project", "skill", "agent"].includes(text(row.kind))
    ) {
      const path =
        text(metadata.absolutePath) ||
        text(metadata.sourceRef) ||
        text(row.external_id);
      const nodeId = `local:${await digest(path)}`;
      assetNodeIds.set(text(row.id), nodeId);
      addNode({
        id: nodeId,
        kind: "local_path",
        label: text(row.name) || path.split("/").filter(Boolean).at(-1) || path,
        status:
          text(row.kind) === "repository"
            ? text(metadata.syncStatus) || text(row.status) || "unverified"
            : text(row.status) || "discovered",
        source: "scan",
        updatedAt: nullableText(
          metadata.sourceUpdatedAt ?? row.last_seen_at ?? row.updated_at,
        ),
        metadata: compact({
          path,
          scanRoot: metadata.scanRoot,
          relativePath: metadata.relativePath,
          resourceType: row.kind,
          resourceTypes: metadata.resourceTypes,
          frameworks: metadata.frameworks,
          languages: metadata.languages,
          repositoryUrl: metadata.repositoryUrl ?? row.url,
          headSha: metadata.headSha,
          githubHeadSha: metadata.githubHeadSha,
          branch: metadata.branch,
          dirty: metadata.dirty,
          ahead: metadata.ahead,
          behind: metadata.behind,
          skillPaths: metadata.skillPaths,
        }),
      });
      if (text(row.kind) === "skill") localSkills.push({ path, localId: nodeId });
      if (text(row.kind) === "repository") {
        const canonicalKey = repositoryKey(
          text(metadata.repositoryUrl) || text(row.url),
        );
        const repositoryId = canonicalKey
          ? `repository:${canonicalKey}`
          : null;
        localRepositories.push({ path, localId: nodeId, repositoryId });
        if (repositoryId) {
          if (!nodes.has(repositoryId))
            addNode({
              id: repositoryId,
              kind: "repository",
              label: canonicalKey!.replace(/^github\.com\//, ""),
              status: text(metadata.syncStatus) || "unverified",
              source: "scan",
              updatedAt: nullableText(row.last_seen_at ?? row.updated_at),
              metadata: compact({
                canonicalKey,
                repositoryUrl: metadata.repositoryUrl ?? row.url,
                headSha: metadata.headSha,
                githubHeadSha: metadata.githubHeadSha,
                branch: metadata.branch,
              }),
            });
          addEdge({
            source: nodeId,
            target: repositoryId,
            relationship: "syncs_to",
            status: "confirmed",
            confidence: 1,
            sourceType: "scanner",
            evidence: [
              "discovered_assets.metadata.repositoryUrl",
              `sync_status:${text(metadata.syncStatus) || "unverified"}`,
            ],
          });
        }
      }
      continue;
    }
    if (text(row.provider) === "github" && text(row.kind) === "repository") {
      const canonicalKey = repositoryKey(text(row.url));
      if (canonicalKey) {
        const nodeId = `repository:${canonicalKey}`;
        assetNodeIds.set(text(row.id), nodeId);
        if (!nodes.has(nodeId))
          addNode({
            id: nodeId,
            kind: "repository",
            label: text(row.name) || canonicalKey.replace(/^github\.com\//, ""),
            status: text(row.status) || "unknown",
            source: "scan",
            updatedAt: nullableText(row.last_seen_at ?? row.updated_at),
            metadata: compact({
              canonicalKey,
              repositoryUrl: row.url,
              accountId: row.account_id,
              ...metadata,
            }),
          });
        continue;
      }
    }
    const kind = assetKind(text(row.kind));
    const nodeId =
      kind === "endpoint" && row.url
        ? `endpoint:${await digest(normalizeUrl(text(row.url)))}`
        : `asset:${row.id}`;
    assetNodeIds.set(text(row.id), nodeId);
    if (!nodes.has(nodeId))
      addNode({
        id: nodeId,
        kind,
        label: text(row.url) || text(row.name) || text(row.external_id),
        status: text(row.status) || "unknown",
        source: "scan",
        updatedAt: nullableText(
          row.last_verified_at ?? row.last_seen_at ?? row.updated_at,
        ),
        metadata: compact({
          provider: row.provider,
          accountId: row.account_id,
          assetKind: row.kind,
          externalId: row.external_id,
          parentExternalId: row.parent_external_id,
          region: row.region,
          url: row.url,
          ...metadata,
        }),
      });
    if (row.server_id)
      addEdge({
        source: nodeId,
        target: `server:${row.server_id}`,
        relationship: kind === "service" ? "runs_on" : "associated_with",
        status: "confirmed",
        confidence: 1,
        sourceType: "scanner",
        evidence: ["discovered_assets.server_id"],
      });
    if (row.project_id)
      addEdge({
        source: nodeId,
        target: `project:${row.project_id}`,
        relationship: "belongs_to",
        status: "confirmed",
        confidence: 1,
        sourceType: "scanner",
        evidence: ["discovered_assets.project_id"],
      });
  }

  localRepositories.sort((a, b) => b.path.length - a.path.length);
  for (const skill of localSkills) {
    const owner = localRepositories.find(
      (repository) =>
        skill.path === `${repository.path}/SKILL.md` ||
        skill.path.startsWith(`${repository.path}/`),
    );
    if (!owner) continue;
    addEdge({
      source: owner.repositoryId || owner.localId,
      target: skill.localId,
      relationship: "contains_skill",
      status: "confirmed",
      confidence: 1,
      sourceType: "derived",
      evidence: ["tracked SKILL.md path within canonical repository"],
    });
  }

  for (const row of scannerLinks.results ?? []) {
    const source = assetNodeIds.get(text(row.source_asset_id));
    const target = row.target_asset_id
      ? assetNodeIds.get(text(row.target_asset_id))
      : row.project_id
        ? `project:${row.project_id}`
        : undefined;
    if (source && target)
      addEdge({
        id: `scanner:${row.id}`,
        source,
        target,
        relationship: text(row.relationship) || "associated_with",
        status: text(row.status) || "candidate",
        confidence: number(row.confidence, 0),
        sourceType: "scanner",
        evidence: jsonArray(row.evidence),
      });
  }

  const manualEdges = (manualEdgeRows.results ?? []).map(serializeManualEdge);
  for (const edge of manualEdges) if (edge.status !== "rejected") addEdge(edge);

  const sortedNodes = [...nodes.values()].sort(
    (a, b) =>
      kindOrder(a.kind) - kindOrder(b.kind) || a.label.localeCompare(b.label),
  );
  const sortedEdges = [...edges.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.relationship.localeCompare(b.relationship),
  );
  const generatedAt = new Date().toISOString();
  const fingerprint = await digest(
    stableJson({ nodes: sortedNodes.map(fingerprintNode), edges: sortedEdges }),
  );
  return {
    schemaVersion: ASSET_MAP_SCHEMA_VERSION,
    generatedAt,
    fingerprint,
    summary: summarize(sortedNodes, sortedEdges),
    nodes: sortedNodes,
    edges: sortedEdges,
    manualAnnotations: annotations,
    manualEdges,
  };
}

export async function createAssetMapVersion(
  env: Env,
  actor: AssetMapActor,
  reason = "manual",
  summary: string | null = null,
  force = false,
): Promise<Record<string, unknown>> {
  const snapshot = await getAssetMap(env);
  const latest = await env.MGMT_DB.prepare(
    `SELECT id,version,content_hash,created_at FROM asset_map_versions ORDER BY version DESC LIMIT 1`,
  ).first<Row>();
  if (!force && latest?.content_hash === snapshot.fingerprint)
    return { ...latest, skipped: true, reason: "unchanged" };
  const id = `mapv_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotChunks = chunkSnapshot(snapshotJson);
  const snapshotManifest = JSON.stringify({
    format: SNAPSHOT_CHUNK_FORMAT,
    chunkCount: snapshotChunks.length,
    contentLength: snapshotJson.length,
  });
  let version = Number(latest?.version ?? 0) + 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await env.MGMT_DB.batch([
        env.MGMT_DB.prepare(
          `INSERT INTO asset_map_versions(id,version,schema_version,content_hash,reason,snapshot,summary,actor_type,actor_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
        ).bind(
          id,
          version,
          ASSET_MAP_SCHEMA_VERSION,
          snapshot.fingerprint,
          clean(reason, 40),
          snapshotManifest,
          clean(summary, 500),
          actor.type,
          clean(actor.id, 200),
          createdAt,
        ),
        ...snapshotChunks.map((content, chunkIndex) =>
          env.MGMT_DB.prepare(
            `INSERT INTO asset_map_version_chunks(version_id,chunk_index,content) VALUES(?1,?2,?3)`,
          ).bind(id, chunkIndex, content),
        ),
      ]);
      break;
    } catch (error) {
      if (attempt === 2 || !String(error).includes("UNIQUE")) throw error;
      const current = await env.MGMT_DB.prepare(
        `SELECT MAX(version) version FROM asset_map_versions`,
      ).first<{ version: number }>();
      version = Number(current?.version ?? version) + 1;
    }
  }
  return {
    id,
    version,
    schemaVersion: ASSET_MAP_SCHEMA_VERSION,
    contentHash: snapshot.fingerprint,
    reason,
    summary,
    actorType: actor.type,
    actorId: actor.id ?? null,
    createdAt,
    skipped: false,
  };
}

export async function ensurePeriodicAssetMapVersion(env: Env): Promise<void> {
  const latest = await env.MGMT_DB.prepare(
    `SELECT created_at FROM asset_map_versions WHERE reason='scheduled' ORDER BY created_at DESC LIMIT 1`,
  ).first<{ created_at: string }>();
  if (
    latest &&
    Date.now() - Date.parse(latest.created_at) < PERIODIC_INTERVAL_MS
  )
    return;
  await createAssetMapVersion(env, { type: "system", id: "cron" }, "scheduled");
  await env.MGMT_DB.prepare(
    `DELETE FROM asset_map_versions WHERE reason='scheduled' AND created_at<?1`,
  )
    .bind(new Date(Date.now() - SCHEDULED_RETENTION_MS).toISOString())
    .run();
}

export async function listAssetMapVersions(
  env: Env,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const rows = await env.MGMT_DB.prepare(
    `SELECT id,version,schema_version,content_hash,reason,summary,actor_type,actor_id,created_at,
      COALESCE((SELECT SUM(length(content)) FROM asset_map_version_chunks WHERE version_id=asset_map_versions.id),length(snapshot)) snapshot_bytes
      FROM asset_map_versions ORDER BY version DESC LIMIT ?1`,
  )
    .bind(Math.min(200, Math.max(1, limit)))
    .all<Row>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    version: Number(row.version),
    schemaVersion: row.schema_version,
    contentHash: row.content_hash,
    reason: row.reason,
    summary: row.summary,
    actorType: row.actor_type,
    actorId: row.actor_id,
    createdAt: row.created_at,
    snapshotBytes: Number(row.snapshot_bytes ?? 0),
  }));
}

export async function getAssetMapVersion(
  env: Env,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await env.MGMT_DB.prepare(
    `SELECT * FROM asset_map_versions WHERE id=?1 OR CAST(version AS TEXT)=?1`,
  )
    .bind(id)
    .first<Row>();
  const snapshot = row ? await readVersionSnapshot(env, row) : null;
  return row
    ? {
        id: row.id,
        version: Number(row.version),
        schemaVersion: row.schema_version,
        contentHash: row.content_hash,
        reason: row.reason,
        summary: row.summary,
        actorType: row.actor_type,
        actorId: row.actor_id,
        createdAt: row.created_at,
        snapshot,
      }
    : null;
}

export async function upsertAssetMapAnnotation(
  env: Env,
  input: Record<string, unknown>,
  actor: AssetMapActor,
): Promise<AssetMapAnnotation> {
  const entityId = clean(input.entityId, 500);
  if (!entityId) throw new Error("entity_id_required");
  const map = await getAssetMap(env);
  if (!map.nodes.some((node) => node.id === entityId))
    throw new Error("asset_map_node_not_found");
  const existing = await env.MGMT_DB.prepare(
    `SELECT * FROM asset_map_annotations WHERE entity_id=?1`,
  )
    .bind(entityId)
    .first<Row>();
  const id = text(existing?.id) || `mapa_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const label = clean(input.label, 200),
    notes = clean(input.notes, 5000),
    tags = JSON.stringify(strings(input.tags, 30, 60));
  await env.MGMT_DB.prepare(
    `INSERT INTO asset_map_annotations(id,entity_id,label,notes,tags,source,actor_type,actor_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'manual',?6,?7,?8,?9) ON CONFLICT(entity_id) DO UPDATE SET label=excluded.label,notes=excluded.notes,tags=excluded.tags,actor_type=excluded.actor_type,actor_id=excluded.actor_id,revision=asset_map_annotations.revision+1,updated_at=excluded.updated_at`,
  )
    .bind(
      id,
      entityId,
      label,
      notes,
      tags,
      actor.type,
      clean(actor.id, 200),
      text(existing?.created_at) || now,
      now,
    )
    .run();
  const row = await env.MGMT_DB.prepare(
    `SELECT * FROM asset_map_annotations WHERE entity_id=?1`,
  )
    .bind(entityId)
    .first<Row>();
  await createAssetMapVersion(
    env,
    actor,
    "annotation",
    `Updated ${entityId}`,
    true,
  );
  return serializeAnnotation(row!);
}

export async function upsertAssetMapEdge(
  env: Env,
  input: Record<string, unknown>,
  actor: AssetMapActor,
): Promise<AssetMapEdge> {
  const source = clean(input.source, 500),
    target = clean(input.target, 500),
    relationship = clean(input.relationship, 80);
  if (!source || !target || !relationship || source === target)
    throw new Error("invalid_asset_map_edge");
  const map = await getAssetMap(env),
    ids = new Set(map.nodes.map((node) => node.id));
  if (!ids.has(source) || !ids.has(target))
    throw new Error("asset_map_node_not_found");
  const status = ["confirmed", "candidate", "rejected"].includes(
    text(input.status),
  )
    ? text(input.status)
    : "confirmed";
  const confidence = Math.max(0, Math.min(1, number(input.confidence, 1)));
  const evidence = JSON.stringify(strings(input.evidence, 20, 500));
  const notes = clean(input.notes, 5000),
    now = new Date().toISOString();
  const existing = await env.MGMT_DB.prepare(
    `SELECT id,created_at FROM asset_map_manual_edges WHERE source_id=?1 AND target_id=?2 AND relationship=?3`,
  )
    .bind(source, target, relationship)
    .first<Row>();
  const id = text(existing?.id) || `mape_${crypto.randomUUID()}`;
  await env.MGMT_DB.prepare(
    `INSERT INTO asset_map_manual_edges(id,source_id,target_id,relationship,status,confidence,evidence,notes,actor_type,actor_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(source_id,target_id,relationship) DO UPDATE SET status=excluded.status,confidence=excluded.confidence,evidence=excluded.evidence,notes=excluded.notes,actor_type=excluded.actor_type,actor_id=excluded.actor_id,revision=asset_map_manual_edges.revision+1,updated_at=excluded.updated_at`,
  )
    .bind(
      id,
      source,
      target,
      relationship,
      status,
      confidence,
      evidence,
      notes,
      actor.type,
      clean(actor.id, 200),
      text(existing?.created_at) || now,
      now,
    )
    .run();
  const row = await env.MGMT_DB.prepare(
    `SELECT * FROM asset_map_manual_edges WHERE id=?1`,
  )
    .bind(id)
    .first<Row>();
  await createAssetMapVersion(
    env,
    actor,
    "relation",
    `Updated ${source} -> ${target}`,
    true,
  );
  return serializeManualEdge(row!);
}

export async function deleteAssetMapEdge(
  env: Env,
  id: string,
  actor: AssetMapActor,
): Promise<boolean> {
  const result = await env.MGMT_DB.prepare(
    `DELETE FROM asset_map_manual_edges WHERE id=?1`,
  )
    .bind(id)
    .run();
  if (!result.meta?.changes) return false;
  await createAssetMapVersion(
    env,
    actor,
    "relation_deleted",
    `Deleted ${id}`,
    true,
  );
  return true;
}

export async function restoreAssetMapVersion(
  env: Env,
  id: string,
  actor: AssetMapActor,
): Promise<Record<string, unknown> | null> {
  const record = await getAssetMapVersion(env, id);
  if (!record) return null;
  const snapshot = record.snapshot as AssetMapSnapshot | undefined;
  if (!snapshot || snapshot.schemaVersion !== ASSET_MAP_SCHEMA_VERSION)
    throw new Error("incompatible_asset_map_version");
  if (
    snapshot.manualAnnotations.length > 500 ||
    snapshot.manualEdges.length > 500
  )
    throw new Error("asset_map_restore_too_large");
  await createAssetMapVersion(
    env,
    actor,
    "pre_restore",
    `Before restoring version ${record.version}`,
    true,
  );
  const statements: D1PreparedStatement[] = [
    env.MGMT_DB.prepare(`DELETE FROM asset_map_annotations`),
    env.MGMT_DB.prepare(`DELETE FROM asset_map_manual_edges`),
  ];
  for (const item of snapshot.manualAnnotations)
    statements.push(
      env.MGMT_DB.prepare(
        `INSERT INTO asset_map_annotations(id,entity_id,label,notes,tags,source,actor_type,actor_id,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
      ).bind(
        item.id,
        item.entityId,
        item.label,
        item.notes,
        JSON.stringify(item.tags),
        item.source,
        actor.type,
        clean(actor.id, 200),
        item.revision,
        item.createdAt,
        new Date().toISOString(),
      ),
    );
  for (const item of snapshot.manualEdges)
    statements.push(
      env.MGMT_DB.prepare(
        `INSERT INTO asset_map_manual_edges(id,source_id,target_id,relationship,status,confidence,evidence,notes,actor_type,actor_id,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?12)`,
      ).bind(
        item.id,
        item.source,
        item.target,
        item.relationship,
        item.status,
        item.confidence,
        JSON.stringify(item.evidence),
        item.notes ?? null,
        actor.type,
        clean(actor.id, 200),
        item.createdAt || new Date().toISOString(),
        new Date().toISOString(),
      ),
    );
  await env.MGMT_DB.batch(statements);
  return createAssetMapVersion(
    env,
    actor,
    "restore",
    `Restored manual layer from version ${record.version}`,
    true,
  );
}

function serializeAnnotation(row: Row): AssetMapAnnotation {
  return {
    id: text(row.id),
    entityId: text(row.entity_id),
    label: nullableText(row.label),
    notes: nullableText(row.notes),
    tags: jsonStrings(row.tags),
    source: text(row.source) || "manual",
    actorType: text(row.actor_type) || "admin",
    actorId: nullableText(row.actor_id),
    revision: number(row.revision, 1),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
function serializeManualEdge(row: Row): AssetMapEdge {
  return {
    id: text(row.id),
    source: text(row.source_id),
    target: text(row.target_id),
    relationship: text(row.relationship),
    status: text(row.status) || "confirmed",
    confidence: number(row.confidence, 1),
    sourceType: "manual",
    evidence: jsonArray(row.evidence),
    notes: nullableText(row.notes),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}
function repositoryLabel(row: Row): string {
  return row.github_owner && row.github_repo
    ? `${row.github_owner}/${row.github_repo}`
    : text(row.canonical_key);
}
function repositoryKey(value: string): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/i, "");
  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    return path.split("/").length >= 2
      ? `${url.hostname.toLowerCase()}/${path.toLowerCase()}`
      : null;
  } catch {
    return null;
  }
}
function assetKind(kind: string): AssetMapNodeKind {
  if (
    [
      "runtime_service",
      "compose_project",
      "runtime_container",
      "container",
    ].includes(kind)
  )
    return "service";
  if (["dns_domain", "dns_record"].includes(kind)) return "endpoint";
  return "cloud_asset";
}
function kindOrder(kind: AssetMapNodeKind): number {
  return [
    "local_path",
    "repository",
    "project",
    "deployment",
    "server",
    "service",
    "endpoint",
    "cloud_asset",
  ].indexOf(kind);
}
function summarize(
  nodes: AssetMapNode[],
  edges: AssetMapEdge[],
): AssetMapSnapshot["summary"] {
  const base = {
    local_path: 0,
    repository: 0,
    project: 0,
    deployment: 0,
    server: 0,
    endpoint: 0,
    service: 0,
    cloud_asset: 0,
    edges: edges.length,
    confirmedEdges: 0,
    candidateEdges: 0,
  };
  for (const node of nodes) base[node.kind]++;
  for (const edge of edges)
    edge.status === "candidate" ? base.candidateEdges++ : base.confirmedEdges++;
  return base;
}
function fingerprintNode(node: AssetMapNode): unknown {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    status: node.status,
    updatedAt: node.updatedAt,
    metadata: node.metadata,
    annotation: node.annotation,
  };
}
function edgeId(
  source: string,
  target: string,
  relationship: string,
  sourceType: string,
): string {
  return `${sourceType}:${source}|${relationship}|${target}`;
}
function safeMetadata(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value, {});
  return sanitizeObject(parsed, 0);
}
function sanitizeObject(
  value: unknown,
  depth: number,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3)
    return {};
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(secret|token|password|credential|private.?key|api.?key)/i.test(key))
      continue;
    if (entry && typeof entry === "object" && !Array.isArray(entry))
      output[key] = sanitizeObject(entry, depth + 1);
    else if (Array.isArray(entry))
      output[key] = entry
        .slice(0, 50)
        .map((item) =>
          typeof item === "string"
            ? item.slice(0, 1000)
            : typeof item === "number" || typeof item === "boolean"
              ? item
              : null,
        );
    else if (typeof entry === "string") output[key] = entry.slice(0, 5000);
    else if (
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null
    )
      output[key] = entry;
  }
  return output;
}
function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== null && item !== undefined && item !== "",
    ),
  );
}
function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().toLowerCase();
  }
}
function text(value: unknown): string {
  return String(value ?? "").trim();
}
function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}
function clean(value: unknown, max: number): string | null {
  const valueText = text(value);
  return valueText ? valueText.slice(0, max) : null;
}
function number(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function parseJson(value: unknown, fallback: any): any {
  try {
    return JSON.parse(text(value));
  } catch {
    return fallback;
  }
}
function chunkSnapshot(snapshot: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < snapshot.length; ) {
    let end = Math.min(snapshot.length, start + SNAPSHOT_CHUNK_CHARS);
    if (
      end < snapshot.length &&
      snapshot.charCodeAt(end - 1) >= 0xd800 &&
      snapshot.charCodeAt(end - 1) <= 0xdbff
    )
      end--;
    chunks.push(snapshot.slice(start, end));
    start = end;
  }
  return chunks.length ? chunks : [""];
}
async function readVersionSnapshot(env: Env, row: Row): Promise<unknown> {
  const stored = parseJson(row.snapshot, null);
  if (
    !stored ||
    typeof stored !== "object" ||
    stored.format !== SNAPSHOT_CHUNK_FORMAT
  )
    return stored;
  const chunkCount = Number(stored.chunkCount);
  if (!Number.isInteger(chunkCount) || chunkCount < 1)
    throw new Error("asset_map_version_incomplete");
  const result = await env.MGMT_DB.prepare(
    `SELECT chunk_index,content FROM asset_map_version_chunks WHERE version_id=?1 ORDER BY chunk_index`,
  )
    .bind(row.id)
    .all<Row>();
  const chunks = result.results ?? [];
  if (
    chunks.length !== chunkCount ||
    chunks.some((chunk, index) => Number(chunk.chunk_index) !== index)
  )
    throw new Error("asset_map_version_incomplete");
  const content = chunks.map((chunk) => String(chunk.content ?? "")).join("");
  if (content.length !== Number(stored.contentLength))
    throw new Error("asset_map_version_incomplete");
  const snapshot = parseJson(content, null);
  if (!snapshot) throw new Error("asset_map_version_incomplete");
  return snapshot;
}
function jsonArray(value: unknown): unknown[] {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed.slice(0, 100) : [];
}
function jsonStrings(value: unknown): string[] {
  return jsonArray(value).map(String).filter(Boolean);
}
function strings(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map((item) => clean(item, maxLength))
            .filter((item): item is string => Boolean(item)),
        ),
      ].slice(0, maxItems)
    : [];
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}
