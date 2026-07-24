---
name: apuch-tencent-sms
description: Operate and validate APUCH Tencent Cloud SMS through runtime-only 1Password configuration without exposing secrets.
---

# APUCH Tencent SMS

Use this skill when an agent needs to inspect SMS readiness, configure an
application, diagnose Tencent SMS failures, rotate the dedicated CAM key, or
send an explicitly authorized test or OTP message.

## Safety boundary

- Treat every Tencent secret, SMS application identifier, sign identifier,
  template identifier, phone number, and message parameter as sensitive.
- Read configuration from 1Password only at runtime. Never copy a secret into
  this skill, source control, a chat response, logs, screenshots, shell history,
  or an agent memory file.
- Prefer `op run` with a temporary environment file made only of `op://`
  references. If a command requires `op read`, capture the value in the same
  process and do not print it.
- Never use `op item get --reveal`, `set -x`, `env`, or commands that dump the
  process environment.
- Use a dedicated least-privilege CAM identity for SMS. Do not use owner or
  administrator credentials.
- Sending a real SMS is an external side effect. Require an explicit recipient
  and explicit authorization for each test or production send.
- Redact phone numbers in reports, keeping only the country code and last four
  digits.

## Runtime configuration contract

Resolve the approved 1Password item supplied by the caller or deployment
configuration. The item must provide references for these logical values:

- Tencent Secret ID
- Tencent Secret Key
- SMS SDK App ID
- approved SMS sign name or sign ID
- approved template ID
- Tencent region when required by the SDK

Optional metadata may include qualification status, template purpose,
application name, rotation owner, and last validation time. Metadata may be
reported only when it is not secret and does not expose private infrastructure.

If any required field is missing, stop and report the missing field label. Do
not guess identifiers or substitute values from another Tencent application.

## Readiness inspection

1. Confirm the 1Password CLI is signed in without revealing item values.
2. Confirm the configured CAM identity is dedicated to SMS and has only the
   required Tencent SMS API permissions.
3. Query Tencent SMS for the configured application's sign and template status.
4. Confirm both are approved and active before attempting a send.
5. Confirm the requested template parameters match the approved template's
   parameter count and order.
6. Return a redacted readiness result: authentication, sign status, template
   status, application match, and whether sending is permitted.

Read-only readiness checks do not authorize sending.

## Application configuration

Map the runtime values into the application's existing SMS provider interface.
Do not rename established environment variables unless the application change
explicitly requires it. Validate environment shape before restart or rollout.

For local commands, prefer this pattern:

```sh
op run --env-file path/to/refs.env -- command-that-does-not-print-secrets
```

The referenced file must contain only `op://` references, never resolved
values. Production secret injection should use the platform's encrypted secret
mechanism while keeping 1Password as the operator source of truth.

## Authorized test send

Before sending, record these non-secret inputs:

- the caller's authorization
- the redacted destination
- the approved template purpose
- the expected parameter count
- whether this is a test or production OTP

Send exactly one message unless the caller authorizes a larger bounded test.
Capture Tencent's request ID and result code, but never capture credentials,
full phone numbers, or OTP values. A Tencent request ID means the API accepted
the request; delivery status must be checked separately when required.

## Diagnosis

Classify failures before changing configuration:

- authentication or CAM denial
- application, sign, or template mismatch
- template parameter mismatch
- recipient or regional restriction
- rate limit or risk-control rejection
- account balance, qualification, or compliance state
- provider timeout or network failure
- application-side configuration or retry bug

Use Tencent's request ID and official error code to guide the diagnosis. Prefer
the smallest corrective action. Do not rotate credentials for a template or
parameter error.

## Credential rotation

Rotate only the dedicated SMS CAM key and only with explicit authorization.
Create the replacement key, update the approved 1Password item, validate a
read-only Tencent call, deploy through the existing secret-injection mechanism,
perform one authorized smoke test, and then disable the old key. Delete the old
key only after successful verification and the agreed rollback window.

## Required completion report

Report:

- readiness outcome
- application/sign/template consistency
- whether a send occurred
- redacted recipient and Tencent request ID when applicable
- deployment or rotation outcome
- remaining blocker and owner

Never include secret values, full phone numbers, OTP values, private server
addresses, internal filesystem paths, or raw environment output.
