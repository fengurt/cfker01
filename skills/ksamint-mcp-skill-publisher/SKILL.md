---
name: ksamint-mcp-skill-publisher
description: Stage, validate, and publish reusable agent SKILL.md files through the Ksamint-status MCP server. Use when an agent needs to create or update a Ksamint-managed skill, request its GitHub pull request, inspect publication status, or synchronize a reviewed skill back into the catalog.
---

# Ksamint MCP skill publisher

Use `https://g.ksamint.cn/mcp` with a `read,skills:write` key read at runtime
from 1Password field `ksamint-mcp-write-api` in `Personal/TableAI Catalog`.
Never print, commit, or persist the raw key outside a secure secret store.

1. Call `skills.stage` with a lowercase hyphenated slug and a complete
   `SKILL.md`. The frontmatter `name` must equal the slug and must include a
   useful `description`.
2. Stop on a rejected validation result; remove secret-like data and repair the
   frontmatter before staging a new draft.
3. Call `skills.request_publish` only for a validated draft.
4. Run `KSAMINT_MCP_WRITE_KEY="$(op read 'op://Personal/TableAI Catalog/ksamint-mcp-write-api')" npm run skills:publish -- <draft-id>`.
5. Review the generated GitHub PR. The publisher never writes `main`.
6. After merge, run the normal project scan to discover the skill again.

Do not use `ADMIN_TOKEN` as an MCP key, bypass pull-request review, or place
credentials, `.env` content, or private infrastructure details in skill text.
