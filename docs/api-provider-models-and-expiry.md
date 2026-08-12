# API provider model discovery and expiry capabilities

Research date: 2026-08-12 (Asia/Shanghai)

This note records only capabilities documented by the providers' current official documentation. “Not documented” means no supported endpoint was found in the reviewed first-party API reference; it must not be treated as proof that an internal or future endpoint cannot exist.

## Decision table

| Connector | Official model-list endpoint | Authentication | Can query API-key expiry? | Can query subscription/quota expiry? |
| --- | --- | --- | --- | --- |
| Volcengine Ark / Doubao | Ark management API `ListFoundationModels`, `POST https://open.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01` | Yes: Volcengine HMAC AK/SK, not the inference-only Ark API key | Not documented for a previously issued long-lived Ark key. `GetApiKey` can issue a temporary key with caller-selected `DurationSeconds`, but is not a lookup endpoint. | No supported plan-expiry endpoint found for the inference key. Billing/plan state must remain `unknown` unless a separately authorized billing connector is added. |
| MiniMax API (pay as you go) | `GET https://api.minimaxi.com/v1/models` | Yes: `Authorization: Bearer <API key>` | Not documented | No documented expiry endpoint for the pay-as-you-go key or cash balance. Error `1008` signals insufficient balance, but is not an expiry value. |
| MiniMax Token/Coding Plan | Same `GET https://api.minimaxi.com/v1/models` using the Token Plan key; quota endpoint is `GET https://www.minimaxi.com/v1/token_plan/remains` | Yes: Token Plan Bearer key | Key expiry is not documented separately | **Quota can be queried**, but the official FAQ does not publish a stable response schema or a guaranteed plan-end field. Do not infer a subscription end date from rolling quota reset windows. |
| OpenAI | `GET https://api.openai.com/v1/models` | Yes: `Authorization: Bearer $OPENAI_API_KEY` | **Yes, with a separate organization Admin API key**: `GET /v1/organization/admin_api_keys` returns `expires_at`. A normal project key cannot inspect itself through this admin endpoint. | No supported credit-balance or subscription-expiry endpoint found in the public API. Organization usage/cost APIs are spend history, not balance expiry. |
| Perplexity | `GET https://api.perplexity.ai/v1/models` | **No authentication required** for this endpoint | Not documented; key values are one-time reveal and can be revoked/rotated | Credit balance is documented as a console feature; no supported credit-expiry API was found. |
| Moonshot / Kimi (China) | `GET https://api.moonshot.cn/v1/models` | Yes: `Authorization: Bearer $MOONSHOT_API_KEY` | Not documented | Balance can be queried with `GET /v1/users/me/balance`, but the response has no expiry field. Kimi states cash balance does not expire. |
| Gemini API | `GET https://generativelanguage.googleapis.com/v1beta/models` | Yes: Gemini API key (`?key=...` or SDK/header equivalent) | Standard API keys have no documented expiry field. Google API Keys API exposes lifecycle metadata but no `expireTime`; Gemini Live ephemeral tokens are separate and do have `expireTime`. | Prepay credits expire one year after purchase, but AI Studio/Cloud Billing is the documented visibility surface; no Gemini-key-authenticated balance-expiry endpoint was found. |

## Documented response fields

### Volcengine Ark / Doubao

