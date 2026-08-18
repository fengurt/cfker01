#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { probeDnsAssets, probeUrlAssets } from "./lib/dns-probe.mjs";
import { cliStats, dockerApiStats } from "./lib/docker-runtime-metrics.mjs";

const exec=promisify(execFile),startedAt=new Date().toISOString(),started=Date.now(),args=new Set(process.argv.slice(2));
const root=resolve(import.meta.dirname,".."),output=resolve(process.env.ASSET_DISCOVERY_OUTPUT||`${root}/.cache/assets/latest.json`),accounts=[],errors=[],discoveryConfig=JSON.parse(await readFile(`${root}/config/discovery.json`,"utf8").catch(()=>"{}"));
const assets=[];
const enabledProviders=new Set((process.env.ASSET_DISCOVERY_PROVIDERS||"local,tencent,github,docker,cloudflare,godaddy,ens,solana").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean));
const priorDnsProbes=["tencent","godaddy","cloudflare"].some(provider=>enabledProviders.has(provider))?await loadPriorDnsProbes():new Map();
if(enabledProviders.has("local"))await discoverLocal();
// A rejected provider must make its run partial.  Silently discarding a
// rejection would incorrectly mark the previous authoritative inventory stale.
const discoveryTasks=[
  ["tencent",discoverTencent],
  ["github",discoverGithub],
  ["docker",discoverDocker],
  ["cloudflare",discoverCloudflare],
  ["godaddy",discoverGodaddy],
  ["ens",discoverEns],
  ["solana",discoverSolanaDomains]
].filter(([provider])=>enabledProviders.has(provider));
const settled=await Promise.allSettled(discoveryTasks.map(([,task])=>task()));
for(let index=0;index<settled.length;index+=1)if(settled[index].status==="rejected")errors.push(err(discoveryTasks[index][0],"scanner",settled[index].reason));
if(process.env.DNS_PROBE_ENABLED!=="false"){
  await probeDnsAssets(assets,{batchSize:Number(process.env.DNS_PROBE_BATCH_SIZE||40),concurrency:Number(process.env.DNS_PROBE_CONCURRENCY||6),timeoutMs:Number(process.env.DNS_PROBE_TIMEOUT_MS||4000)});
  await probeUrlAssets(assets,{batchSize:Number(process.env.PAGES_PROBE_BATCH_SIZE||20),concurrency:Number(process.env.PAGES_PROBE_CONCURRENCY||4),timeoutMs:Number(process.env.PAGES_PROBE_TIMEOUT_MS||5000)});
}
const links=buildRepositoryLinks();
const result={version:"asset-discovery-v1",generatedAt:new Date().toISOString(),durationMs:Date.now()-started,startedAt,assets,links,accounts,errors,summary:summarize(assets)};
await mkdir(resolve(output,".."),{recursive:true});await writeFile(output,`${JSON.stringify(result,null,2)}\n`);
let uploadStatus=args.has("--upload")?"completed":"not_requested";
if(args.has("--upload")){const uploaded=await upload(result);uploadStatus=uploaded?.data?.status||"completed";}
// Scanner-loop consumes one JSON record from stdout. Keep this single-line so
// a successful ingestion cannot be misreported as a sidecar process failure.
console.log(JSON.stringify({output,count:assets.length,summary:result.summary,errors,uploadStatus}));

