import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const entries = JSON.parse(await readFile(resolve(root, "src/content/entries.json"), "utf8"));
const collections = JSON.parse(await readFile(resolve(root, "src/content/collections.json"), "utf8"));
const articles = JSON.parse(await readFile(resolve(root, "src/generated/articles.json"), "utf8"));
const urls = z.string().url();
const entry = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string().min(2), summary: z.string().min(20).max(240), description: z.string().min(30),
  types: z.array(z.enum(["app","skill","agent","benchmark"])).min(1), tags: z.array(z.string()).min(1), maturity: z.enum(["experimental","active","stable","archived"]),
  ownership: z.enum(["first_party","third_party"]), maintainers: z.array(z.string()).min(1), sourceUrl: urls, homepage: urls.optional(), documentation: urls.optional(),
  createdAt: z.string().date(), reviewedAt: z.string().date(), provenance: z.object({sources:z.array(urls).min(1),reviewer:z.string().min(2),status:z.literal("reviewed")}),
  benchmarkEvidence: z.array(z.object({methodologyUrl:urls,resultUrl:urls,evaluator:z.string(),evaluatedTarget:z.string(),publishedAt:z.string().date(),metrics:z.array(z.object({name:z.string(),value:z.string()})).min(1),limitations:z.string().min(10)})).optional(),
  showcase: z.object({problem:z.string(),architecture:z.string(),outcomes:z.array(z.string()).min(1),image:z.string().optional()}).optional(),
}).passthrough();
const article = z.object({ id:z.string(), title:z.string(), summary:z.string().min(20), kind:z.enum(["local","external"]), author:z.string(), publishedAt:z.string().date(), reviewedAt:z.string().date(), tags:z.array(z.string()), canonicalUrl:urls.optional(), sourceUrl:urls.optional() });

z.array(entry).min(40).max(80).parse(entries);
z.array(article).min(1).parse(articles);
unique(entries, "catalog entries"); unique(articles, "articles"); unique(collections, "collections");
const ids = new Set(entries.map((item) => item.id));
for (const group of collections) for (const id of group.entries) if (!ids.has(id)) throw new Error(`Collection ${group.id} references unknown entry ${id}`);
for (const item of entries) {
  if (item.ownership === "first_party" && !item.showcase) throw new Error(`First-party entry ${item.id} requires showcase metadata`);
  if (item.types.includes("benchmark") && item.benchmarkEvidence?.length) for (const evidence of item.benchmarkEvidence) if (evidence.methodologyUrl === evidence.resultUrl && !evidence.limitations) throw new Error(`Benchmark ${item.id} needs limitations`);
}
const articleFiles = (await readdir(resolve(root, "src/content/articles"))).filter((name) => /\.mdx?$/.test(name)).map((name) => name.replace(/\.mdx?$/, ""));
for (const item of articles) if (!articleFiles.includes(item.id)) throw new Error(`Generated article ${item.id} has no content file`);
for (const id of articleFiles) if (!articles.some((item) => item.id === id)) throw new Error(`Article ${id} is missing from the API index`);
console.log(`Validated ${entries.length} entries, ${articles.length} articles, and ${collections.length} collections.`);

function unique(items, label) { const seen = new Set(); for (const item of items) { if (seen.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}`); seen.add(item.id); } }
