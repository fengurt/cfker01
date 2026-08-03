const base = process.argv[2] || process.env.BASE_URL;
if (!base) { console.error("Usage: node scripts/smoke-test.mjs https://deployment.example"); process.exit(2); }
const root = new URL(base);
const checks = [
  ["/", 302, "text/html"], ["/resources/", 200, "text/html"], ["/catalog/", 200, "text/html"], ["/api/v1/catalog?type=agent&per_page=2", 200, "application/json"],
  ["/api/v1/catalog/not-a-record", 404, "application/json"], ["/health", 200, "application/json"], ["/v1/status", 401, "application/json"], ["/admin/audit", 401, "application/json"],
];
for (const [path, status, type] of checks) {
  const response = await fetch(new URL(path, root), { redirect: "manual" });
  if (response.status !== status || !response.headers.get("content-type")?.includes(type)) throw new Error(`${path}: expected ${status} ${type}, received ${response.status} ${response.headers.get("content-type")}`);
  if (path === "/" && response.headers.get("location") !== `${root.origin}/resources/`) throw new Error(`${path}: expected redirect to /resources/`);
  console.log(`ok ${path} ${status}`);
}
