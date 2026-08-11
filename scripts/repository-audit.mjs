#!/usr/bin/env node
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative, basename, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec=promisify(execFile),args=new Set(process.argv.slice(2));
const root=resolve(process.env.REPOSITORY_SCAN_ROOT||"/Users/af/cpro01");
const cacheDir=resolve(process.env.REPOSITORY_AUDIT_CACHE||".cache/repository-audit");
const upload=args.has("--upload"),full=args.has("--mode")&&process.argv[process.argv.indexOf("--mode")+1]==="full";
const ignored=new Set(["node_modules",".next",".astro",".wrangler","dist","build","coverage",".venv","venv","vendor","target","__pycache__",".cache"]);
const sensitive=/^(?:\.env(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i;
const manifests=["package.json","pyproject.toml","Cargo.toml","go.mod","wrangler.jsonc","docker-compose.yml","compose.yml","Dockerfile"];
await mkdir(cacheDir,{recursive:true});
const previous=await readJson(join(cacheDir,"latest.json"),{repositories:[]});
if(args.has("--upload-only")){
  await uploadAll(previous.repositories);
  console.log(JSON.stringify({uploaded:previous.repositories.length,source:join(cacheDir,"latest.json")},null,2));
  process.exit(0);
}
const previousByKey=new Map(previous.repositories.map(item=>[item.canonicalKey,item]));
const gitDirs=[];await walk(root,gitDirs);
const local=[];for(const directory of gitDirs)local.push(await inspect(directory));
const merged=new Map();for(const item of local){const existing=merged.get(item.canonicalKey);if(existing){existing.localPaths.push(...item.localPaths);existing.dirty=existing.dirty||item.dirty;continue;}merged.set(item.canonicalKey,item);}
for(const item of await discoverAccessibleGithub()){if(!merged.has(item.canonicalKey))merged.set(item.canonicalKey,item);}
const github=await githubMetadata([...merged.values()]);
let changed=0,cacheHits=0;const repositories=[];
for(const item of merged.values()){
  Object.assign(item,github.get(item.canonicalKey)||{});
  item.fingerprint=hash([item.headSha,item.manifestHash,item.lockfileHash,item.readmeHash,item.defaultBranch,item.pushedAt,item.ciStatus,item.deploymentFingerprint].join("\0"));
  const old=previousByKey.get(item.canonicalKey),cacheHit=!full&&old?.fingerprint===item.fingerprint;
  item.cacheHit=cacheHit;if(cacheHit){cacheHits++;item.dossier=old.dossier;}else{changed++;item.dossier=buildDossier(item,old);}
  item.syncStatus=deriveSyncStatus(item);
  item.summary=item.description||`${item.name} repository`;item.suggestedDescription=item.description||null;item.confidence=item.description?0.9:0.55;
  item.suggestedTypes=["repository",...(item.frameworks.includes("Agent Skill")?["skill"]:[])];item.suggestedTags=[...new Set([...item.languages,...item.frameworks])].slice(0,12).map(slug);
  item.maturity=item.archived?"archived":item.ciStatus==="success"?"stable":"active";
  item.recommendations=[...(item.repositoryUrl?[]:["add_remote"]),...(item.dirty?["commit_or_stash_local_changes"]:[]),...(item.ciStatus==="failure"?["fix_ci"]:[])];
  item.evidence=["git","manifests",...(github.has(item.canonicalKey)?["github_api"]:[])];repositories.push(item);
}
repositories.sort((a,b)=>Number(b.deployed)-Number(a.deployed)||Number(b.starred)-Number(a.starred)||String(b.lastCommitAt||"").localeCompare(String(a.lastCommitAt||"")));
const report={version:"repository-audit-v1",generatedAt:new Date().toISOString(),root,count:repositories.length,changed,cacheHits,repositories};
await writeFile(join(cacheDir,"latest.json"),JSON.stringify(report,null,2));
const syncSummary=Object.fromEntries([...new Set(repositories.map(item=>item.syncStatus))].map(status=>[status,repositories.filter(item=>item.syncStatus===status).length]));
const hygieneSummary=Object.fromEntries(["pass","warning","fail","unknown"].map(status=>[status,repositories.filter(item=>item.hygiene?.status===status).length]));
await writeFile(join(cacheDir,"summary.json"),JSON.stringify({generatedAt:report.generatedAt,count:report.count,changed,cacheHits,dirty:repositories.filter(x=>x.dirty).length,missingRemote:repositories.filter(x=>!x.repositoryUrl).length,githubMatched:repositories.filter(x=>x.githubMetadata).length,syncSummary,hygieneSummary},null,2));
if(upload)await uploadAll(repositories.filter(item=>full||!item.cacheHit));
console.log(JSON.stringify({count:report.count,changed,cacheHits,dirty:repositories.filter(x=>x.dirty).length,missingRemote:repositories.filter(x=>!x.repositoryUrl).length,githubMatched:repositories.filter(x=>x.githubMetadata).length,syncSummary,hygieneSummary,output:join(cacheDir,"latest.json")},null,2));

async function walk(directory,out){let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{return;}if(entries.some(x=>x.isDirectory()&&x.name===".git")){out.push(directory);return;}for(const entry of entries)if(entry.isDirectory()&&!ignored.has(entry.name))await walk(join(directory,entry.name),out);}
async function inspect(directory){
  const remote=await git(directory,["remote","get-url","origin"]),canonical=normalizeRemote(remote),headSha=await git(directory,["rev-parse","HEAD"]),branch=await git(directory,["branch","--show-current"]),lastCommitAt=await git(directory,["log","-1","--format=%cI"]),status=await git(directory,["status","--porcelain"]),counts=await aheadBehind(directory);
  const files=await topFiles(directory),manifestData=[],frameworks=new Set(),languages=new Set(),entrypoints=[];let description=null;
  for(const name of manifests){const path=join(directory,name);const text=await boundedRead(path,32_000);if(!text)continue;manifestData.push(`${name}:${hash(text)}`);if(name==="package.json"){try{const p=JSON.parse(text);description=p.description||description;languages.add("TypeScript/JavaScript");for(const key of ["main","module"])if(p[key])entrypoints.push(String(p[key]));const deps={...p.dependencies,...p.devDependencies};for(const [dep,label] of [["astro","Astro"],["next","Next.js"],["react","React"],["wrangler","Cloudflare Workers"]])if(deps[dep])frameworks.add(label);}catch{}}if(name==="pyproject.toml"){languages.add("Python");frameworks.add("Python");description=text.match(/^description\s*=\s*["']([^"']+)/m)?.[1]||description;}if(name==="Cargo.toml")languages.add("Rust");if(name==="go.mod")languages.add("Go");if(name.includes("compose")||name==="Dockerfile")frameworks.add("Docker");if(name==="wrangler.jsonc")frameworks.add("Cloudflare Workers");}
  const readmeName=files.find(x=>/^readme(\.|$)/i.test(x)),readme=readmeName?await boundedRead(join(directory,readmeName),12_000):"",lockNames=files.filter(x=>/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/.test(x));
  const tracked=await git(directory,["ls-files"]);const trackedFiles=tracked.split("\n").filter(Boolean);
  const hygiene=buildHygiene(directory,files,trackedFiles,manifestData,description);
  const key=canonical?.key||`local/${hash(relative(root,directory)).slice(0,20)}`;
  const sourceRef=relative(root,directory).split(sep).join("/");
  return{projectId:`local-${hash(sourceRef).slice(0,16)}`,canonicalKey:key,githubOwner:canonical?.owner??null,githubRepo:canonical?.repo??null,repositoryUrl:canonical?.url??(remote||null),localPaths:[sourceRef],name:basename(directory),headSha,branch,dirty:Boolean(status),ahead:counts.ahead,behind:counts.behind,lastCommitAt,manifestHash:hash(manifestData.sort().join("|")),lockfileHash:await hashFiles(directory,lockNames),readmeHash:hash(readme||""),readmeExcerpt:sanitize(readme).slice(0,2400),description,frameworks:[...frameworks],languages:[...languages],entrypoints:entrypoints.slice(0,12),topLevel:files.filter(x=>!isSensitiveName(x)).slice(0,80),deploymentFingerprint:hash(manifestData.filter(x=>/Docker|compose|wrangler/i.test(x)).join("|")),deployed:false,deploymentStatus:"not_checked",starred:false,hygiene};
}
async function discoverAccessibleGithub(){
  try{
    const {stdout}=await execGithub(["api","user/repos","--method","GET","--paginate","--slurp","-f","per_page=100","-f","affiliation=owner,collaborator,organization_member"],30_000_000);
    const pages=JSON.parse(stdout),repos=pages.flat();
    return repos.map(r=>{const canonical=normalizeRemote(r.html_url);return{projectId:null,canonicalKey:canonical.key,githubOwner:r.owner.login,githubRepo:r.name,repositoryUrl:r.html_url,localPaths:[],name:r.name,headSha:null,branch:null,dirty:false,ahead:null,behind:null,lastCommitAt:null,manifestHash:hash(""),lockfileHash:hash(""),readmeHash:hash(""),readmeExcerpt:"",description:r.description||null,frameworks:[],languages:[],entrypoints:[],topLevel:[],deploymentFingerprint:hash(""),deployed:false,deploymentStatus:"not_checked",starred:false,defaultBranch:r.default_branch,pushedAt:r.pushed_at,visibility:r.visibility,archived:r.archived,fork:r.fork,topics:r.topics||[],githubMetadata:{nameWithOwner:r.full_name,url:r.html_url},hygiene:{status:"unknown",checks:{},findings:["local_source_unavailable"]}};});
  }catch(error){console.error(`GitHub repository discovery unavailable: ${String(error.stderr||error.message).trim().split("\n").at(-1)}`);return[];}
}
async function githubMetadata(items){const result=new Map(),targets=items.filter(x=>x.githubOwner&&x.githubRepo&&x.canonicalKey.startsWith("github.com/")).slice(0,500);for(let i=0;i<targets.length;i+=30){const batch=targets.slice(i,i+30),fields=batch.map((x,n)=>`r${n}:repository(owner:${JSON.stringify(x.githubOwner)},name:${JSON.stringify(x.githubRepo)}){nameWithOwner url isPrivate isArchived isFork pushedAt defaultBranchRef{name target{... on Commit{oid statusCheckRollup{state}}}} repositoryTopics(first:20){nodes{topic{name}}} licenseInfo{spdxId} latestRelease{name publishedAt}}`).join("\n");let stdout="";try{stdout=(await execGithub(["api","graphql","-f",`query=query{${fields}}`],8_000_000)).stdout;}catch(error){stdout=error.stdout||"";console.error(`GitHub batch ${i/30+1}: partial response (${String(error.stderr||"API error").trim().split("\n").at(-1)})`);}try{const data=JSON.parse(stdout).data||{};batch.forEach((x,n)=>{const r=data[`r${n}`];if(!r)return;result.set(x.canonicalKey,{defaultBranch:r.defaultBranchRef?.name??null,pushedAt:r.pushedAt,visibility:r.isPrivate?"private":"public",archived:r.isArchived,fork:r.isFork,ciStatus:String(r.defaultBranchRef?.target?.statusCheckRollup?.state||"unknown").toLowerCase(),releaseName:r.latestRelease?.name??null,topics:r.repositoryTopics?.nodes?.map(v=>v.topic.name)||[],githubMetadata:{nameWithOwner:r.nameWithOwner,url:r.url,license:r.licenseInfo?.spdxId??null,headSha:r.defaultBranchRef?.target?.oid??null}});});}catch{console.error(`GitHub batch ${i/30+1}: response unavailable`);}
    for(const item of batch.filter(x=>!result.has(x.canonicalKey))){try{const fallback=JSON.parse((await execGithub(["api",`repos/${item.githubOwner}/${item.githubRepo}`],2_000_000)).stdout);result.set(item.canonicalKey,{defaultBranch:fallback.default_branch??null,pushedAt:fallback.pushed_at??null,visibility:fallback.private?"private":"public",archived:Boolean(fallback.archived),fork:Boolean(fallback.fork),ciStatus:"unknown",releaseName:null,topics:fallback.topics||[],githubMetadata:{nameWithOwner:fallback.full_name,url:fallback.html_url,license:fallback.license?.spdx_id??null,headSha:null}});}catch{}}
  }return result;}
function buildDossier(item,old){const value={identity:{key:item.canonicalKey,name:item.name,remote:item.repositoryUrl,localPaths:item.localPaths},git:{head:item.headSha,branch:item.branch,dirty:item.dirty,ahead:item.ahead,behind:item.behind,lastCommitAt:item.lastCommitAt},github:{defaultBranch:item.defaultBranch,pushedAt:item.pushedAt,visibility:item.visibility,archived:item.archived,fork:item.fork,ciStatus:item.ciStatus,release:item.releaseName,topics:item.topics},project:{description:item.description,languages:item.languages,frameworks:item.frameworks,entrypoints:item.entrypoints,topLevel:item.topLevel,readmeExcerpt:item.readmeExcerpt},hygiene:item.hygiene,deployment:{fingerprint:item.deploymentFingerprint,status:item.deploymentStatus},change:old?{previousFingerprint:old.fingerprint,headChanged:old.headSha!==item.headSha,manifestsChanged:old.manifestHash!==item.manifestHash,lockfileChanged:old.lockfileHash!==item.lockfileHash}: {firstReview:true}};return sanitize(JSON.stringify(value,null,2)).slice(0,8192);}
async function uploadAll(items){
  const base=process.env.WORKER_URL||"http://127.0.0.1:8787",token=process.env.ADMIN_TOKEN;if(!token)throw new Error("ADMIN_TOKEN is required for --upload");
  for(let index=0;index<items.length;index+=10)await Promise.all(items.slice(index,index+10).map(async item=>{const payload={...item,dossier:sanitize(item.dossier),hygiene:item.hygiene,syncStatus:item.syncStatus,deploymentStatus:item.deploymentStatus,deploymentEvidence:item.deploymentEvidence||[]};const response=await fetch(`${base}/admin/repository-reviews/snapshots`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!response.ok)throw new Error(`Upload ${item.canonicalKey}: ${response.status} ${await response.text()}`);}));
}

function buildHygiene(directory,files,trackedFiles,manifestData,description){
  const hasReadme=files.some(name=>/^readme(?:\.|$)/i.test(name));
  const hasManifest=manifestData.length>0;
  const hasLock=files.some(name=>/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/.test(name));
  const hasLicense=files.some(name=>/^licen[cs]e(?:\.|$)/i.test(name));
  const hasCi=trackedFiles.some(name=>/^\.github\/workflows\/[^/]+\.(ya?ml)$/i.test(name));
  const hasTests=trackedFiles.some(name=>/(^|\/)(test|tests|spec|__tests__)(\/|\.|$)/i.test(name));
  const hasFormatting=trackedFiles.some(name=>/(^|\/)(\.prettierrc|prettier\.config|\.editorconfig|eslint\.config|\.eslintrc|ruff\.toml|rustfmt\.toml)/i.test(name));
  const hasTypes=trackedFiles.some(name=>/(^|\/)(tsconfig\.json|pyrightconfig\.json|mypy\.ini)/i.test(name));
  const hasDeployment=files.some(name=>/^(Dockerfile|docker-compose\.yml|compose\.yml|wrangler\.jsonc|wrangler\.toml|\.dockerignore)$/i.test(name))||trackedFiles.some(name=>/^\.github\/workflows\//.test(name));
  const trackedSecrets=trackedFiles.filter(name=>isSensitiveName(name));
  const trackedGenerated=trackedFiles.filter(name=>/(^|\/)(node_modules|dist|build|coverage|\.wrangler|\.astro|\.next|vendor|target|__pycache__)(\/|$)/i.test(name));
  const checks={readme:hasReadme?"pass":"warning",manifest:hasManifest?"pass":"warning",lockfile:hasLock?"pass":"warning",license:hasLicense?"pass":"warning",ci:hasCi?"pass":"warning",tests:hasTests?"pass":"warning",formatting:hasFormatting?"pass":"warning",types:hasTypes?"pass":"unknown",deployment:hasDeployment?"pass":"unknown",trackedSecrets:trackedSecrets.length?"fail":"pass",trackedGenerated:trackedGenerated.length?"fail":"pass"};
  const findings=[];for(const [name,status] of Object.entries(checks))if(status!=="pass"&&status!=="unknown")findings.push(`${name}:${status}`);if(!description)findings.push("description:warning");
  return{status:checks.trackedSecrets==="fail"||checks.trackedGenerated==="fail"?"fail":findings.length?"warning":"pass",checks,findings,trackedSecretCount:trackedSecrets.length,trackedGeneratedCount:trackedGenerated.length};
}

function deriveSyncStatus(item){
  if(!item.repositoryUrl)return "no_remote";
  if(!item.repositoryUrl.toLowerCase().includes("github.com"))return item.dirty?"dirty_uncommitted":"remote_non_github";
  if(!item.githubMetadata)return "github_not_found_or_no_access";
  if(item.dirty)return "dirty_uncommitted";
  if(Number(item.ahead)>0&&Number(item.behind)>0)return "diverged";
  if(Number(item.ahead)>0)return "local_ahead";
  if(Number(item.behind)>0)return "github_ahead";
  if(item.headSha&&item.githubMetadata.headSha)return item.headSha===item.githubMetadata.headSha?"synced":"github_head_mismatch";
  return "unverified";
}

function isSensitiveName(name){
  const base=basename(String(name));
  if(/^\.env\.(?:example|sample|template|defaults?)$/i.test(base))return false;
  return sensitive.test(base);
}

function normalizeRemote(value){if(!value)return null;const input=value.trim().replace(/\.git$/i,"");const m=input.match(/^(?:git@|ssh:\/\/git@)?([^:/]+)[:/]([^/]+)\/([^/]+)$/i)||input.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)$/i);if(!m)return null;return{key:`${m[1].toLowerCase()}/${m[2].toLowerCase()}/${m[3].toLowerCase()}`,owner:m[2],repo:m[3],url:`https://${m[1].toLowerCase()}/${m[2]}/${m[3]}`};}
async function git(directory,args){try{return(await exec("git",["-C",directory,...args],{maxBuffer:2_000_000})).stdout.trim();}catch{return"";}}
async function aheadBehind(directory){const value=await git(directory,["rev-list","--left-right","--count","@{upstream}...HEAD"]);const [behind,ahead]=value.split(/\s+/).map(Number);return{ahead:Number.isFinite(ahead)?ahead:null,behind:Number.isFinite(behind)?behind:null};}
async function topFiles(directory){try{return(await readdir(directory,{withFileTypes:true})).filter(x=>x.name!==".git"&&!ignored.has(x.name)&&!isSensitiveName(x.name)).map(x=>x.isDirectory()?`${x.name}/`:x.name).sort();}catch{return[];}}
async function boundedRead(path,max){try{const s=await stat(path);if(!s.isFile()||s.size>max*4)return"";return(await readFile(path,"utf8")).slice(0,max);}catch{return"";}}
async function hashFiles(directory,names){const values=[];for(const name of names)values.push(`${name}:${hash(await boundedRead(join(directory,name),100_000))}`);return hash(values.join("|"));}
async function execGithub(argv,maxBuffer){let lastError;for(let attempt=0;attempt<3;attempt+=1){try{return await exec("gh",argv,{maxBuffer});}catch(error){lastError=error;if(attempt<2)await sleep(500*(attempt+1));}}throw lastError;}
function sleep(ms){return new Promise(resolvePromise=>setTimeout(resolvePromise,ms));}
function sanitize(value){return String(value).replace(/-----BEGIN [\s\S]*?-----END[^-]*-----/g,"[redacted]").replace(/(["']?(?:api[_-]?key|password|secret|token)["']?\s*[=:]\s*["']?)[^\s,\"']{8,}/gi,"$1[x]");}
function hash(value){return createHash("sha256").update(String(value)).digest("hex");}function slug(value){return String(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);}async function readJson(path,fallback){try{return JSON.parse(await readFile(path,"utf8"));}catch{return fallback;}}
