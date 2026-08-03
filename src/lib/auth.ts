import { hashPassword, verifyPassword } from "./crypto";

const SESSION_NAME = "tableai_admin";
const DEVICE_NAME = "tableai_admin_device";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 90;
const LOCK_SECONDS = 15 * 60;

export async function requireAdminToken(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const bearerValid = Boolean(
    token && env.ADMIN_TOKEN && (await timingSafeEqual(token, env.ADMIN_TOKEN)),
  );
  const session = await readAdminSession(request, env);
  if (!bearerValid && !session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

export async function readAdminSession(
  request: Request,
  env: Env,
): Promise<{ userId: string; phone: string; role: string } | null> {
  if (!env.ADMIN_TOKEN) return null;
  const cookie = cookieValue(request, SESSION_NAME);
  if (cookie) {
    const [payload, signature] = cookie.split(".");
    if (
      payload &&
      signature &&
      (await timingSafeEqual(
        signature,
        await sign(payload, sessionSecret(env)),
      ))
    )
      try {
        const value = JSON.parse(decodeText(payload)) as {
          uid?: string;
          phone?: string;
          role?: string;
          exp?: number;
        };
        if (
          value.uid &&
          value.phone &&
          value.role === "system_admin" &&
          value.exp &&
          value.exp > Math.floor(Date.now() / 1000)
        )
          return { userId: value.uid, phone: value.phone, role: value.role };
      } catch {}
  }
  return readTrustedDevice(request, env);
}

export async function refreshAdminSession(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await readAdminSession(request, env);
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const now = Date.now(),
    expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    payload = encodeText(
      JSON.stringify({
        uid: session.userId,
        phone: session.phone,
        role: session.role,
        exp: expiresAt,
      }),
    ),
    signature = await sign(payload, sessionSecret(env)),
    headers = new Headers({ "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    sessionCookie(`${payload}.${signature}`, SESSION_TTL_SECONDS, request, env),
  );
  const deviceToken = cookieValue(request, DEVICE_NAME);
  let deviceExpiresAt: string | null = null;
  if (deviceToken && env.ADMIN_TOKEN) {
    deviceExpiresAt = new Date(now + DEVICE_TTL_SECONDS * 1000).toISOString();
    const refreshed = await env.MGMT_DB.prepare(
      `UPDATE admin_device_sessions SET ip_prefix=?1,last_seen_at=?2,expires_at=?3 WHERE token_hash=?4 AND revoked_at IS NULL`,
    )
      .bind(
        ipPrefix(request),
        new Date(now).toISOString(),
        deviceExpiresAt,
        await sign(deviceToken, env.ADMIN_TOKEN),
      )
      .run();
    if ((refreshed.meta?.changes ?? 0) > 0)
      headers.append(
        "Set-Cookie",
        deviceCookie(deviceToken, DEVICE_TTL_SECONDS, request, env),
      );
  }
  return Response.json(
    {
      ok: true,
      role: session.role,
      phone: session.phone,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      deviceExpiresAt,
    },
    { headers },
  );
}

export async function createAdminSession(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.ADMIN_TOKEN)
    return Response.json({ error: "admin_not_configured" }, { status: 503 });
  if (!isValidRequestOrigin(request))
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const window = Math.floor(Date.now() / 900_000);
  const rateKey = `ratelimit:admin-login:${ip}:${window}`;
  const attempts = Number((await env.MGMT_KV.get(rateKey)) ?? "0");
  if (attempts >= 10)
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  let body: { phone?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  if (!phone || !password)
    return Response.json(
      { error: "phone_and_password_required" },
      { status: 400 },
    );
  let user = await findAdminByPhone(env, phone);
  if (
    !user &&
    password.length >= 7 &&
    (await canBootstrapLocalAdmin(request, env))
  ) {
    const passwordRecord = await hashPassword(password);
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.MGMT_DB.prepare(
      `INSERT INTO admin_users(id,phone_e164,password_hash,password_salt,password_iterations,role,active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'system_admin',1,?6,?6)`,
    )
      .bind(
        id,
        phone,
        passwordRecord.hash,
        passwordRecord.salt,
        passwordRecord.iterations,
        timestamp,
      )
      .run();
    ctx.waitUntil(
      env.MGMT_DB.prepare(
        `INSERT INTO audit_events(event_type,payload,created_at) VALUES('admin.local_bootstrapped',?1,?2)`,
      )
        .bind(JSON.stringify({ userId: id }), timestamp)
        .run(),
    );
    user = await findAdminByPhone(env, phone);
  }
  const now = Date.now();
  if (!user || !user.active) {
    ctx.waitUntil(
      env.MGMT_KV.put(rateKey, String(attempts + 1), { expirationTtl: 900 }),
    );
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }
  if (user.locked_until && Date.parse(user.locked_until) > now)
    return Response.json(
      { error: "account_locked" },
      {
        status: 423,
        headers: {
          "Retry-After": String(
            Math.ceil((Date.parse(user.locked_until) - now) / 1000),
          ),
        },
      },
    );
  if (
    !(await verifyPassword(
      password,
      user.password_hash,
      user.password_salt,
      user.password_iterations,
    ))
  ) {
    const failed = user.failed_attempts + 1;
    const locked =
      failed >= 5 ? new Date(now + LOCK_SECONDS * 1000).toISOString() : null;
    await env.MGMT_DB.prepare(
      `UPDATE admin_users SET failed_attempts=?1,locked_until=?2,updated_at=?3 WHERE id=?4`,
    )
      .bind(failed, locked, new Date(now).toISOString(), user.id)
      .run();
    ctx.waitUntil(
      env.MGMT_KV.put(rateKey, String(attempts + 1), { expirationTtl: 900 }),
    );
    return Response.json(
      { error: locked ? "account_locked" : "invalid_credentials" },
      { status: locked ? 423 : 401 },
    );
  }
  const timestamp = new Date(now).toISOString();
  await env.MGMT_DB.prepare(
    `UPDATE admin_users SET failed_attempts=0,locked_until=NULL,last_login_at=?1,updated_at=?1 WHERE id=?2`,
  )
    .bind(timestamp, user.id)
    .run();
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = encodeText(
    JSON.stringify({
      uid: user.id,
      phone: user.phone_e164,
      role: user.role,
      exp: expiresAt,
    }),
  );
  const signature = await sign(payload, sessionSecret(env));
  const deviceToken = token(),
    deviceExpiresAt = new Date(now + DEVICE_TTL_SECONDS * 1000).toISOString();
  await env.MGMT_DB.prepare(
    `UPDATE admin_device_sessions SET revoked_at=?1 WHERE user_id=?2 AND ip_prefix=?3 AND user_agent_hash=?4 AND revoked_at IS NULL`,
  )
    .bind(
      timestamp,
      user.id,
      ipPrefix(request),
      await userAgentHash(request, env),
    )
    .run();
  await env.MGMT_DB.prepare(
    `INSERT INTO admin_device_sessions(id,user_id,token_hash,ip_prefix,user_agent_hash,expires_at,last_seen_at,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)`,
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      await sign(deviceToken, env.ADMIN_TOKEN),
      ipPrefix(request),
      await userAgentHash(request, env),
      deviceExpiresAt,
      timestamp,
    )
    .run();
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    sessionCookie(`${payload}.${signature}`, SESSION_TTL_SECONDS, request, env),
  );
  headers.append(
    "Set-Cookie",
    deviceCookie(deviceToken, DEVICE_TTL_SECONDS, request, env),
  );
  return Response.json(
    {
      ok: true,
      role: user.role,
      phone: user.phone_e164,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      deviceExpiresAt,
    },
    { headers },
  );
}

export async function bootstrapAdmin(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.ADMIN_TOKEN)
    return Response.json({ error: "admin_not_configured" }, { status: 503 });
  const header = request.headers.get("Authorization");
  if (
    !header?.startsWith("Bearer ") ||
    !(await timingSafeEqual(header.slice(7), env.ADMIN_TOKEN))
  )
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const count = await env.MGMT_DB.prepare(
    `SELECT COUNT(*) AS count FROM admin_users`,
  ).first<{ count: number }>();
  if ((count?.count ?? 0) > 0)
    return Response.json(
      { error: "admin_already_bootstrapped" },
      { status: 409 },
    );
  let body: { phone?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  if (!phone || password.length < 7)
    return Response.json(
      { error: "invalid_bootstrap_credentials" },
      { status: 400 },
    );
  const passwordRecord = await hashPassword(password);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.MGMT_DB.prepare(
    `INSERT INTO admin_users(id,phone_e164,password_hash,password_salt,password_iterations,role,active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'system_admin',1,?6,?6)`,
  )
    .bind(
      id,
      phone,
      passwordRecord.hash,
      passwordRecord.salt,
      passwordRecord.iterations,
      now,
    )
    .run();
  return Response.json({ ok: true, id, phone }, { status: 201 });
}

export async function clearAdminSession(
  request: Request,
  env?: Env,
): Promise<Response> {
  const device = cookieValue(request, DEVICE_NAME);
  if (device && env?.ADMIN_TOKEN)
    await env.MGMT_DB.prepare(
      `UPDATE admin_device_sessions SET revoked_at=?1 WHERE token_hash=?2 AND revoked_at IS NULL`,
    )
      .bind(new Date().toISOString(), await sign(device, env.ADMIN_TOKEN))
      .run();
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", sessionCookie("", 0, request, env));
  headers.append("Set-Cookie", deviceCookie("", 0, request, env));
  return Response.json({ ok: true }, { headers });
}
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^1\d{10}$/.test(digits)) return `+86${digits}`;
  if (/^861\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\d{8,15}$/.test(digits)) return `+${digits}`;
  return null;
}
export function isValidRequestOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url),
      originUrl = new URL(origin);
    const forwardedHost = request.headers
        .get("X-Forwarded-Host")
        ?.split(",", 1)[0]
        ?.trim(),
      host = forwardedHost || request.headers.get("Host") || requestUrl.host;
    const forwarded = request.headers
      .get("X-Forwarded-Proto")
      ?.split(",", 1)[0]
      ?.trim()
      .toLowerCase();
    const protocol =
      forwarded === "https" || forwarded === "http"
        ? forwarded
        : requestUrl.protocol.slice(0, -1);
    return originUrl.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}
