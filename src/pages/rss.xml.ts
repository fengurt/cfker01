import { getCollection } from "astro:content";

export async function GET({ site }: { site?: URL }) {
  const base = site ?? new URL("https://catalog.example.com");
  const articles = (await getCollection("articles")).filter((article) => article.data.kind === "local");
  const items = articles.map((article) => `<item><title>${escape(article.data.title)}</title><link>${new URL(`/articles/${article.id}/`, base)}</link><guid>${new URL(`/articles/${article.id}/`, base)}</guid><description>${escape(article.data.summary)}</description><pubDate>${article.data.publishedAt.toUTCString()}</pubDate></item>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>TableAI Catalog</title><link>${base}</link><description>Technical writing about AI agents, evaluations, and operations.</description>${items}</channel></rss>`, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
function escape(value: string) { return value.replace(/[<>&'"]/g, (char) => ({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"})[char]!); }
