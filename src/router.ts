import { handleHealth } from "./routes/health";
import { handleAdmin } from "./routes/admin";
import { handleV1 } from "./routes/v1";
import { handleAdminKeys } from "./routes/admin-keys";
import { handleAdminSync } from "./routes/admin-sync";
import { handleStatusPage } from "./routes/status-page";
import { handleMcp, handleMcpCard } from "./routes/mcp";
import { jsonResponse } from "./lib/response";
import { handleCatalogApi } from "./routes/catalog-api";
import { handleProjectsApi } from "./routes/projects-api";
import { handleAdminProjects } from "./routes/admin-projects";
import {
  bootstrapAdmin,
  clearAdminSession,
  createAdminSession,
  refreshAdminSession,
  requireAdminToken,
} from "./lib/auth";
import { handleAdminResourceOps } from "./routes/admin-resource-ops";
import { handleAdminServers } from "./routes/admin-servers";
import { handleAdminBenchmarks } from "./routes/admin-benchmarks";
import { handleAdminRepositoryReviews } from "./routes/admin-repository-reviews";
import { handleAdminAssets } from "./routes/admin-assets";
import { handleAdminDiscovery } from "./routes/admin-discovery";
import { handleAdminLinks } from "./routes/admin-links";
import { handleAdminMonitor } from "./routes/admin-monitor";
import { handleAdminApiV1 } from "./routes/admin-api-v1";
import { handleIngestApiV1 } from "./routes/ingest-api-v1";
import { handleAdminTasksV1 } from "./routes/admin-tasks";
import { proxyTaskApi } from "./routes/task-core-proxy";

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/admin/login" && request.method === "POST")
    return createAdminSession(request, env, ctx);
  if (pathname === "/admin/bootstrap" && request.method === "POST")
    return bootstrapAdmin(request, env);
  if (pathname === "/admin/logout" && request.method === "POST")
    return await clearAdminSession(request, env);
  if (pathname === "/admin/session" && request.method === "GET") {
    const auth = await requireAdminToken(request, env);
    if (auth) return auth;
    return refreshAdminSession(request, env);
  }

  if (
    pathname === "/api/task/v1" ||
    pathname.startsWith("/api/task/v1/") ||
    pathname === "/mcp/task"
  )
    return proxyTaskApi(request, env);

  if (
    pathname === "/api/admin/v1/tasks" ||
    pathname.startsWith("/api/admin/v1/tasks/") ||
    pathname === "/api/admin/v1/task-people" ||
    pathname.startsWith("/api/admin/v1/task-people/") ||
    pathname === "/api/admin/v1/task-milestones" ||
    pathname.startsWith("/api/admin/v1/task-milestones/") ||
    pathname === "/api/admin/v1/task-views" ||
    pathname.startsWith("/api/admin/v1/task-views/") ||
    pathname === "/api/admin/v1/task-context"
  )
    return handleAdminTasksV1(request, env, ctx);
  if (pathname === "/api/admin/v1" || pathname.startsWith("/api/admin/v1/"))
    return handleAdminApiV1(request, env, ctx);
  if (pathname === "/api/ingest/v1" || pathname.startsWith("/api/ingest/v1/"))
    return handleIngestApiV1(request, env, ctx);

  if (
    pathname === "/api/v1/projects" ||
    pathname.startsWith("/api/v1/projects/")
  )
    return handleProjectsApi(request, env, ctx);

  if (pathname === "/admin/projects" || pathname.startsWith("/admin/projects/"))
    return handleAdminProjects(request, env, ctx);
  if (pathname.startsWith("/admin/resources/"))
    return handleAdminResourceOps(request, env, ctx);
  if (pathname === "/admin/servers" || pathname.startsWith("/admin/servers/"))
    return handleAdminServers(request, env, ctx);
  if (
    pathname === "/admin/benchmarks" ||
    pathname.startsWith("/admin/benchmarks/")
  )
    return handleAdminBenchmarks(request, env, ctx);
  if (
    pathname === "/admin/repository-reviews" ||
    pathname.startsWith("/admin/repository-reviews/")
  )
    return handleAdminRepositoryReviews(request, env, ctx);
  if (pathname === "/admin/assets" || pathname.startsWith("/admin/assets/"))
    return handleAdminAssets(request, env, ctx);
  if (
    pathname === "/admin/discovery-runs" ||
    pathname.startsWith("/admin/discovery-runs/")
  )
    return handleAdminDiscovery(request, env, ctx);
  if (
    pathname === "/admin/resource-links" ||
    pathname.startsWith("/admin/resource-links/")
  )
    return handleAdminLinks(request, env, ctx);
  if (pathname === "/admin/monitor" || pathname.startsWith("/admin/monitor/"))
    return handleAdminMonitor(request, env, ctx);

  if (
    pathname === "/api/v1/catalog" ||
    pathname.startsWith("/api/v1/catalog/") ||
    pathname === "/api/v1/articles" ||
    pathname.startsWith("/api/v1/articles/")
  ) {
    return handleCatalogApi(request);
  }

  if (pathname === "/health") {
    return handleHealth();
  }

  if (pathname === "/status") {
    return handleStatusPage();
  }

  if (pathname === "/.well-known/mcp") {
    return handleMcpCard();
  }

  if (pathname === "/mcp") {
    return handleMcp(request, env, ctx);
  }

  if (pathname.startsWith("/v1/")) {
    return handleV1(request, env, ctx);
  }

  if (pathname === "/admin/sync" || pathname.startsWith("/admin/sync/")) {
    return handleAdminSync(request, env, ctx);
  }

  if (pathname.startsWith("/admin/keys")) {
    return handleAdminKeys(request, env, ctx);
  }

  if (pathname.startsWith("/admin")) {
    return handleAdmin(request, env, ctx);
  }

  if (pathname === "/") {
    return jsonResponse({
      service: env.APP_NAME,
      environment: env.ENVIRONMENT,
      routes: [
        "/health",
        "/api/v1/catalog",
        "/api/v1/articles",
        "/api/v1/projects",
        "/api/admin/v1/openapi.json",
        "/api/ingest/v1/jobs",
        "/status",
        "/v1/status",
        "/v1/status/:sourceId",
        "/v1/snapshots/:sourceId",
        "/admin/sync",
        "/admin/keys",
        "/.well-known/mcp",
        "/mcp",
      ],
    });
  }

  return jsonResponse({ error: "not_found" }, 404);
}
