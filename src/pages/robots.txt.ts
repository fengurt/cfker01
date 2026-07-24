export function GET({ site }: { site?: URL }) {
  const base = site ?? new URL("https://catalog.example.com");
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap-index.xml", base)}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
