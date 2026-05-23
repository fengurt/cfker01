export function requireAdminToken(request: Request, env: Env): Response | null {
  const configured = env.ADMIN_TOKEN;
  if (!configured) {
    return Response.json({ error: "admin_not_configured" }, { status: 503 });
  }

  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || token !== configured) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