async function discoverTencent(){
  const account=await jsonCommand("tccli",["cam","GetUserAppId","--region","ap-guangzhou"]),accountId=String(account.AppId||account.OwnerUin||"default");accounts.push({provider:"tencent",accountId});
  const regions=(process.env.TENCENT_REGIONS?.split(",")||discoveryConfig.tencentRegions||["ap-guangzhou","ap-nanjing","ap-singapore"]).map(value=>value.trim()).filter(Boolean);
  const instances=[],publicIpToServer=new Map();
  for(const region of regions){
    for(const [service,kind] of [["cvm","cvm"],["lighthouse","lighthouse"]])try{
      const items=await paginatedTencent(service,"DescribeInstances",["--region",region],"InstanceSet",100);
      for(const item of items){
        const serverId=tencentServerId(kind,item.InstanceId),publicIps=item.PublicIpAddresses||item.PublicAddresses||[],privateIps=item.PrivateIpAddresses||item.PrivateAddresses||[];
        instances.push({service,kind,item,region,serverId});
        for(const ip of publicIps)publicIpToServer.set(String(ip),serverId);
        assets.push(a("tencent",accountId,kind,item.InstanceId,item.InstanceName||item.InstanceId,item.InstanceState||"unknown",region,null,{publicIps,privateIps,cpu:item.CPU,memoryMb:Number.isFinite(Number(item.Memory))?Number(item.Memory)*1024:null,diskGb:item.SystemDisk?.DiskSize??null,bundleId:item.BundleId,instanceType:item.InstanceType||item.BundleId||item.PackageType||null,bandwidthMbps:item.InternetAccessible?.InternetMaxBandwidthOut??item.InternetMaxBandwidthOut??item.BandwidthOut??item.Bandwidth??null,expiredAt:item.ExpiredTime,renewFlag:item.RenewFlag},null,serverId));
      }
    }catch(error){errors.push(err("tencent",`${service}:${region}`,error));}
    try{
      const disks=await paginatedTencent("cbs","DescribeDisks",["--region",region],"DiskSet",100);
      for(const disk of disks)assets.push(a("tencent",accountId,"cbs_disk",disk.DiskId,disk.DiskName||disk.DiskId,disk.DiskState||"unknown",region,null,{diskType:disk.DiskType,diskUsage:disk.DiskUsage,diskSizeGb:disk.DiskSize,instanceId:disk.InstanceId||null,renewFlag:disk.RenewFlag,deadline:disk.Deadline},disk.InstanceId||null,disk.InstanceId?tencentServerId("cvm",disk.InstanceId):null));
    }catch(error){errors.push(err("tencent",`cbs:${region}`,error));}
  }
  try{
    const domains=await paginatedTencent("dnspod","DescribeDomainList",[],"DomainList",3000,"DomainCountInfo.DomainTotal");
    for(const domain of domains){
      const domainId=String(domain.DomainId||domain.Name),records=[];
      try{records.push(...await paginatedTencent("dnspod","DescribeRecordList",["--Domain",domain.Name,"--DomainId",String(domain.DomainId)],"RecordList",3000,"RecordCountInfo.TotalCount"));}
      catch(error){errors.push(err("tencent",`dns:${domain.Name}`,error));}
      assets.push(a("tencent",accountId,"dns_domain",domainId,domain.Name,domain.Status||"unknown",null,`https://${domain.Name}`,{recordCount:records.length,userRecordCount:domain.RecordCount,grade:domain.Grade,owner:domain.Owner,ttl:domain.TTL}));
      for(const record of records){
        const host=record.Name==="@"?domain.Name:`${record.Name}.${domain.Name}`,externalId=`${domain.Name}:${record.RecordId}`,probe=priorDnsProbes.get(externalId);
        assets.push(a("tencent",accountId,"dns_record",externalId,host,record.Status||"unknown",null,record.Type==="CNAME"||record.Type==="A"?`https://${host}`:null,{domain:domain.Name,type:record.Type,value:record.Value,line:record.Line,ttl:record.TTL,mx:record.MX,updatedAt:record.UpdatedOn,...(probe?{probe}:{})},domainId,record.Type==="A"?publicIpToServer.get(String(record.Value))||null:null));
      }
    }
    linkDnsAliasesToServers(accountId);
  }catch(error){errors.push(err("tencent","dnspod",error));}
  await discoverTencentTat(accountId,instances);
  try{const zones=await jsonCommand("tccli",["teo","DescribeZones","--region","ap-guangzhou"]);for(const zone of zones.Zones||[])assets.push(a("tencent",accountId,"edgeone_zone",zone.ZoneId,zone.ZoneName||zone.ZoneId,zone.Status||"unknown",null,zone.ZoneName?`https://${zone.ZoneName}`:null,{type:zone.Type,planId:zone.PlanId,createdAt:zone.CreatedOn,modifiedAt:zone.ModifiedOn}));}catch(error){errors.push(err("tencent","edgeone",error));}
  try{const text=await textCommand("coscli",["ls","--disable-log"]);for(const line of text.split("\n")){const match=line.match(/^\s{2}(\S+)\s+\|\s+(\S+)\s+\|\s+([^|]+?)\s*$/);if(match)assets.push(a("tencent",accountId,"cos_bucket",match[1],match[1],"available",match[2],null,{createdAt:match[3].trim()}));}}catch(error){errors.push(err("tencent","cos",error));}
  await discoverTencentBilling(accountId,instances);
}

async function discoverTencentBilling(accountId,instances){
  const month=new Date().toISOString().slice(0,7);
  try{
    const balance=await jsonCommand("tccli",["billing","DescribeAccountBalance","--region","ap-guangzhou"]),response=balance.Response||balance;
    assets.push(a("tencent",accountId,"billing_account",accountId,"Tencent Cloud billing account","available",null,null,{accountId,balanceCNY:Number(response.RealBalance||0)/100,frozenCNY:Number(response.OweAmount||0)/100,month,source:"DescribeAccountBalance"}));
  }catch(error){errors.push(err("tencent","billing:balance",error));}
  try{
    const rows=await paginatedTencent("billing","DescribeBillResourceSummary",["--Month",month,"--NeedRecordNum","1"],"ResourceSummarySet",1000,"Total");
    const instanceById=new Map(instances.map(value=>[String(value.item.InstanceId),value]));
    for(const row of rows){
      const resourceId=String(row.ResourceId||row.ResourceName||crypto.randomUUID()),instance=instanceById.get(resourceId),business=String(row.BusinessCode||"");
      assets.push(a("tencent",accountId,"billing_resource",`${month}:${resourceId}`,String(row.ResourceName||resourceId),"available",row.RegionName||null,null,{month,resourceId,businessCode:business,businessCodeName:row.BusinessCodeName||null,productCodeName:row.ProductCodeName||null,payMode:row.PayModeName||null,totalCost:Number(row.TotalCost),realTotalCost:Number(row.RealTotalCost),feeBeginTime:row.FeeBeginTime||null,feeEndTime:row.FeeEndTime||null,configDesc:row.ConfigDesc||null},resourceId,instance?.serverId||null));
    }
  }catch(error){errors.push(err("tencent","billing:resources",error));}
}

async function discoverTencentTat(accountId,instances){
  for(const region of [...new Set(instances.map(value=>value.region))]){
    const regionInstances=instances.filter(value=>value.region===region),ids=regionInstances.map(value=>value.item.InstanceId),byId=new Map(regionInstances.map(value=>[value.item.InstanceId,value]));
    if(!ids.length)continue;
    let agents=[];
    try{agents=await paginatedTencent("tat","DescribeAutomationAgentStatus",["--region",region,"--InstanceIds",JSON.stringify(ids)],"AutomationAgentSet",100);}
    catch(error){errors.push(err("tencent",`tat:${region}`,error));continue;}
    const agentById=new Map(agents.map(agent=>[agent.InstanceId,agent]));
    for(const value of regionInstances){const agent=agentById.get(value.item.InstanceId);assets.push(a("tencent",accountId,"tat_agent",value.item.InstanceId,`${value.item.InstanceName||value.item.InstanceId} TAT`,agent?.AgentStatus||"not_installed",region,null,{environment:agent?.Environment||null,version:agent?.Version||null,lastHeartbeatAt:agent?.LastHeartbeatTime||null,supportFeatures:agent?.SupportFeatures||[]},value.item.InstanceId,value.serverId));}
    if(process.env.TENCENT_RUNTIME_DISCOVERY_ENABLED!=="true")continue;
    for(const service of ["cvm","lighthouse"]){
      const runnable=regionInstances.filter(value=>value.service===service&&agentById.get(value.item.InstanceId)?.AgentStatus==="Online"&&String(value.item.InstanceState).toUpperCase()==="RUNNING");
      if(!runnable.length)continue;
      try{await discoverTencentRuntimeGroup(accountId,region,runnable);}
      catch(error){errors.push(err("tencent",`runtime:${service}:${region}`,error));}
    }
  }
}

