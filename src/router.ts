import { handleHealth } from "./routes/health";
import { handleStatus } from "./routes/status";
import { handleAdmin } from "./routes/admin";
import { jsonResponse } from "./lib/response";

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/health") {
    return handleHealth();
  }

  if (pathname === "/status") {
    return handleStatus(request, env);
  }

  if (pathname.startsWith("/admin")) {
    return handleAdmin(request, env, ctx);
  }

  if (pathname === "/") {
    return jsonResponse({
      service: env.APP_NAME,
      environment: env.ENVIRONMENT,
      routes: ["/health", "/status", "/admin/audit", "/admin/heartbeat"],
    });
  }

  return jsonResponse({ error: "not_found" }, 404);
}