`ListFoundationModels` returns pagination fields `TotalCount`, `PageNumber`, `PageSize` and `Items[]`. It supports filters and pagination up to 100 items per page. It is a management-plane API signed with Volcengine AK/SK; do not send an Ark inference API key to it. The separately documented `GetApiKey` operation creates a scoped temporary API key and accepts `DurationSeconds`, so its expiry is known at issuance rather than discovered later. [ListFoundationModels API Explorer](https://api.volcengine.com/api-explorer/?action=ListFoundationModels&groupName=%E7%AE%A1%E7%90%86%E5%9F%BA%E7%A1%80%E6%A8%A1%E5%9E%8B&serviceCode=ark&version=2024-01-01), [GetApiKey API Explorer](https://api.volcengine.com/api-explorer/?action=GetApiKey&groupName=%E5%85%B6%E5%AE%83&serviceCode=ark&version=2024-01-01), [Ark API-key guidance](https://www.volcengine.com/docs/6257/64983?lang=en)

### MiniMax API and Token Plan

`GET /v1/models` returns `object` and `data[]`; each documented model object has `id`, `object`, `created`, and `owned_by`. The endpoint requires Bearer authentication. [MiniMax list models](https://platform.minimaxi.com/docs/api-reference/models/openai/list-models)

Token Plan usage is queryable through `GET https://www.minimaxi.com/v1/token_plan/remains`. The current official FAQ documents the endpoint and Bearer authentication, plus rolling/fixed quota behavior, but does not document the JSON response fields. The monitor may therefore record probe success/failure and a redacted raw-schema version, but must not publish assumed field names. [MiniMax Token Plan FAQ](https://platform.minimaxi.com/docs/token-plan/faq), [Token Plan overview](https://platform.minimaxi.com/docs/token-plan/intro)

### OpenAI

`GET /v1/models` returns `object` and `data[]`, with model fields `id`, `object`, `created`, and `owned_by`, and requires a Bearer API key. [OpenAI Models API](https://platform.openai.com/docs/api-reference/models/list)

The organization admin-key list endpoint requires `OPENAI_ADMIN_KEY` and returns key fields `object`, `id`, `name`, `redacted_value`, `created_at`, `expires_at`, `last_used_at`, and `owner`, plus list pagination fields `first_id`, `last_id`, and `has_more`. Creation accepts `expires_in_seconds`; omission creates a non-expiring admin key. This endpoint is a privileged, optional connector and must never be called with or substituted for the normal inference key. [OpenAI organization Admin API keys](https://platform.openai.com/docs/api-reference/admin-api-keys/list)

### Perplexity

`GET /v1/models` is explicitly documented as unauthenticated. It returns `object: "list"` and `data[]`; model objects contain `id`, `object`, `created`, and `owned_by`. The list currently targets models usable by the Agent API. [Perplexity List Models](https://docs.perplexity.ai/api-reference/models-get), [Perplexity changelog](https://docs.perplexity.ai/docs/resources/changelog)

Perplexity documents credit balance and key management in its API Portal. Keys can be revoked and rotated, and full values are shown only on creation; the official management guide does not document an expiry field or credit-balance expiry endpoint. [API Groups and Billing](https://docs.perplexity.ai/docs/getting-started/api-groups), [API Key Management](https://docs.perplexity.ai/docs/admin/api-key-management)

### Moonshot / Kimi

`GET /v1/models` requires a Bearer key and returns `object` plus `data[]`. Documented model fields are `id`, `object`, `created`, `owned_by`, `context_length`, `supports_image_in`, `supports_video_in`, and `supports_reasoning`. [Kimi list models](https://platform.kimi.com/docs/api/list-models)

`GET /v1/users/me/balance` returns `code`, `status`, `scode`, and `data.{available_balance,voucher_balance,cash_balance}`. It does not return an expiry date. Kimi's payment terms state that cash balance has no validity period; voucher terms may differ and are not exposed by this response. [Kimi balance API](https://platform.kimi.com/docs/api/balance), [Kimi payment terms](https://platform.kimi.com/docs/agreement/payment)

### Gemini

`GET /v1beta/models` returns `models[]` and optional `nextPageToken`. Documented model fields include `name`, `baseModelId`, `version`, `displayName`, `description`, `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods[]`, `thinking`, `temperature`, `maxTemperature`, `topP`, and `topK`. [Gemini Models API](https://ai.google.dev/api/models)

The Google API Keys API can retrieve standard key metadata including `name`, `uid`, `displayName`, `createTime`, `updateTime`, `deleteTime`, `restrictions`, and `etag`; it has no standard-key expiry field. Gemini Live ephemeral tokens are a different credential type and expose `expireTime`/`newSessionExpireTime`. Gemini prepaid credits expire after one year, with usage/balance viewed in AI Studio/Cloud Billing rather than through the model API key. [Google API Keys resource](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys), [Gemini ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens), [Gemini billing](https://ai.google.dev/gemini-api/docs/billing)

## Recommended normalized interface

Do not overload “API expiry.” Store the following independently:

```ts
type ProviderModelSnapshot = {
  status: "ok" | "unauthorized" | "unsupported" | "error";
  source: "provider_api" | "management_api" | "static_fallback";
  authMode: "none" | "inference_key" | "admin_key" | "cloud_hmac";
  models: Array<{
    id: string;
    displayName?: string;
    owner?: string;
    createdAt?: string;
    capabilities?: string[];
    inputTokenLimit?: number;
    outputTokenLimit?: number;
  }>;
  fetchedAt: string;
};

type ProviderValidity = {
  credentialExpiresAt: string | null;
  credentialExpirySource: "provider_api" | "issued_at_plus_ttl" | "manual" | "unknown";
  subscriptionExpiresAt: string | null;
  subscriptionExpirySource: "provider_api" | "billing_api" | "manual" | "unknown";
  quotaResetsAt: string | null;
  quotaRemaining?: number;
  balance?: { amount: number; currency?: string };
};
```

Implementation rules:

1. Pull model lists daily and retain the last successful snapshot plus a model-set hash; do not delete the previous list on a partial failure.
2. Mark the current preferred model separately from provider availability. “Latest” aliases can move and must not be sorted from model IDs alone.
3. Use `unknown`, never a guessed date, when the provider does not expose expiry.
4. Keep privileged metadata connectors opt-in: Volcengine model management needs AK/SK; OpenAI key expiry needs an Admin API key; Google key metadata needs OAuth/IAM. Inference containers should not receive these broader credentials.
5. Treat quota reset, subscription end, credit expiry, and credential expiry as four different clocks.
6. For MiniMax `token_plan/remains`, version the captured response schema and expose only allowlisted derived fields after observing a documented/stable payload; never store the raw key or response body in logs.
7. For Perplexity, refresh the unauthenticated model catalog even when the inference key is unhealthy; this cleanly distinguishes “provider model discovery works” from “our credential works.”