async function discoverTencentRuntimeGroup(accountId,region,instances){
  const script=`#!/bin/sh
printf 'TABLEAI_RUNTIME_V1\\t%s\\n' "$(hostname 2>/dev/null || printf unknown)"
cpu=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || printf 0)
mem_total=$(awk '/MemTotal/{print $2;exit}' /proc/meminfo 2>/dev/null || printf 0)
mem_available=$(awk '/MemAvailable/{print $2;exit}' /proc/meminfo 2>/dev/null || printf 0)
load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || printf 0)
printf 'HOST\\t%s\\t%s\\t%s\\t%s\\n' "$cpu" "$mem_total" "$mem_available" "$load1"
df -P -B1 / 2>/dev/null | tail -1 | awk '{printf "DISK\\t%s\\t%s\\t%s\\n",$2,$3,$4}'
if command -v docker >/dev/null 2>&1; then
  printf 'DOCKER\\t%s\\n' "$(docker version --format '{{.Server.Version}}' 2>/dev/null || printf unavailable)"
  docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  printf 'DOCKER_ROOT\\t%s\\n' "$docker_root"
  if [ -n "$docker_root" ]; then df -P -B1 "$docker_root" 2>/dev/null | tail -1 | awk '{printf "DOCKER_DISK\\t%s\\t%s\\t%s\\n",$2,$3,$4}'; fi
  docker ps -a --no-trunc --format 'CONTAINER\\t{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Label "com.docker.compose.project"}}\\t{{.Label "com.docker.compose.service"}}\\t{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null || true
  docker stats --no-stream --format 'STAT\\t{{.ID}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.NetIO}}\\t{{.BlockIO}}\\t{{.PIDs}}' 2>/dev/null || true
  docker ps -aq | xargs -r docker inspect --size --format 'SIZE\\t{{.Id}}\\t{{.SizeRw}}\\t{{.SizeRootFs}}\\t{{.Created}}\\t{{.State.StartedAt}}' 2>/dev/null || true
fi
if command -v ss >/dev/null 2>&1; then ss -lntH 2>/dev/null | awk '{print "LISTENER\\t"$4}' | head -200; fi
if [ -d /etc/nginx/sites-enabled ]; then grep -RHE '^[[:space:]]*(server_name|proxy_pass)[[:space:]]' /etc/nginx/sites-enabled 2>/dev/null | sed 's/^/NGINX\\t/' | head -400; fi
`;
  const response=await jsonCommand("tccli",["tat","RunCommand","--region",region,"--CommandName","tableai-readonly-inventory","--Description","Read-only TableAI runtime inventory","--Content",Buffer.from(script).toString("base64"),"--CommandType","SHELL","--Timeout",String(Number(process.env.TENCENT_RUNTIME_COMMAND_TIMEOUT||45)),"--SaveCommand","false","--InstanceIds",JSON.stringify(instances.map(value=>value.item.InstanceId))]);
  const invocationId=response.InvocationId;if(!invocationId)throw new Error("TAT RunCommand did not return InvocationId");
  const deadline=Date.now()+Number(process.env.TENCENT_RUNTIME_POLL_TIMEOUT_MS||120000);let tasks=[];
  while(Date.now()<deadline){const body=await jsonCommand("tccli",["tat","DescribeInvocationTasks","--region",region,"--Offset","0","--Limit","100","--HideOutput","false","--Filters",JSON.stringify([{Name:"invocation-id",Values:[invocationId]}])]);tasks=body.InvocationTaskSet||[];if(tasks.length>=instances.length&&tasks.every(task=>tatTerminal(task.TaskStatus)))break;await new Promise(resolvePromise=>setTimeout(resolvePromise,2000));}
  const taskById=new Map(tasks.map(task=>[task.InstanceId,task]));
  for(const value of instances){const task=taskById.get(value.item.InstanceId);if(!task||task.TaskStatus!=="SUCCESS")throw new Error(`${value.item.InstanceId}: ${task?.TaskStatus||"missing_task"}`);const output=Buffer.from(task.TaskResult?.Output||"","base64").toString("utf8");ingestTencentRuntimeOutput(accountId,value,output,invocationId,task.TaskResult||{});}
}