type AdminUser = {
  id: string;
  phone_e164: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  role: string;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
};
function findAdminByPhone(env: Env, phone: string) {
  return env.MGMT_DB.prepare(
    `SELECT id,phone_e164,password_hash,password_salt,password_iterations,role,active,failed_attempts,locked_until FROM admin_users WHERE phone_e164=?1`,
  )
    .bind(phone)
    .first<AdminUser>();
}
async function readTrustedDevice(
  request: Request,
  env: Env,
): Promise<{ userId: string; phone: string; role: string } | null> {
  const raw = cookieValue(request, DEVICE_NAME);
  if (!raw || !env.ADMIN_TOKEN) return null;
  const row = await env.MGMT_DB.prepare(
    `SELECT d.user_agent_hash,u.id,u.phone_e164,u.role,u.active FROM admin_device_sessions d JOIN admin_users u ON u.id=d.user_id WHERE d.token_hash=?1 AND d.revoked_at IS NULL AND datetime(d.expires_at)>CURRENT_TIMESTAMP`,
  )
    .bind(await sign(raw, env.ADMIN_TOKEN))
    .first<{
      user_agent_hash: string | null;
      id: string;
      phone_e164: string;
      role: string;
      active: number;
    }>();
  if (
    !row ||
    !row.active ||
    row.role !== "system_admin" ||
    row.user_agent_hash !== (await userAgentHash(request, env))
  )
    return null;
  return { userId: row.id, phone: row.phone_e164, role: row.role };
}
async function canBootstrapLocalAdmin(request: Request, env: Env) {
  const url = new URL(request.url);
  if (
    env.ENVIRONMENT !== "development" ||
    !(
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1"
    )
  )
    return false;
  const count = await env.MGMT_DB.prepare(
    `SELECT COUNT(*) AS count FROM admin_users`,
  ).first<{ count: number }>();
  return (count?.count ?? 0) === 0;
}
async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBytes(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    ),
  );
}
function sessionSecret(env: Env) {
  return String(
    (env as Env & { SESSION_SIGNING_KEY?: string }).SESSION_SIGNING_KEY ||
      env.ADMIN_TOKEN ||
      "",
  );
}
function sessionCookie(
  value: string,
  maxAge: number,
  request: Request,
  env?: Env,
) {
  const forwarded = request.headers
    .get("X-Forwarded-Proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const secure =
    new URL(request.url).protocol === "https:" ||
    forwarded === "https" ||
    env?.COOKIE_SECURE === "true"
      ? "; Secure"
      : "";
  return `${SESSION_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function deviceCookie(
  value: string,
  maxAge: number,
  request: Request,
  env?: Env,
) {
  const forwarded = request.headers
    .get("X-Forwarded-Proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const secure =
    new URL(request.url).protocol === "https:" ||
    forwarded === "https" ||
    env?.COOKIE_SECURE === "true"
      ? "; Secure"
      : "";
  return `${DEVICE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function cookieValue(request: Request, name: string) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
}
function token() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBytes(bytes);
}
async function userAgentHash(request: Request, env: Env) {
  return sign(request.headers.get("User-Agent") ?? "", env.ADMIN_TOKEN ?? "");
}
function ipPrefix(request: Request) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":") + "::/64";
  const bits = ip.split(".");
  return bits.length === 4 ? `${bits.slice(0, 3).join(".")}.0/24` : ip;
}
async function timingSafeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left),
    b = new TextEncoder().encode(right),
    length = Math.max(a.length, b.length, 1);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1)
    difference |=
      (a[index % Math.max(a.length, 1)] ?? 0) ^
      (b[index % Math.max(b.length, 1)] ?? 0);
  return difference === 0;
}
function encodeText(value: string) {
  return encodeBytes(new TextEncoder().encode(value));
}
function encodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function decodeText(value: string) {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "===".slice((value.length + 3) % 4);
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
  );
}
