# Admin Agent guide: API credentials and model discovery

This guide is the operating contract for an authorized administrator Agent using TableAI's provider credentials. It defines names, storage boundaries, safe invocation, validation, rotation, and model selection. It never grants access by itself.

## Canonical 1Password layout

All canonical items live in the dedicated **`TableAI Production`** vault so an administrator Agent can be granted that vault without receiving access to the entire Personal vault. Each independently rotatable credential is one **API Credential** item. Do not put API keys in Login items and do not combine login passwords, cloud AK/SK pairs, inference keys, or subscription keys in one field group.

Canonical title format:

```text
TableAI API · <Provider or Plan> · <Environment>
```

Current production items:

| Provider | Canonical item | Credential field | Runtime variable |
| --- | --- | --- | --- |
| Doubao / Volcengine Ark | `TableAI API · Doubao Ark · Production` | `credential` | `DOUBAO_API_KEY` |
| MiniMax pay-as-you-go | `TableAI API · MiniMax · Production` | `credential` | `MINIMAX_API_KEY` |
| MiniMax Coding Plan | `TableAI API · MiniMax Coding Plan · Production` | `credential` | `MINIMAX_SUBSCRIPTION_KEY` |
| OpenAI | `TableAI API · OpenAI · Production` | `credential` | `OPENAI_API_KEY` |
| Perplexity | `TableAI API · Perplexity · Production` | `credential` | `PERPLEXITY_API_KEY` |
| Moonshot / Kimi | `TableAI API · Moonshot Kimi · Production` | `credential` | `MOONSHOT_API_KEY` |
| Gemini | `TableAI API · Gemini · Production` | `credential` | `GEMINI_API_KEY` |

Every configured item must have these metadata fields:

- `provider`, `environment`, `purpose`
- `model_policy`: `latest compatible model from live provider model list`
- `rotation_status`: `active`, `needs-rotation`, or `revoked`
- `credential`: concealed and never printed
- console and documentation URLs

The machine-readable source of truth is [the API credential registry](../config/api-credentials.registry.json). Personal item IDs and exact field references belong only in the gitignored `.env.1password` file.

## Models are operational data, not secrets

Do not store a copied provider model list in 1Password. The monitor pulls the authenticated `/models` endpoint, stores a sanitized last-good catalog in the management database, and selects the newest compatible text model according to provider-specific rules. A model override is an explicit non-secret deployment setting, not a credential field.

Use the protected interfaces instead of reading credentials:

```text
GET /api/admin/v1/api-providers
GET /api/admin/v1/api-providers/:id
MCP resource: ops://api-providers/snapshot
```

These return status, model IDs, counts, latency, validity metadata, and official links without returning key material.

## Safe Agent workflow

Prerequisites:

1. The human operator has granted the Agent administrator scope for this task.
2. 1Password desktop CLI integration is signed in, the operator approves access, and the Agent principal is restricted to the `TableAI Production` vault.
3. The Agent uses exact item/field references. It must never search titles and choose among duplicates.

Validate item structure without revealing values:

```bash
npm run api-credentials:validate
```

Materialize only the monitor's required keys into a mode-`0600` gitignored file:

```bash
cp config/onepassword.refs.example .env.1password
# Replace title references with exact vault/item/field IDs after resolving them once.
./scripts/materialize-api-monitor-secrets.sh .env.api-monitor
```

For normal inspection and model discovery, an Agent must call the protected admin API or MCP resource. It must not run `op item get --reveal`, print environment variables, place key values in shell arguments, save provider response bodies, or copy `.env.api-monitor` into chat, Git, logs, D1, or browser storage.

## Key rotation

1. Create the replacement key in the provider console with the narrowest usable scope.
2. Update only the canonical item's concealed `credential` field; keep its title and field ID stable.
3. Set `rotation_status=active` and record an expiry date only when supplied by the provider or human operator.
4. Run registry validation and materialize a fresh runtime file.
5. Deploy the monitor and run one standard probe plus one explicitly approved minimal inference probe.
6. Confirm the provider is healthy and the model catalog is non-empty.
7. Revoke the old provider key. Never delete the legacy 1Password item until the new key has passed production verification.

Perplexity currently returns `401` and its canonical item must remain `needs-rotation` until a replacement passes. Gemini remains optional/unconfigured until a unique API key exists.

## Validity semantics

Credential expiry, subscription end, quota reset, and credit balance are different clocks. Store or report `unknown` instead of inferring dates. OpenAI key expiry requires a separate organization Admin API key; normal project keys cannot query it. MiniMax Coding Plan quota data must not be treated as the subscription end date. See [provider model and expiry capabilities](./api-provider-models-and-expiry.md).

## Legacy cleanup policy

Existing mixed Login/API items are retained during migration. Mark them with a `legacy-api-source` tag only after canonical items exist. Archive them after 30 days when:

- all exact references point to canonical items;
- two scheduled probe cycles and one daily inference probe have passed;
- no other repository or deployment references the legacy item ID;
- the provider's old key has been revoked or positively identified as the same active credential.

Deletion is not part of the automatic migration and always requires explicit human confirmation.
