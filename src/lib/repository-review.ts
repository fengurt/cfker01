export function canonicalRepository(value:string|null|undefined){
  if(!value)return null;
  const input=value.trim().replace(/\.git$/i,"");
  const match=input.match(/^(?:git@|ssh:\/\/git@)?([^:/]+)[:/]([^/]+)\/([^/]+)$/i)
    ??input.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)$/i);
  if(!match)return null;
  const host=match[1].toLowerCase(),owner=match[2].toLowerCase(),repo=match[3].toLowerCase();
  if(!host||!owner||!repo)return null;
  return{key:`${host}/${owner}/${repo}`,host,owner,repo,url:`https://${host}/${owner}/${repo}`};
}

export function safeReviewPayload(value:unknown){
  if(!value||typeof value!=="object")return false;
  const body=value as Record<string,unknown>;
  if(typeof body.canonicalKey!=="string"||typeof body.fingerprint!=="string"||typeof body.dossier!=="string")return false;
  if(body.dossier.length>16_384||body.dossier.length<2)return false;
  const forbidden=/(-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|secret)\s*[:=]\s*[^\s,]{8,})/i;
  return !forbidden.test(body.dossier);
}
