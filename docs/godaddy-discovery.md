# GoDaddy discovery connector

The GoDaddy connector is inventory-only. It lists domains and their DNS
records for the protected resource-operations workspace; it never creates,
updates, transfers, or deletes a domain or DNS record.

## Credential

Create a GoDaddy Personal Access Token (PAT) in the GoDaddy Developer portal.
Use the name `TableAI GoDaddy DNS discovery` and grant **only**:

```
domains.domain:read
```

Use a one-year expiry for the production scanner and rotate it before expiry
or immediately after any suspected exposure. Do not select the all-scopes
bundle: it includes write, transfer, contact, forwarding, and nameserver
permissions that this connector does not need.

Store the token as the concealed `godaddy-api-token` field in the **Personal /
TableAI Catalog** 1Password item. The optional `godaddy-account-id` field
defaults to `default`. Keep the exact 1Password references in a gitignored
`.env.1password` file based on `config/onepassword.refs.example`; do not put
the token in source control, shell profiles, tickets, or chat.

Before using the 1Password CLI, enable **Developer → Settings → Integrate with
1Password CLI** in the signed-in desktop application. This is required for
`op read` and `scripts/materialize-secrets.sh` to access the password manager.

## Runtime and verification

Materialize secret references only into a gitignored runtime file, then restart
the scanner service:

```bash
./scripts/materialize-secrets.sh .env.1password .env.docker
docker compose --env-file .env.docker up -d --force-recreate asset-sync
```

Run a targeted, read-only discovery pass when first configuring or rotating the
token:

```bash
ASSET_DISCOVERY_PROVIDERS=godaddy node scripts/discover-assets.mjs --upload
```

The admin API and resource UI must report GoDaddy as `configured` and show the
discovered `dns_domain` and `dns_record` assets. `unconfigured`, `partial`, or
`failed` means the prior successful data is retained and must not be treated as
an empty inventory.

## Rotation and incident response

1. Create a replacement read-only PAT in GoDaddy.
2. Replace the concealed 1Password field and materialize the runtime file.
3. Run the targeted scan and verify the configured state and asset count.
4. Revoke the previous PAT in GoDaddy only after verification succeeds.

The connector must remain read-only. Any future request to change domains or
DNS requires a separately scoped credential and an explicit implementation and
approval path.