function ingestTencentRuntimeOutput(accountId,value,output,invocationId,result){
  const scannedAt=result.ExecEndTime||new Date().toISOString(),lines=output.split("\n").filter(Boolean),header=lines.find(line=>line.startsWith("TABLEAI_RUNTIME_V1\t"))?.split("\t"),host=lines.find(line=>line.startsWith("HOST\t"))?.split("\t"),disk=lines.find(line=>line.startsWith("DISK\t"))?.split("\t"),docker=lines.find(line=>line.startsWith("DOCKER\t"))?.split("\t"),dockerRoot=lines.find(line=>line.startsWith("DOCKER_ROOT\t"))?.split("\t"),dockerDisk=lines.find(line=>line.startsWith("DOCKER_DISK\t"))?.split("\t"),stats=new Map(lines.filter(line=>line.startsWith("STAT\t")).map(line=>{const [,id,cpu,memory,memoryPercent,network,block,pids]=line.split("\t");return[id,cliStats({cpu,memory,memoryPercent,network,block,pids,sampledAt:scannedAt})];})),sizes=new Map(lines.filter(line=>line.startsWith("SIZE\t")).map(line=>{const [,id,sizeRwBytes,sizeRootFsBytes,createdAt,startedAt]=line.split("\t");return[id,{sizeRwBytes:numericOrNull(sizeRwBytes),sizeRootFsBytes:numericOrNull(sizeRootFsBytes),createdAt:validDockerTime(createdAt),startedAt:validDockerTime(startedAt)}];})),listeners=lines.filter(line=>line.startsWith("LISTENER\t")).map(line=>line.slice(9)),nginxSignals=lines.filter(line=>line.startsWith("NGINX\t")).map(line=>line.slice(6));
  assets.push(a("tencent",accountId,"server_runtime",value.item.InstanceId,value.item.InstanceName||value.item.InstanceId,"online",value.region,null,{hostname:header?.[1]||null,cpuCount:Number(host?.[1]||0),memoryTotalKb:Number(host?.[2]||0),memoryAvailableKb:Number(host?.[3]||0),load1:Number(host?.[4]||0),diskTotalBytes:Number(disk?.[1]||0),diskUsedBytes:Number(disk?.[2]||0),diskAvailableBytes:Number(disk?.[3]||0),dockerVersion:docker?.[1]||null,dockerRootDir:dockerRoot?.[1]||null,dockerDiskTotalBytes:Number(dockerDisk?.[1]||0),dockerDiskUsedBytes:Number(dockerDisk?.[2]||0),dockerDiskAvailableBytes:Number(dockerDisk?.[3]||0),listeners,nginxSignals,invocationId,scannedAt},value.item.InstanceId,value.serverId));
  if(value.serverId===process.env.DOCKER_SERVER_ID)return;
  const services=new Map();
  for(const line of lines.filter(line=>line.startsWith("CONTAINER\t"))){
    const [,id,name,image,state,statusText,ports,composeProject,composeService,workingDir]=line.split("\t"),cleanName=String(name||id).replace(/^\//,""),project=composeProject||cleanName,health=/\(healthy\)/i.test(statusText||"")?"healthy":/\(unhealthy\)/i.test(statusText||"")?"unhealthy":null,containerStats=stats.get(String(id).slice(0,12))||stats.get(id)||null,containerSize=sizes.get(id)||sizes.get(String(id).slice(0,12))||{};
    assets.push(a("tencent",accountId,"runtime_container",`${value.item.InstanceId}:${id}`,cleanName,state||"unknown",value.region,null,{instanceId:value.item.InstanceId,image,statusText,health,ports,composeProject:composeProject||null,composeService:composeService||null,workingDir:workingDir||null,stats:containerStats,...containerSize},value.item.InstanceId,value.serverId));
    const service=services.get(project)||{name:project,containers:[],images:new Set(),ports:new Set(),workingDir:workingDir||null};service.containers.push(cleanName);if(image)service.images.add(image);if(ports)service.ports.add(ports);services.set(project,service);
  }
  for(const service of services.values())assets.push(a("tencent",accountId,"runtime_service",`${value.item.InstanceId}:${service.name}`,service.name,"discovered",value.region,null,{instanceId:value.item.InstanceId,containers:service.containers,containerCount:service.containers.length,images:[...service.images],ports:[...service.ports],workingDir:service.workingDir},value.item.InstanceId,value.serverId));
}

async function paginatedTencent(service,action,baseArgs,listKey,limit=100,totalPath="TotalCount"){
  const values=[];let offset=0;
  for(let page=0;page<1000;page+=1){const body=await jsonCommand("tccli",[service,action,...baseArgs,"--Offset",String(offset),"--Limit",String(limit)]),items=body[listKey]||[],total=numberAtPath(body,totalPath);values.push(...items);if(!items.length||(Number.isFinite(total)&&values.length>=total)||items.length<limit)break;offset+=items.length;}
  return values;
}
function numberAtPath(value,path){const result=String(path).split(".").reduce((current,key)=>current?.[key],value),number=Number(result);return Number.isFinite(number)?number:NaN;}
function tencentServerId(kind,instanceId){return discoveryConfig.tencentServerIds?.[instanceId]||(kind==="cvm"?`tencent-cvm-${instanceId}`:`tencent-lh-${instanceId}`);}
function tatTerminal(status){return["SUCCESS","FAILED","TIMEOUT","TASK_TIMEOUT","DELIVER_FAILED","START_FAILED","CANCELLED","TERMINATED"].includes(String(status));}
function linkDnsAliasesToServers(accountId){const records=assets.filter(value=>value.provider==="tencent"&&value.accountId===accountId&&value.kind==="dns_record"),byHost=new Map(records.map(value=>[String(value.name).toLowerCase().replace(/\.$/,""),value]));for(const record of records){if(record.serverId||record.metadata?.type!=="CNAME")continue;let target=String(record.metadata.value||"").toLowerCase().replace(/\.$/,"");const seen=new Set();for(let depth=0;depth<12&&!seen.has(target);depth+=1){seen.add(target);const next=byHost.get(target);if(!next)break;if(next.serverId){record.serverId=next.serverId;break;}target=String(next.metadata?.value||"").toLowerCase().replace(/\.$/,"");}}}

async function discoverGithub(){try{const text=await textCommand("gh",["api","user/repos","--method","GET","--paginate","--jq",".[]","-f","per_page=100","-f","affiliation=owner,collaborator,organization_member"],30_000_000),repos=text.split("\n").filter(Boolean).map(line=>JSON.parse(line));for(const repo of repos)assets.push(a("github",repo.owner.login,"repository",String(repo.id),repo.full_name,repo.archived?"archived":"active",null,repo.html_url,{private:repo.private,fork:repo.fork,defaultBranch:repo.default_branch,pushedAt:repo.pushed_at,updatedAt:repo.updated_at,language:repo.language,topics:repo.topics||[],cloneUrl:repo.clone_url,sshUrl:repo.ssh_url}));}catch(error){errors.push(err("github","repositories",error));}}

async function discoverLocal(){try{const inventoryPath=process.env.LOCAL_INVENTORY_PATH||`${root}/src/generated/local-projects.json`,auditPath=process.env.REPOSITORY_AUDIT_PATH||`${root}/.cache/repository-audit/latest.json`,inventory=JSON.parse(await readFile(inventoryPath,"utf8"));let audits=[];try{audits=JSON.parse(await readFile(auditPath,"utf8")).repositories||[];}catch{}const auditByPath=new Map(audits.flatMap(item=>(item.localPaths||[]).map(path=>[path,item])));for(const item of inventory.resources||[]){const types=item.resourceTypes||[],kind=types.includes("repository")?"repository":types.includes("skill")?"skill":types.includes("agent")?"agent":"project",absolutePath=item.metadata?.absolutePath||item.sourceRef,audit=auditByPath.get(absolutePath),githubHead=audit?.githubMetadata?.headSha,localHead=audit?.headSha,syncStatus=!item.repositoryUrl?"no_remote":localHead&&githubHead?(localHead===githubHead?"current":Number(audit?.ahead)>0?"local_ahead":Number(audit?.behind)>0?"github_ahead":"diverged"):"unverified";assets.push(a("local","cpro01",kind,item.id,item.name,"available",null,item.repositoryUrl,{sourceRef:item.sourceRef,absolutePath,scanRoot:item.metadata?.scanRoot||null,relativePath:item.metadata?.relativePath||null,resourceTypes:types,languages:item.languages,frameworks:item.frameworks,sourceUpdatedAt:item.sourceUpdatedAt,lastScannedAt:item.lastScannedAt,repositoryUrl:item.repositoryUrl,headSha:localHead||null,githubHeadSha:githubHead||null,branch:audit?.branch||null,dirty:Boolean(audit?.dirty),ahead:audit?.ahead??null,behind:audit?.behind??null,syncStatus,skillPaths:audit?.skillPaths||[]},null,null,item.id));}}catch(error){errors.push(err("local","inventory",error));}}

async function discoverDocker(){try{const host=process.env.DOCKER_DISCOVERY_HOST||discoveryConfig.docker?.host||"opchom",serverId=process.env.DOCKER_SERVER_ID||discoveryConfig.docker?.serverId||null,accountId=serverId||host,useApi=Boolean(process.env.DOCKER_API_URL),[containers,domains]=await Promise.all([useApi?dockerApiContainers():textCommand("ssh",[host,"ids=$(docker ps -aq); if [ -n \"$ids\" ]; then docker inspect --size $ids; else printf '[]'; fi"],40_000_000).then(JSON.parse),useApi?nginxDomainsFromDirectory(process.env.NGINX_CONFIG_DIR||"/etc/nginx/sites-enabled"):nginxDomains(host)]),projects=new Map();for(const item of containers){const labels=item.Config?.Labels||{},project=labels["com.docker.compose.project"]||item.Name.replace(/^\//,""),service=labels["com.docker.compose.service"]||item.Name.replace(/^\//,""),workingDir=labels["com.docker.compose.project.working_dir"]||null,projectKey=`${accountId}:${project}`,ports=formatPorts(item.NetworkSettings?.Ports),hostPorts=ports.map(value=>value.match(/:(\d+)->/)?.[1]).filter(Boolean),urls=[...new Set(hostPorts.flatMap(port=>domains.get(port)||[]))],status=item.State?.Health?.Status||item.State?.Status||"unknown",listMetadata=item.__tableaiList||{},containerStats=dockerApiStats(item.__tableaiStats);if(!projects.has(projectKey))projects.set(projectKey,{project,workingDir,containers:[],urls:[]});projects.get(projectKey).containers.push(item.Name.replace(/^\//,""));projects.get(projectKey).urls.push(...urls);assets.push(a("docker",accountId,"container",item.Id,item.Name.replace(/^\//,""),status,null,urls[0]||null,{composeProject:project,composeService:service,image:item.Config?.Image,workingDir,ports,urls,state:item.State?.Status,health:item.State?.Health?.Status||null,stats:containerStats,sizeRwBytes:numericOrNull(listMetadata.SizeRw??item.SizeRw),sizeRootFsBytes:numericOrNull(listMetadata.SizeRootFs??item.SizeRootFs),createdAt:validDockerTime(item.Created??listMetadata.Created),startedAt:validDockerTime(item.State?.StartedAt)},projectKey,serverId));}
    for(const [key,value] of projects){const exact=exactLocalProject(value.project,value.workingDir),projectId=exact?.id||null,urls=[...new Set(value.urls)];assets.push(a("docker",accountId,"compose_project",key,value.project,"running",null,urls[0]||null,{workingDir:value.workingDir,containers:value.containers,containerCount:value.containers.length,urls,matchReason:exact?.reason||null},null,serverId,projectId));}
  }catch(error){errors.push(err("docker","runtime",error));}}

async function discoverCloudflare(){const token=process.env.CLOUDFLARE_API_TOKEN,accountId=process.env.CLOUDFLARE_ACCOUNT_ID||"unconfigured";if(!token){assets.push(a("cloudflare",accountId,"credential_status","cloudflare-api","Cloudflare API","unconfigured",null,null,{message:"CLOUDFLARE_API_TOKEN is not configured"}));errors.push({provider:"cloudflare",scope:"authentication",code:"not_configured",message:"CLOUDFLARE_API_TOKEN is not configured"});return;}accounts.push({provider:"cloudflare",accountId});assets.push(a("cloudflare",accountId,"credential_status","cloudflare-api","Cloudflare API","configured",null,null,{message:"Cloudflare API token configured"}));const headers={Authorization:`Bearer ${token}`};for(const [kind,path] of [["worker",`/accounts/${accountId}/workers/scripts`],["pages_project",`/accounts/${accountId}/pages/projects`],["d1_database",`/accounts/${accountId}/d1/database`],["kv_namespace",`/accounts/${accountId}/storage/kv/namespaces`],["r2_bucket",`/accounts/${accountId}/r2/buckets`]])try{const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{headers}),body=await response.json();if(!response.ok||!body.success)throw new Error(body.errors?.[0]?.message||`HTTP ${response.status}`);const values=Array.isArray(body.result)?body.result:body.result?.buckets||[];for(const item of values){const id=String(item.id||item.uuid||item.name||item.title);assets.push(a("cloudflare",accountId,kind,id,String(item.name||item.title||item.id),"active",item.location||item.jurisdiction||null,item.subdomain?`https://${item.subdomain}`:null,item));}}catch(error){errors.push(err("cloudflare",kind,error));}}

async function discoverGodaddy(){
  const token=process.env.GODADDY_API_TOKEN,accountId=process.env.GODADDY_ACCOUNT_ID||"default";
  if(!token){assets.push(a("godaddy",accountId,"credential_status","godaddy-api","GoDaddy API","unconfigured",null,null,{message:"GODADDY_API_TOKEN is not configured"}));errors.push({provider:"godaddy",scope:"authentication",code:"not_configured",message:"GODADDY_API_TOKEN is not configured"});return;}
  accounts.push({provider:"godaddy",accountId});
  assets.push(a("godaddy",accountId,"credential_status","godaddy-api","GoDaddy API","configured",null,null,{message:"GoDaddy API token configured"}));
  const headers={Authorization:`Bearer ${token}`,Accept:"application/json"},domains=[];
  try{for(let offset=0;;offset+=100){const response=await fetch(`https://api.godaddy.com/v1/domains?limit=100&offset=${offset}`,{headers}),body=await response.json();if(!response.ok)throw new Error(body?.message||`HTTP ${response.status}`);const values=Array.isArray(body)?body:[];domains.push(...values);if(values.length<100)break;}}catch(error){errors.push(err("godaddy","domains",error));return;}
  for(const domain of domains){
    const name=String(domain.domain||domain.name);const domainId=String(domain.domainId||name);
    let records=[];
    try{const response=await fetch(`https://api.godaddy.com/v1/domains/${encodeURIComponent(name)}/records`,{headers}),body=await response.json();if(!response.ok)throw new Error(body?.message||`HTTP ${response.status}`);records=Array.isArray(body)?body:[];}catch(error){errors.push(err("godaddy",`dns:${name}`,error));}
    assets.push(a("godaddy",accountId,"dns_domain",domainId,name,domain.status||"active",null,`https://${name}`,{recordCount:records.length,expiresAt:domain.expires,renewAuto:domain.renewAuto,locked:domain.locked,nameservers:domain.nameServers||[]}));
    for(const record of records){const host=record.name==="@"?name:`${record.name}.${name}`,externalId=`${name}:${record.type}:${record.name}:${record.data}`;const probe=priorDnsProbes.get(externalId);assets.push(a("godaddy",accountId,"dns_record",externalId,host,"active",null,["A","CNAME"].includes(record.type)?`https://${host}`:null,{domain:name,type:record.type,value:record.data,ttl:record.ttl,priority:record.priority,...(probe?{probe}:{})},domainId));}
  }
}

function configuredNames(envName,configName,suffix){
  const raw=process.env[envName];
  const values=raw?raw.split(","):Array.isArray(discoveryConfig[configName])?discoveryConfig[configName]:[];
  return [...new Set(values.map(value=>String(value).trim().toLowerCase()).filter(value=>value.endsWith(suffix)))];
}
function hex(value){return Buffer.from(value).toString("hex");}
function isoFromUnix(value){const seconds=Number(value);return Number.isFinite(seconds)&&seconds>0?new Date(seconds*1000).toISOString():null;}
async function discoverEns(){
  const names=configuredNames("ENS_NAMES","ensNames",".eth"),rpcUrl=process.env.ENS_RPC_URL;
  if(!names.length){assets.push(a("ens","ethereum-mainnet","credential_status","ens-names","ENS / Ethereum","unconfigured",null,"https://app.ens.domains/",{message:"ENS_NAMES is not configured; add explicit .eth names, not a wallet private key."}));errors.push({provider:"ens",scope:"configuration",code:"not_configured",message:"ENS_NAMES is not configured"});return;}
  if(!rpcUrl){assets.push(a("ens","ethereum-mainnet","credential_status","ens-rpc","ENS RPC","unconfigured",null,null,{message:"ENS_RPC_URL is not configured"}));errors.push({provider:"ens",scope:"configuration",code:"not_configured",message:"ENS_RPC_URL is not configured"});return;}
  accounts.push({provider:"ens",accountId:"ethereum-mainnet"});
  assets.push(a("ens","ethereum-mainnet","credential_status","ens-rpc","ENS RPC","configured",null,null,{message:"Read-only Ethereum RPC configured"}));
  const selector=hex(keccak_256(new TextEncoder().encode("nameExpires(uint256)"))).slice(0,8);
  for(const name of names){
    const label=name.slice(0,-4);
    if(!/^[a-z0-9-]{3,}$/i.test(label)){errors.push({provider:"ens",scope:`name:${name}`,code:"unsupported_name",message:"Only direct ASCII .eth labels are supported by the deterministic registrar scanner"});assets.push(a("ens","ethereum-mainnet","chain_domain",name,name,"unverified",null,`https://app.ens.domains/${name}`,{chain:"ethereum",registry:"ENS Base Registrar",expirationSource:"unsupported name format",verificationUrl:`https://app.ens.domains/${name}`}));continue;}
    try{
      const labelHash=hex(keccak_256(new TextEncoder().encode(label))),response=await fetch(rpcUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:name,method:"eth_call",params:[{to:"0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85",data:`0x${selector}${labelHash}`},"latest"]})}),body=await response.json();
      if(!response.ok||body.error||typeof body.result!=="string")throw new Error(body?.error?.message||`HTTP ${response.status}`);
      const expiresAt=isoFromUnix(BigInt(body.result));
      assets.push(a("ens","ethereum-mainnet","chain_domain",name,name,expiresAt&&Date.parse(expiresAt)<Date.now()?"expired":"active",null,`https://app.ens.domains/${name}`,{chain:"ethereum",registry:"ENS Base Registrar",contract:"0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85",expiresAt,expirationSource:"ENS BaseRegistrar.nameExpires",gracePeriodDays:90,verifiedAt:new Date().toISOString(),verificationUrl:`https://app.ens.domains/${name}`}));
    }catch(error){errors.push(err("ens",`name:${name}`,error));assets.push(a("ens","ethereum-mainnet","chain_domain",name,name,"unverified",null,`https://app.ens.domains/${name}`,{chain:"ethereum",registry:"ENS Base Registrar",expirationSource:"RPC lookup failed",verificationUrl:`https://app.ens.domains/${name}`}));}
  }
}
async function discoverSolanaDomains(){
  const names=configuredNames("SOL_NAMES","solNames",".sol");
  if(!names.length){assets.push(a("solana","sns","credential_status","sol-names","Solana Name Service","unconfigured",null,"https://sns.id/",{message:"SOL_NAMES is not configured; add explicit .sol names to track."}));errors.push({provider:"solana",scope:"configuration",code:"not_configured",message:"SOL_NAMES is not configured"});return;}
  accounts.push({provider:"solana",accountId:"sns"});
  for(const name of names)assets.push(a("solana","sns","chain_domain",name,name,"perpetual",null,`https://sns.id/#/${name.slice(0,-4)}`,{chain:"solana",registry:"Solana Name Service",expirationModel:"one-time registration / no renewal expiry",expirationSource:"SNS documentation",verificationUrl:`https://sns.id/#/${name.slice(0,-4)}`,verifiedAt:new Date().toISOString()}));
}

