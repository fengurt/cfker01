import { requireAdminToken } from "../lib/auth";

export async function handleAdminServers(request:Request,env:Env,ctx:ExecutionContext){
  const auth=await requireAdminToken(request,env);if(auth)return auth;
  const url=new URL(request.url),parts=url.pathname.split("/").filter(Boolean),id=parts[2];
  if(request.method==="GET"&&id&&parts[3]==="runtime"){
    const rows=await env.MGMT_DB.prepare(`SELECT * FROM discovered_assets WHERE server_id=?1 AND provider IN ('docker','tencent') AND kind IN ('container','compose_project','server_runtime','runtime_container','runtime_service','tat_agent') AND status!='stale' ORDER BY kind,name`).bind(id).all<Record<string,unknown>>();
    return Response.json({data:(rows.results??[]).map(value=>({...value,metadata:parseMetadata(value.metadata),isStale:Boolean(value.stale_after&&String(value.stale_after)<new Date().toISOString())}))});
  }
  if(request.method==="GET"){
    if(url.searchParams.get("compact")==="1"){
      const rows=await env.MGMT_DB.prepare(`SELECT id,name,provider,architecture,cpu,memory_mb,disk_gb,due_at,status,manual_status,cloud_status,cloud_checked_at,health_status,last_checked_at FROM servers ORDER BY name`).all<Record<string,unknown>>();
      return Response.json({data:(rows.results??[]).map(server=>({...server,effective_status:effectiveStatus(server),is_stale:isStale(server)}))});
    }
    const [servers,deployments,runtimeAssets,dnsAssets,repositoryAssets]=await Promise.all([
      env.MGMT_DB.prepare(`SELECT s.*,(SELECT COUNT(*) FROM deployments d WHERE d.server_id=s.id) deployment_count FROM servers s ORDER BY deployment_count ASC,s.name`).all<Record<string,unknown>>(),
      env.MGMT_DB.prepare(`SELECT d.id,d.server_id,d.project_id,d.environment,d.deployed_url,d.version,d.status,d.deployed_at,d.last_checked_at,d.last_latency_ms,d.last_error,p.name project_name,p.repository_url,p.source_ref,p.resource_types,
        (SELECT repository_url FROM backup_repositories b WHERE b.project_id=p.id ORDER BY b.updated_at DESC LIMIT 1) backup_repository_url,
        (SELECT status FROM backup_repositories b WHERE b.project_id=p.id ORDER BY b.updated_at DESC LIMIT 1) backup_status,
        (SELECT last_verified_at FROM backup_repositories b WHERE b.project_id=p.id ORDER BY b.updated_at DESC LIMIT 1) backup_last_verified_at,
        (SELECT last_backup_at FROM backup_repositories b WHERE b.project_id=p.id ORDER BY b.updated_at DESC LIMIT 1) backup_last_backup_at,
        (SELECT pushed_at FROM repository_snapshots r WHERE r.project_id=p.id ORDER BY r.updated_at DESC LIMIT 1) github_pushed_at,
        (SELECT head_sha FROM repository_snapshots r WHERE r.project_id=p.id ORDER BY r.updated_at DESC LIMIT 1) github_head_sha,
        (SELECT github_metadata FROM repository_snapshots r WHERE r.project_id=p.id ORDER BY r.updated_at DESC LIMIT 1) github_metadata,
        (SELECT branch FROM repository_snapshots r WHERE r.project_id=p.id ORDER BY r.updated_at DESC LIMIT 1) repository_branch,
        (SELECT ahead FROM repository_snapshots r WHERE r.project_id=p.id ORDER BY r.updated_at DESC LIMIT 1) repository_ahead,
        (SELECT behind FROM repository_snapshots r WHERE r.project_id=p.id ORDER BY r.updated_at DESC LIMIT 1) repository_behind
        FROM deployments d JOIN catalog_projects p ON p.id=d.project_id ORDER BY COALESCE(d.deployed_at,d.updated_at) DESC`).all<Record<string,unknown>>(),
      env.MGMT_DB.prepare(`SELECT * FROM discovered_assets WHERE provider IN ('docker','tencent') AND kind IN ('container','compose_project','server_runtime','runtime_container','runtime_service','tat_agent') AND status!='stale' AND server_id IS NOT NULL ORDER BY server_id,kind,name`).all<Record<string,unknown>>(),
      env.MGMT_DB.prepare(`SELECT * FROM discovered_assets WHERE provider='tencent' AND kind='dns_record' AND status!='stale' AND server_id IS NOT NULL ORDER BY server_id,name`).all<Record<string,unknown>>(),
      env.MGMT_DB.prepare(`SELECT id,name,url,metadata,last_seen_at FROM discovered_assets WHERE provider='github' AND kind='repository' AND status!='stale' ORDER BY last_seen_at DESC`).all<Record<string,unknown>>()
    ]);
    const byServer=new Map<string,Record<string,unknown>[]>();for(const deployment of deployments.results??[]){const key=String(deployment.server_id),values=byServer.get(key)??[];values.push(deployment);byServer.set(key,values);}
    const runtimeByServer=groupAssets(runtimeAssets.results??[]),dnsByServer=groupAssets(dnsAssets.results??[]),repositories=repositoryIndex(repositoryAssets.results??[]);
    return Response.json({data:(servers.results??[]).map(server=>{const runtime=(runtimeByServer.get(String(server.id))??[]).map(value=>attachRepository(value,repositories)),dns=dnsByServer.get(String(server.id))??[];return{...server,effective_status:effectiveStatus(server),is_stale:isStale(server),runtime_coverage:runtimeCoverage(runtime),runtime_assets:runtime,dns_records:dns,deployments:(byServer.get(String(server.id))??[]).map(deployment=>({...deployment,effective_health_status:deploymentHealth(deployment)}))};})});
  }
  if(request.method!=="PUT"&&request.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});
  let body:Record<string,any>;try{body=await request.json();}catch{return Response.json({error:"invalid_json"},{status:400});}
  if(!body.name||!body.provider)return Response.json({error:"name_and_provider_required"},{status:400});
  for(const value of [body.healthUrl,body.publicUrl])if(value){try{new URL(value);}catch{return Response.json({error:"invalid_url"},{status:400});}}
  const now=new Date().toISOString(),serverId=id??body.id??crypto.randomUUID();
  await env.MGMT_DB.prepare(`INSERT INTO servers(id,name,provider,ip_address,architecture,cpu,memory_mb,disk_gb,operating_system,due_at,health_url,public_url,status,manual_status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15) ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,ip_address=excluded.ip_address,architecture=excluded.architecture,cpu=excluded.cpu,memory_mb=excluded.memory_mb,disk_gb=excluded.disk_gb,operating_system=excluded.operating_system,due_at=excluded.due_at,health_url=excluded.health_url,public_url=excluded.public_url,status=excluded.status,manual_status=excluded.manual_status,updated_at=excluded.updated_at`).bind(serverId,body.name,body.provider,body.ipAddress??null,body.architecture??null,body.cpu??null,body.memoryMb??null,body.diskGb??null,body.operatingSystem??null,body.dueAt??null,body.healthUrl??null,body.publicUrl??null,body.status??"unknown",body.manualStatus??null,now).run();
  ctx.waitUntil(env.MGMT_DB.prepare(`INSERT INTO audit_events(event_type,payload,created_at) VALUES('server.updated',?1,?2)`).bind(JSON.stringify({serverId}),now).run());return Response.json({ok:true,id:serverId});
}
function parseMetadata(value:unknown){try{return JSON.parse(String(value));}catch{return{};}}
function groupAssets(rows:Record<string,unknown>[]){const result=new Map<string,Record<string,unknown>[]>();for(const row of rows){const key=String(row.server_id),values=result.get(key)??[];values.push({...row,metadata:parseMetadata(row.metadata)});result.set(key,values);}return result;}
function repositoryIndex(rows:Record<string,unknown>[]){const result=new Map<string,Record<string,unknown>[]>() ;for(const row of rows){const key=normalizeRepositoryName(String(row.name).split("/").at(-1)||"");if(!key)continue;const values=result.get(key)??[];values.push({...row,metadata:parseMetadata(row.metadata)});result.set(key,values);}return result;}
function attachRepository(asset:Record<string,unknown>,repositories:Map<string,Record<string,unknown>[]>){if(!["compose_project","runtime_service"].includes(String(asset.kind)))return asset;const metadata=asset.metadata as Record<string,unknown>,candidates=[String(asset.name),String(metadata?.composeProject??""),String(metadata?.workingDir??"").split("/").filter(Boolean).at(-1)||""].map(normalizeRepositoryName).filter(Boolean);for(const candidate of candidates){const matches=repositories.get(candidate);if(matches?.length===1)return{...asset,repository:matches[0]};}return asset;}
function normalizeRepositoryName(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,"");}
function runtimeCoverage(rows:Record<string,unknown>[]){const direct=rows.some(row=>row.provider==="docker"),runtime=rows.find(row=>row.kind==="server_runtime"),agent=rows.find(row=>row.kind==="tat_agent"),services=rows.filter(row=>["compose_project","runtime_service"].includes(String(row.kind))),containers=rows.filter(row=>["container","runtime_container"].includes(String(row.kind)));return{status:direct||runtime?"scanned":agent?.status==="online"?"agent_online":"not_scanned",source:direct?"docker_api":runtime?"tencent_tat":agent?"tencent_tat_agent":"none",last_scanned_at:runtime?.last_seen_at??rows.find(row=>row.provider==="docker")?.last_seen_at??agent?.last_seen_at??null,service_count:services.length,container_count:containers.length};}
function effectiveStatus(server:Record<string,unknown>){const manual=String(server.manual_status??"");if(["maintenance","disabled"].includes(manual))return manual;if(server.due_at&&Date.parse(String(server.due_at))<Date.now())return"expired";if(isStale(server))return"stale";const health=String(server.health_status??"");if(health)return health;const cloud=String(server.cloud_status??"").toLowerCase();if(["stopped","shutdown","isolated","offline"].includes(cloud))return"offline";return"unverified";}
function deploymentHealth(deployment:Record<string,unknown>){if(deployment.last_checked_at&&Date.parse(String(deployment.last_checked_at))<Date.now()-15*60_000)return"stale";return String(deployment.health_status??"unverified");}
function isStale(server:Record<string,unknown>){const checked=server.last_checked_at??server.cloud_checked_at;return Boolean(checked&&Date.parse(String(checked))<Date.now()-15*60_000);}
