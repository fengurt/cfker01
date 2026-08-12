#!/usr/bin/env node
import http from "node:http";

const socketPath=process.env.DOCKER_SOCKET||"/var/run/docker.sock",port=Number(process.env.PORT||2375);
const allowed=[/^\/containers\/json(?:\?all=[01](?:&size=[01])?)?$/, /^\/containers\/[a-f0-9]{12,64}\/json$/, /^\/containers\/[a-f0-9]{12,64}\/stats\?stream=false&one-shot=true$/];

http.createServer((request,response)=>{
  if(request.url==="/health"){response.writeHead(200,{"Content-Type":"text/plain"});response.end("ok");return;}
  if(request.method!=="GET"||!allowed.some(pattern=>pattern.test(request.url||""))){response.writeHead(403,{"Content-Type":"application/json"});response.end('{"error":"docker_api_path_denied"}');return;}
  const upstream=http.request({socketPath,path:request.url,method:"GET",headers:{Accept:"application/json"}},incoming=>{
    response.writeHead(incoming.statusCode||502,{"Content-Type":incoming.headers["content-type"]||"application/json"});incoming.pipe(response);
  });
  upstream.setTimeout(30_000,()=>upstream.destroy(new Error("docker_api_timeout")));
  upstream.on("error",error=>{if(!response.headersSent)response.writeHead(502,{"Content-Type":"application/json"});response.end(JSON.stringify({error:"docker_api_unavailable",message:error.message}));});
  upstream.end();
}).listen(port,"0.0.0.0",()=>console.log(JSON.stringify({event:"docker_readonly_proxy_ready",port})));
