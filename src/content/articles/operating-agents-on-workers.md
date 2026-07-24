---
title: Operating agent infrastructure on Cloudflare Workers
summary: A practical account of preserving health checks, scheduled collection, D1 history, and protected operations APIs.
kind: local
author: TableAI
publishedAt: 2026-07-12
reviewedAt: 2026-07-12
tags: [cloudflare, operations]
---

The public catalog is static by design, but its operational subsystem is not. Scheduled Worker handlers collect provider status, place the latest snapshots in KV, and retain history in D1. Protected routes manage API keys, audit events, and manual synchronization.

Keeping these responsibilities behind explicit route prefixes lets Cloudflare serve catalog assets directly while invoking Worker code only for APIs and operational traffic. The public content remains fast and cacheable, and the management surface retains its existing authentication model.

Deployments apply D1 migrations before publishing Worker code. Staging receives the same validation, build, migration, deploy, and smoke-test sequence used for production.
