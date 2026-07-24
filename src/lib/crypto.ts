const PBKDF2_ITERATIONS = 310_000;

export async function hashPassword(password: string, salt = randomBytes(16), iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", buffer(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: buffer(salt), iterations }, key, 256);
  return { hash: encode(new Uint8Array(bits)), salt: encode(salt), iterations };
}

export async function verifyPassword(password: string, expectedHash: string, salt: string, iterations: number) {
  const actual = await hashPassword(password, decode(salt), iterations);
  return constantTimeEqual(actual.hash, expectedHash);
}

export async function encryptDocument(plaintext: string, encodedKey: string, projectId: string, documentType: string, keyVersion: string) {
  const key = await importAesKey(encodedKey); const nonce = randomBytes(12); const aad = new TextEncoder().encode(`${projectId}:${documentType}:${keyVersion}`);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(nonce), additionalData: buffer(aad) }, key, buffer(new TextEncoder().encode(plaintext)));
  const contentHash = await sha256(plaintext);
  return { ciphertext: encode(new Uint8Array(ciphertext)), nonce: encode(nonce), contentHash };
}

export async function decryptDocument(ciphertext: string, nonce: string, encodedKey: string, projectId: string, documentType: string, keyVersion: string) {
  const key = await importAesKey(encodedKey); const aad = new TextEncoder().encode(`${projectId}:${documentType}:${keyVersion}`);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(decode(nonce)), additionalData: buffer(aad) }, key, buffer(decode(ciphertext)));
  return new TextDecoder().decode(plaintext);
}

export function randomKey() { return encode(randomBytes(32)); }
async function importAesKey(value: string) { const bytes=decode(value); if(bytes.length!==32) throw new Error("invalid_content_encryption_key"); return crypto.subtle.importKey("raw",buffer(bytes),{name:"AES-GCM"},false,["encrypt","decrypt"]); }
async function sha256(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return encode(new Uint8Array(bytes));}
function randomBytes(length:number){const bytes=new Uint8Array(length);crypto.getRandomValues(bytes);return bytes;}
export function encode(bytes:Uint8Array){let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
export function decode(value:string){const padded=value.replaceAll("-","+").replaceAll("_","/")+"===".slice((value.length+3)%4);const binary=atob(padded);return Uint8Array.from(binary,(char)=>char.charCodeAt(0));}
function constantTimeEqual(a:string,b:string){const length=Math.max(a.length,b.length,1);let difference=a.length^b.length;for(let index=0;index<length;index+=1)difference|=(a.charCodeAt(index%Math.max(a.length,1))||0)^(b.charCodeAt(index%Math.max(b.length,1))||0);return difference===0;}
function buffer(bytes:Uint8Array):ArrayBuffer{return bytes.slice().buffer;}
