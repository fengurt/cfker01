#!/usr/bin/env node
import assert from "node:assert/strict";
import { isPublicAddress, probeHost } from "./lib/dns-probe.mjs";

assert.equal(isPublicAddress("127.0.0.1"),false);
assert.equal(isPublicAddress("10.1.2.3"),false);
assert.equal(isPublicAddress("169.254.169.254"),false);
assert.equal(isPublicAddress("192.168.1.2"),false);
assert.equal(isPublicAddress("8.8.8.8"),true);

let requested=false;
const privateResult=await probeHost("private.example",{lookupFn:async()=>[{address:"10.0.0.3",family:4}],requestFn:async()=>{requested=true;return{statusCode:200};}});
assert.equal(privateResult.status,"skipped_private");
assert.equal(requested,false);

const lookupFn=async()=>[{address:"203.0.113.10",family:4}];
const secure=await probeHost("web.example",{lookupFn,requestFn:async()=>({statusCode:204})});
assert.equal(secure.status,"reachable");
assert.equal(secure.protocol,"https");
const fallback=await probeHost("legacy.example",{lookupFn,requestFn:async protocol=>{if(protocol==="https:")throw Object.assign(new Error("TLS"),{code:"CERT_ERROR"});return{statusCode:200};}});
assert.equal(fallback.status,"reachable_insecure");
assert.equal(fallback.httpsError,"CERT_ERROR");
console.log("DNS probe tests passed (3 cases).");
