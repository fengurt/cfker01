import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export async function probeDnsAssets(assets,{batchSize=40,concurrency=6,timeoutMs=4000}={}){
  const groups=new Map();
  for(const asset of assets){
    if(asset.kind!=="dns_record"||!["A","CNAME"].includes(asset.metadata?.type)||!["enable","active","available"].includes(asset.status))continue;
    const host=String(asset.name).toLowerCase();
    const group=groups.get(host)||{host,assets:[],checkedAt:null};
    group.assets.push(asset);
    const checkedAt=asset.metadata?.probe?.checkedAt;
    if(checkedAt&&(!group.checkedAt||checkedAt<group.checkedAt))group.checkedAt=checkedAt;
    groups.set(host,group);
  }
  const queue=[...groups.values()].sort((left,right)=>String(left.checkedAt||"").localeCompare(String(right.checkedAt||""))).slice(0,Math.max(0,batchSize));
  await runPool(queue,Math.max(1,concurrency),async group=>{
    const probe=await probeHost(group.host,{timeoutMs});
    for(const asset of group.assets)asset.metadata.probe=probe;
  });
  return{eligibleHosts:groups.size,probedHosts:queue.length};
}

export async function probeUrlAssets(assets,{batchSize=20,concurrency=4,timeoutMs=5000}={}){
  const candidates=assets.filter(asset=>asset.kind==="pages_project"&&typeof asset.url==="string"&&asset.url.startsWith("https://"));
  const queue=candidates.sort((left,right)=>String(left.metadata?.probe?.checkedAt||"").localeCompare(String(right.metadata?.probe?.checkedAt||""))).slice(0,Math.max(0,batchSize));
  await runPool(queue,Math.max(1,concurrency),async asset=>{
    const probe=await probeUrl(asset.url,{timeoutMs});
    asset.metadata.probe=probe;
    asset.metadata.performanceAdvice=performanceAdvice(probe);
  });
  return{eligibleUrls:candidates.length,probedUrls:queue.length};
}

export async function probeHost(host,{timeoutMs=4000,lookupFn=dnsLookup,requestFn=requestStatus}={}){
  const checkedAt=new Date().toISOString(),started=Date.now();
  let addresses;
  try{addresses=await lookupFn(host,{all:true,verbatim:true});}catch(error){return result("dns_error",checkedAt,started,{error:safeError(error)});}
  if(!addresses.length)return result("dns_error",checkedAt,started,{error:"no_address"});
  if(addresses.some(item=>!isPublicAddress(item.address)))return result("skipped_private",checkedAt,started,{addresses:addresses.map(item=>item.address)});
  const target=addresses[0];
  try{
    const response=await requestFn("https:",host,target,timeoutMs);
    return result(response.statusCode<400?"reachable":response.statusCode<500?"client_error":"server_error",checkedAt,started,{protocol:"https",httpStatus:response.statusCode,address:target.address});
  }catch(httpsError){
    try{
      const response=await requestFn("http:",host,target,timeoutMs);
      return result(response.statusCode<500?"reachable_insecure":"server_error_insecure",checkedAt,started,{protocol:"http",httpStatus:response.statusCode,address:target.address,httpsError:safeError(httpsError)});
    }catch(httpError){return result("unreachable",checkedAt,started,{address:target.address,httpsError:safeError(httpsError),httpError:safeError(httpError)});}
  }
}

async function probeUrl(value,{timeoutMs=5000}={}){
  try{const url=new URL(value);return await probeHost(url.hostname,{timeoutMs});}catch{return{version:1,status:"invalid_url",checkedAt:new Date().toISOString(),latencyMs:0,error:"invalid_url"};}
}

function performanceAdvice(probe){
  if(!["reachable","reachable_insecure"].includes(String(probe?.status)))return"检查 DNS、TLS、部署健康状态和源站日志";
  if(Number(probe.latencyMs)>1500)return"响应偏慢：优先检查冷启动、图片体积、缓存头和边缘缓存命中率";
  if(Number(probe.latencyMs)>600)return"可优化：检查静态资源压缩、缓存策略和第三方脚本";
  return"响应良好：保持缓存策略并持续观察";
}

export function isPublicAddress(address){
  const family=net.isIP(address);if(!family)return false;
  if(family===4){const [a,b]=address.split(".").map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19)));}
  const value=address.toLowerCase();return !(value==="::"||value==="::1"||value.startsWith("fc")||value.startsWith("fd")||value.startsWith("fe8")||value.startsWith("fe9")||value.startsWith("fea")||value.startsWith("feb")||value.startsWith("ff")||value.startsWith("::ffff:127.")||value.startsWith("::ffff:10.")||value.startsWith("::ffff:192.168."));
}

function requestStatus(protocol,host,target,timeoutMs){return new Promise((resolve,reject)=>{const transport=protocol==="https:"?https:http;const request=transport.request({protocol,hostname:host,servername:protocol==="https:"?host:undefined,path:"/",method:"HEAD",timeout:timeoutMs,lookup:(_hostname,options,callback)=>options?.all?callback(null,[target]):callback(null,target.address,target.family),headers:{"User-Agent":"TableAI-DNS-Probe/1.0","Accept":"*/*"}},response=>{const statusCode=response.statusCode||0;response.destroy();resolve({statusCode});});request.on("timeout",()=>request.destroy(new Error("timeout")));request.on("error",reject);request.end();});}
function result(status,checkedAt,started,extra={}){return{version:1,status,checkedAt,latencyMs:Date.now()-started,...extra};}
function safeError(error){return String(error?.code||error?.message||error).replace(/[\r\n]/g," ").slice(0,160);}
async function runPool(values,limit,work){let index=0;await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(index<values.length){const value=values[index++];await work(value);}}));}