function exactLocalProject(project,workingDir){const candidates=assets.filter(x=>x.provider==="local"&&x.projectId&&x.kind==="repository"),normalized=norm(project),matches=candidates.filter(x=>norm(x.name)===normalized||norm(x.metadata?.sourceRef?.split("/").pop())===normalized);if(matches.length===1)return{id:matches[0].projectId,reason:"exact_name"};if(workingDir){const base=norm(workingDir.split("/").filter(Boolean).pop());const byDir=candidates.filter(x=>norm(x.metadata?.sourceRef?.split("/").pop())===base);if(byDir.length===1)return{id:byDir[0].projectId,reason:"exact_working_directory"};}return null;}
function a(provider,accountId,kind,externalId,name,status,region,url,metadata={},parentExternalId=null,serverId=null,projectId=null){return{id:stableId(provider,accountId,kind,String(externalId)),provider,accountId,kind,externalId:String(externalId),parentExternalId,name:String(name),status:String(status||"unknown").toLowerCase(),region,url,serverId,projectId,metadata};}
function stableId(...parts){let hash=2166136261;for(const char of parts.join("\0")){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return`asset-${(hash>>>0).toString(16).padStart(8,"0")}`;}
function numericOrNull(value){if(value===null||value===undefined||value==="")return null;const number=Number(value);return Number.isFinite(number)&&number>=0?number:null;}
function validDockerTime(value){if(value===null||value===undefined||value==="")return null;const date=typeof value==="number"?new Date(value*1000):new Date(String(value));return Number.isFinite(date.getTime())&&date.getUTCFullYear()>2000?date.toISOString():null;}
function formatPorts(ports){return Object.entries(ports||{}).flatMap(([container,bindings])=>(bindings||[]).map(binding=>`${binding.HostIp||""}:${binding.HostPort}->${container}`));}function norm(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"");}function summarize(values){const result={};for(const value of values){const key=`${value.provider}:${value.kind}`;result[key]=(result[key]||0)+1;}return result;}function err(provider,scope,error){return{provider,scope,code:"discovery_failed",message:String(error?.stderr||error?.message||error).trim().split("\n").at(-1).slice(0,500)};}
function buildRepositoryLinks(){const github=new Map(assets.filter(x=>x.provider==="github"&&x.kind==="repository").map(x=>[canonical(x.url),x])),result=[];for(const local of assets.filter(x=>x.provider==="local"&&x.kind==="repository")){const remote=canonical(local.metadata?.repositoryUrl),target=github.get(remote);if(!target)continue;result.push({sourceAssetId:local.id,targetAssetId:target.id,projectId:local.projectId,relationship:"repository_mirror",confidence:1,status:"confirmed",evidence:["normalized_remote"]});}return result;}function canonical(value){try{const url=new URL(String(value).replace(/^git@github\.com:/,"https://github.com/"));return`${url.hostname.toLowerCase()}${url.pathname.replace(/\.git$/i,"").toLowerCase()}`;}catch{return"";}}
async function nginxDomains(host){const map=new Map();try{const text=await textCommand("ssh",[host,"grep -RHE 'server_name|proxy_pass http://127.0.0.1:' /etc/nginx/sites-enabled 2>/dev/null"]),files=new Map();for(const line of text.split("\n")){const split=line.indexOf(":");if(split<0)continue;const file=line.slice(0,split),body=line.slice(split+1),entry=files.get(file)||{domains:[],ports:[]};const names=body.match(/server_name\s+([^;]+)/)?.[1]?.split(/\s+/).filter(name=>name!=="_")||[],port=body.match(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/)?.[1];entry.domains.push(...names);if(port)entry.ports.push(port);files.set(file,entry);}for(const entry of files.values())for(const port of entry.ports){const urls=[...new Set(entry.domains)].map(domain=>`https://${domain}`);map.set(port,[...(map.get(port)||[]),...urls]);}}catch{}return map;}
async function nginxDomainsFromDirectory(directory){const map=new Map();try{const files=await readdir(directory);for(const file of files){const body=await readFile(resolve(directory,file),"utf8").catch(()=>"");const domains=[...body.matchAll(/server_name\s+([^;]+)/g)].flatMap(match=>match[1].split(/\s+/)).filter(name=>name&&name!=="_");for(const match of body.matchAll(/proxy_pass\s+http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/g)){const urls=[...new Set(domains)].map(domain=>`https://${domain}`);map.set(match[1],[...(map.get(match[1])||[]),...urls]);}}}catch{}return map;}
async function dockerApiContainers(){const base=new URL(process.env.DOCKER_API_URL),list=await httpJson(base,"/containers/json?all=1&size=1");return Promise.all(list.map(async item=>{const inspect=await httpJson(base,`/containers/${encodeURIComponent(item.Id)}/json`),stats=String(item.State)==="running"?await httpJson(base,`/containers/${encodeURIComponent(item.Id)}/stats?stream=false&one-shot=true`).catch(()=>null):null;return{...inspect,__tableaiList:item,__tableaiStats:stats};}));}
function httpJson(base,path){return new Promise((resolvePromise,reject)=>{const request=http.get({hostname:base.hostname,port:base.port||80,path,timeout:30_000},response=>{let body="";response.setEncoding("utf8");response.on("data",chunk=>body+=chunk);response.on("end",()=>{if((response.statusCode||500)>=400)return reject(new Error(`Docker API ${response.statusCode}`));try{resolvePromise(JSON.parse(body));}catch(error){reject(error);}});});request.on("timeout",()=>request.destroy(new Error("Docker API timeout")));request.on("error",reject);});}
async function jsonCommand(command,argv){return JSON.parse(await textCommand(command,argv));}async function textCommand(command,argv,maxBuffer=10_000_000){return(await exec(command,argv,{maxBuffer,env:process.env})).stdout.trim();}
async function loadPriorDnsProbes(){const token=process.env.ADMIN_TOKEN;if(!token)return new Map();const base=process.env.WORKER_URL||"http://127.0.0.1:8787",result=new Map();try{for(let page=1;;page++){const response=await fetch(`${base}/admin/assets?kind=dns_record&per_page=100&page=${page}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)break;const body=await response.json();for(const asset of body.data||[])if(asset.metadata?.probe?.version===1)result.set(asset.external_id,asset.metadata.probe);if(page>=Number(body.meta?.pages||1))break;}}catch{}return result;}
async function upload(data){if(process.env.SCANNER_KEY&&process.env.SCAN_JOB_ID)return uploadV1(data);await uploadLegacy(data);return{data:{status:data.errors.length?"partial":"completed"}};}
async function uploadV1(data){const base=process.env.WORKER_URL||"http://127.0.0.1:8787",token=process.env.SCANNER_KEY,headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"},fingerprint=createHash("sha256").update(JSON.stringify(data.assets.map(({provider,accountId,kind,externalId,status,metadata})=>({provider,accountId,kind,externalId,status,metadata})))).digest("hex");let runId;try{const started=await api(`${base}/api/ingest/v1/runs`,{method:"POST",headers,body:JSON.stringify({jobId:process.env.SCAN_JOB_ID,schemaVersion:data.version,fingerprint})});runId=started.data.id;for(let index=0;index*200<data.assets.length;index+=1)await api(`${base}/api/ingest/v1/runs/${runId}/batches/${index}`,{method:"PUT",headers,body:JSON.stringify({assets:data.assets.slice(index*200,(index+1)*200)})});const errors=data.errors.filter(error=>!process.env.SCANNER_CONNECTOR_PROVIDER||error.provider===process.env.SCANNER_CONNECTOR_PROVIDER);return api(`${base}/api/ingest/v1/runs/${runId}/complete`,{method:"POST",headers,body:JSON.stringify({authoritative:errors.length===0,errors,links:data.links,durationMs:data.durationMs})});}catch(error){if(runId)await fetch(`${base}/api/ingest/v1/runs/${runId}/fail`,{method:"POST",headers,body:JSON.stringify({code:"scanner_upload_failed",message:String(error?.message||error).slice(0,1000)})}).catch(()=>{});throw error;}}
async function uploadLegacy(data){const base=process.env.WORKER_URL||"http://127.0.0.1:8787",token=process.env.ADMIN_TOKEN;if(!token)throw new Error("SCANNER_KEY with SCAN_JOB_ID, or legacy ADMIN_TOKEN, is required for --upload");const grouped=new Map();for(const asset of data.assets){const key=`${asset.provider}\0${asset.accountId}`,group=grouped.get(key)||{provider:asset.provider,accountId:asset.accountId,assets:[]};group.assets.push(asset);grouped.set(key,group);}for(const group of grouped.values())for(let i=0;i<group.assets.length;i+=100){const complete=i+100>=group.assets.length,providerErrors=data.errors.filter(error=>error.provider===group.provider),response=await fetch(`${base}/admin/assets/import`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({...group,assets:group.assets.slice(i,i+100),scanAt:data.generatedAt,complete,staleAfterMs:group.provider==="docker"?3_600_000:172_800_000,run:complete?{startedAt:data.startedAt,durationMs:data.durationMs,discoveredCount:group.assets.length,errors:providerErrors}:undefined})});if(!response.ok)throw new Error(`${group.provider}/${group.accountId}: ${response.status} ${await response.text()}`);}if(data.links?.length){const response=await fetch(`${base}/admin/assets/import`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({provider:"links",accountId:"default",assets:[],links:data.links})});if(!response.ok)throw new Error(`links: ${response.status} ${await response.text()}`);}}
async function api(url,options){const response=await fetch(url,options),text=await response.text();if(!response.ok)throw new Error(`${response.status} ${text.slice(0,1000)}`);return text?JSON.parse(text):{};}
