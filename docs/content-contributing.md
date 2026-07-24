# Catalog content guide

Catalog changes are reviewed through pull requests. Run `npm run content:validate`, `npm run build`, and `npm test` before requesting review.

## Entries

Add canonical records to `src/content/entries.json`. A project may use several types: `app`, `skill`, `agent`, or `benchmark`. Do not duplicate a project to place it in another category.

Every record needs a stable kebab-case ID, concise summary, concrete description, source URL, maintainers, dates, and reviewed provenance. Use `first_party` only for work maintained by this organization, and include `showcase` metadata for every first-party record.

Benchmark evidence must link its methodology and results, identify the evaluator and evaluated target, name the reported metric, and state important limitations. Do not convert results from different harnesses into a ranking.

## Articles

Create Markdown in `src/content/articles/`. Local articles contain the full body. External records contain a short catalog note and set both `canonicalUrl` and `sourceUrl`. Mirror public article metadata in `src/generated/articles.json`; validation prevents missing records in either direction.

## Collections

Curated groups live in `src/content/collections.json` and reference existing entry IDs. A collection is editorial organization, not a copy of its entries.

## First-party case studies

The `showcase` object requires a problem statement, architecture summary, and outcome list. Add real screenshots under `public/showcase/` and set `showcase.image` when suitable assets are available. Do not add mock product screenshots.
