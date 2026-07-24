import entries from "../content/entries.json";
import articles from "../generated/articles.json";
import { jsonResponse } from "../lib/response";

const ENTRY_TYPES = new Set(["app", "skill", "agent", "benchmark"]);
const OWNERSHIP = new Set(["first_party", "third_party"]);
const MATURITY = new Set(["experimental", "active", "stable", "archived"]);
const CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

function response(body: unknown, status = 200): Response {
  const out = jsonResponse(body, status);
  out.headers.set("Cache-Control", status === 200 ? CACHE : "no-store");
  out.headers.set("X-Content-Type-Options", "nosniff");
  return out;
}

export function handleCatalogApi(request: Request): Response {
  if (request.method !== "GET") return response({ error: { code: "method_not_allowed", message: "Only GET is supported." } }, 405);
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[2] === "catalog") {
    return parts[3] ? detail(entries, parts[3], "entry") : listEntries(url);
  }
  if (parts[2] === "articles") {
    return parts[3] ? detail(articles, parts[3], "article") : listArticles(url);
  }
  return response({ error: { code: "not_found", message: "Resource not found." } }, 404);
}

function detail<T extends { id: string }>(items: T[], slug: string, kind: string): Response {
  const item = items.find((candidate) => candidate.id === slug);
  return item
    ? response({ data: item, meta: { kind, version: "v1" } })
    : response({ error: { code: "not_found", message: `${kind} not found.` } }, 404);
}

function pagination(url: URL, total: number) {
  const page = Number(url.searchParams.get("page") ?? "1");
  const perPage = Number(url.searchParams.get("per_page") ?? "24");
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100) return null;
  return { page, perPage, total, pages: Math.ceil(total / perPage) };
}

function listEntries(url: URL): Response {
  const type = url.searchParams.get("type");
  const ownership = url.searchParams.get("ownership");
  const maturity = url.searchParams.get("maturity");
  const tag = url.searchParams.get("tag")?.toLowerCase();
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  if (type && !ENTRY_TYPES.has(type)) return badQuery("type");
  if (ownership && !OWNERSHIP.has(ownership)) return badQuery("ownership");
  if (maturity && !MATURITY.has(maturity)) return badQuery("maturity");
  let data = entries.filter((entry) =>
    (!type || entry.types.includes(type)) &&
    (!ownership || entry.ownership === ownership) &&
    (!maturity || entry.maturity === maturity) &&
    (!tag || entry.tags.some((value) => value.toLowerCase() === tag)) &&
    (!q || `${entry.title} ${entry.summary} ${entry.description} ${entry.tags.join(" ")}`.toLowerCase().includes(q)),
  );
  data = data.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false) || a.title.localeCompare(b.title));
  const meta = pagination(url, data.length);
  if (!meta) return badQuery("pagination");
  const start = (meta.page - 1) * meta.perPage;
  return response({ data: data.slice(start, start + meta.perPage), meta: { ...meta, version: "v1" } });
}

function listArticles(url: URL): Response {
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  const tag = url.searchParams.get("tag")?.toLowerCase();
  const kind = url.searchParams.get("kind");
  if (kind && kind !== "local" && kind !== "external") return badQuery("kind");
  const data = articles.filter((article) =>
    (!kind || article.kind === kind) &&
    (!tag || article.tags.some((value) => value.toLowerCase() === tag)) &&
    (!q || `${article.title} ${article.summary} ${article.tags.join(" ")}`.toLowerCase().includes(q)),
  );
  const meta = pagination(url, data.length);
  if (!meta) return badQuery("pagination");
  const start = (meta.page - 1) * meta.perPage;
  return response({ data: data.slice(start, start + meta.perPage), meta: { ...meta, version: "v1" } });
}

function badQuery(parameter: string): Response {
  return response({ error: { code: "invalid_query", message: `Invalid ${parameter} parameter.` } }, 400);
}
