import { defineCollection, z } from "astro:content";
import { file, glob } from "astro/loaders";

const url = z.string().url();
const entrySchema = z.object({
  title: z.string().min(2),
  summary: z.string().min(20).max(240),
  description: z.string().min(30),
  types: z.array(z.enum(["app", "skill", "agent", "benchmark"])).min(1),
  tags: z.array(z.string()).min(1),
  maturity: z.enum(["experimental", "active", "stable", "archived"]),
  ownership: z.enum(["first_party", "third_party"]),
  maintainers: z.array(z.string()).min(1),
  sourceUrl: url,
  homepage: url.optional(),
  documentation: url.optional(),
  license: z.string().optional(),
  platforms: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
  reviewedAt: z.coerce.date(),
  featured: z.boolean().default(false),
  provenance: z.object({ sources: z.array(url).min(1), reviewer: z.string(), status: z.literal("reviewed") }),
  benchmarkEvidence: z.array(z.object({
    methodologyUrl: url,
    resultUrl: url,
    evaluator: z.string(),
    evaluatedTarget: z.string(),
    publishedAt: z.coerce.date(),
    metrics: z.array(z.object({ name: z.string(), value: z.string() })).min(1),
    limitations: z.string().min(10),
  })).default([]),
  showcase: z.object({ problem: z.string(), architecture: z.string(), outcomes: z.array(z.string()).min(1), image: z.string().optional() }).optional(),
});

const articleSchema = z.object({
  title: z.string(),
  summary: z.string().min(20),
  kind: z.enum(["local", "external"]),
  author: z.string(),
  publishedAt: z.coerce.date(),
  reviewedAt: z.coerce.date(),
  tags: z.array(z.string()),
  canonicalUrl: url.optional(),
  sourceUrl: url.optional(),
});

export const collections = {
  entries: defineCollection({ loader: file("src/content/entries.json"), schema: entrySchema }),
  articles: defineCollection({ loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/articles" }), schema: articleSchema }),
  collections: defineCollection({ loader: file("src/content/collections.json"), schema: z.object({ title: z.string(), summary: z.string(), entries: z.array(z.string()).min(1), featured: z.boolean().default(false) }) }),
};
