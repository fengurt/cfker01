/**
 * Tencent Cloud API 3.0 (TC3-HMAC-SHA256) request signer.
 * Worker runtime exposes Web Crypto + TextEncoder, so this stays dependency-free.
 *
 * Reference: https://cloud.tencent.com/document/api/1724/101843
 */

export interface Tc3Request {
  host: string; // e.g. "teo.tencentcloudapi.com"
  service: string; // e.g. "teo"
  action: string; // e.g. "DescribeZones"
  region?: string; // e.g. "ap-guangzhou"
  version: string; // API version, e.g. "2022-09-01"
  payload?: Record<string, unknown>;
  secretId: string;
  secretKey: string;
  token?: string;
  signal?: AbortSignal;
}

const ALG = "TC3-HMAC-SHA256";

function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const source = Uint8Array.from(bytes).buffer;
  return crypto.subtle.digest("SHA-256", source).then((buf) => {
    const arr = Array.from(new Uint8Array(buf));
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const source = key instanceof ArrayBuffer ? key : Uint8Array.from(key).buffer;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    source,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function tc3Request<T = unknown>(req: Tc3Request): Promise<T> {
  const {
    host,
    service,
    action,
    region = "",
    version,
    payload = {},
    secretId,
    secretKey,
    token,
    signal,
  } = req;

  const body = JSON.stringify(payload);
  const contentType = "application/json; charset=utf-8";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const date = new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);

  // Canonical request
  const httpRequestMethod = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const hashedRequestPayload = await sha256Hex(body);
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest =
    `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n` +
    `${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;

  // String to sign
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = `${ALG}\n${timestamp}\n${credentialScope}\n${hashedCanonical}`;

  // Signature
  const secretDate = await hmacSha256(
    new TextEncoder().encode(`TC3${secretKey}`),
    date,
  );
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, "tc3_request");
  const signatureBytes = await hmacSha256(secretSigning, stringToSign);
  const signature = toHex(signatureBytes);

  // Authorization
  const authorization =
    `${ALG} Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": contentType,
    Host: host,
    "X-TC-Action": action,
    "X-TC-Timestamp": timestamp,
    "X-TC-Version": version,
  };
  if (region) headers["X-TC-Region"] = region;
  if (token) headers["X-TC-Token"] = token;

  const res = await fetch(`https://${host}/`, {
    method: "POST",
    headers,
    body,
    signal,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`tc3_non_json_response: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`tc3_http_${res.status}: ${text.slice(0, 200)}`);
  }
  return json as T;
}
