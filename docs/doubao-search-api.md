# Doubao / Volcengine Ark web-search capability

Research and live-test date: 2026-08-12 (Asia/Shanghai).

## Supported interface

Volcengine Ark exposes public-web retrieval as the built-in `web_search` tool on the Responses API:

```http
POST https://ark.cn-beijing.volces.com/api/v3/responses
Authorization: Bearer <ARK inference API key>
Content-Type: application/json
```

Minimal request shape:

```json
{
  "model": "<a currently available Doubao Seed text model>",
  "store": false,
  "input": "Search for current official information and cite the sources.",
  "tools": [{ "type": "web_search" }]
}
```

The official tool documentation says Responses API tools can retrieve current public-web information such as news, products, and weather. This is distinct from private knowledge-base search and from a custom Function Calling integration. See [Ark tool calling](https://www.volcengine.com/docs/82379/1958524?lang=zh) and the [Ark documentation index](https://www.volcengine.com/docs/82379/?lang=zh).

## Production account test

The canonical `doubao-ark` credential passed model discovery and ordinary inference on 2026-08-12:

- credential: configured;
- model catalog: healthy, 130 model IDs;
- selected model: `doubao-seed-2-0-pro-260215`;
- ordinary inference: healthy.

The live catalog also listed `doubao-seed-2-1-pro-260628`, `doubao-seed-2-1-turbo-260628`, and `doubao-seed-evolving`, but this account returned `ModelNotOpen` for all three. A model appearing in `/models` therefore does not prove account-level invocation entitlement. The monitor's newest-usable selection must attempt ranked candidates and fall back on `ModelNotOpen`; the newest verified model for this account remains `doubao-seed-2-0-pro-260215`.

A paid, minimal live request to the same model with `tools: [{"type":"web_search"}]` returned:

```text
HTTP 404
error.type: NotFound
error.code: ToolNotOpen
```

This proves that the API key and model are usable but the account-level Web Search tool is not enabled. It must not be reported as a failed or expired inference credential.

## Agent Plan Harness search (current production path)

The APUCH account's **Agent Plan Medium** subscription was verified live on
2026-08-12. It is active through 2026-09-12 23:59 (Asia/Shanghai), and its
dedicated Plan key passed a minimal Responses API inference request:

```text
POST https://ark.cn-beijing.volces.com/api/plan/v3/responses
model: ark-code-latest
HTTP 200
```

Do not send Plan traffic to the ordinary `/api/v3` endpoint: the console warns
that doing so is billed outside the Plan. The Plan gateway does not expose a
general `/models` catalog; use the route models published in the Agent Plan
console, or `ark-code-latest`, instead of treating `/models` HTTP 404 as a key
failure.

The old Agent Plan **联网搜索 Beta** entitlement was removed on 2026-07-01.
Its replacement is the **豆包搜索** Harness, which was already enabled for the
account. It reuses the same Agent Plan dedicated key and supports Skill or MCP
integration. A live bounded request succeeded:

```text
POST https://open.feedcoopapi.com/search_api/web_search
SearchType: web
Count: 3
HTTP 200; ResultCount: 3
```

The current account terms shown in the console are 500 free searches per
calendar month, followed by 5 AFP per call from the Plan allowance. Overage
post-pay is disabled, so the verified configuration cannot silently consume
off-plan balance. See the official [Agent Plan Doubao Search guide](https://www.volcengine.com/docs/82379/2301412?lang=zh)
and [Custom Search API reference](https://www.volcengine.com/docs/87772/2272953?lang=zh).

The dedicated Agent Plan credential is stored in 1Password as
`TableAI API · Volcengine Agent Plan · Production` in the `TableAI Production`
vault. The credential value must never be copied into repository files.

## Ordinary Ark tool enablement and charging boundary

Volcengine's official migration guide says the current product is **联网内容插件** and lists three enablement paths: 服务组件库, 应用实验室, or an existing application's upgrade action. Enabling it changes an account-level paid service state and therefore requires human confirmation in the console. See [联网内容插件升级说明及操作指南](https://www.volcengine.com/docs/82379/1359519?lang=zh).

That guide documents a monthly allowance of 20,000 public-web resource uses, then CNY 4 per 1,000 uses, plus model-token charges; other content sources may have separate prices. Pricing can change, so the console contract remains authoritative.

## Separate SearchInfinity product

Volcengine also publishes **豆包搜索 / SearchInfinity**, a dedicated search API rather than an LLM tool. Its product page describes 1–50 result configuration, recency and domain filters, optional body/URL/summary fields, authority scores, ranking scores, timing, and multimodal results. It is preferable when an Agent needs raw, structured retrieval results before running a separate model. See [SearchInfinity product](https://www.volcengine.com/product/SearchInfinity) and its [API-key console](https://console.volcengine.com/search-infinity/api-key).

The current TableAI registry contains an ordinary Ark inference key. The Agent
Plan Harness path now has a separately managed Plan credential; it must not be
silently substituted for the ordinary Ark key. The live test above used the
documented Agent Plan key path, not an inferred cross-product credential.

## Agent operating rules

1. Read the Doubao provider status from `/api/admin/v1/api-providers/doubao-ark`; do not reveal the key.
2. Select a model from the last-good live model catalog. Never hard-code an obsolete model when the configured latest-model policy is active.
3. Treat ordinary inference health and Web Search health as separate checks.
4. A `ToolNotOpen` result on ordinary Ark means `ark_tool_unconfigured`, not
   `credential_error`; it does not describe the separate Agent Plan Harness.
5. Search probes must use `store:false`, a bounded output limit, a single query, and must retain only status, latency, model, citation count/hosts, timestamp, and sanitized error code.
6. Do not store the response text, prompt, API key, or complete provider response in D1 or logs.
7. Do not enable the paid plugin, accept revised terms, or change billing without an explicit human confirmation at action time.

## Recommended monitor extension

Add a separate `search` check to the `doubao-ark` connector. Run it at most daily after the plugin is enabled. Status mapping:

| Result | Search status |
| --- | --- |
| response contains a completed message and at least one URL citation | `healthy` |
| `ToolNotOpen` | `unconfigured` |
| HTTP 401/403 | `down` / credential authorization error |
| HTTP 429 or insufficient balance | `degraded` |
| transient network/5xx | preserve last-good result; apply the existing consecutive-failure policy |
