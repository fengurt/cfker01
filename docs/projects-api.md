# Projects API

The projects API exposes scanned and imported resources from local filesystems, Git repositories, skills, agent guides, and future platform connectors.

## Public reads

`GET /api/v1/projects` accepts `q`, `platform`, `type`, `source_kind`, `page`, and `per_page`. Page size is limited to 100.

`GET /api/v1/projects/:id` returns one public resource.

Absolute local paths are never returned. Local resources use paths relative to the configured scan root.

## Source imports

`POST /api/v1/projects` requires an `X-Api-Key` with the `write` scope. The request body is:

```json
{
  "id": "github-example-project",
  "name": "Example project",
  "description": "A factual project description.",
  "resourceTypes": ["project", "agent"],
  "platform": "github",
  "sourceKind": "git-repository",
  "sourceRef": "example/project",
  "repositoryUrl": "https://github.com/example/project",
  "languages": ["TypeScript"],
  "frameworks": ["Cloudflare Workers"],
  "status": "reviewed",
  "visibility": "public",
  "metadata": { "connector": "github" }
}
```

Supplying the same `id` updates that source record. Omit `id` to create an external UUID. Source systems should use stable IDs so repeat imports are idempotent.

## Local scanning

`npm run projects:scan` scans `/Users/af/cpro01` by default and writes `src/generated/local-projects.json`. Build artifacts, dependencies, virtual environments, caches, and vendor directories are excluded.

The protected `POST /admin/projects/import-local` route imports the generated scan into D1. Existing descriptions are retained so later manual enrichment is not overwritten by another scan.
