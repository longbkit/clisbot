# Generic API Channel Events And Actions Grill

Follow-up grill: [API Channel Naming And Result Polling](2026-05-30-api-channel-result-polling-grill.md)

## Context

The original version of this grill started from a "generic webhook channel"
mental model. That was too narrow once the integration became more than one-way
webhook ingestion.

The target product shape is now:

- third-party systems send JSON events to clisbot
- clisbot accepts the event quickly and processes it asynchronously
- clients can poll a result endpoint for status, progress, and final output
- provider HTTP delivery is optional and configured as named actions

Use `api` as the public channel concept. Use "webhook" only for an inbound
transport mode inside an API bot.

Architecture constraint: keep this as one static built-in channel. Provider
specific behavior belongs behind the channel integration boundary; agents still
own `sessionKey` continuity and native runner `sessionId` mapping.

## Recommendation

Build one built-in `api` channel for programmatic third-party integrations.
Each integration is an API bot under `bots.api.<botId>`.

First slice:

- `POST /api/bots/<botId>/events` for inbound provider events
- `GET /api/bots/<botId>/events/<eventId>/result` for status/progress/result
  polling
- inbound auth modes: HMAC over raw body, bearer token, or local-only `none`
- declarative filtering and mapping into shared message/surface/sender models
- result-store recording for progress and final output
- optional `actions.message.send` provider HTTP delivery
- text and Markdown rendering only
- dedupe by `botId + eventId`
- fast event acknowledgement before the agent run settles
- existing route, queue, steering, loop, and session machinery reused

Do not add a top-level `outbound` config. Do not create per-provider dynamic
channel ids. Do not add attachments, typing, edits, streaming, reactions,
stickers, polls, provider-native commands, or arbitrary custom actions in the
first slice.

## API Contract Summary

| Contract | Method and path | Auth | Success response | First slice |
| --- | --- | --- | --- | --- |
| Ingest event | `POST /api/bots/<botId>/events` | API bot auth | `202` with `eventId`, `status`, `resultUrl`, `expiresAt` | Yes |
| Poll result | `GET /api/bots/<botId>/events/<eventId>/result` | API bot auth or operator auth | `200` result record | Yes |
| Provider delivery | no public endpoint | action auth | provider-specific | Optional via `actions.message.send` |

HTTP response code rule:

- `POST /events` returns `202 Accepted` by default because clisbot accepted work
  for asynchronous processing.
- `GET /result` returns `200 OK` when the result record exists, regardless of
  whether processing is queued, processing, completed, or failed.
- Clients must read JSON `status` for processing state. HTTP `2xx` only means
  the API request itself succeeded.
- If a provider requires exact `200` webhook acknowledgement, support a per-bot
  compatibility override such as `ingress.successStatusCode: 200`; keep `202`
  as the canonical API default.

Result record fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `channel` | Yes | Always `api` for this channel. |
| `botId` | Yes | API bot that received the event. |
| `eventId` | Yes | Stable mapped provider event id. |
| `status` | Yes | Current processing lifecycle state. |
| `progress` | Yes | Ordered array of progress output items; empty when none. |
| `result` | Yes | Final output item or `null` before completion. |
| `error` | Yes | Sanitized error object or `null`. |
| `expiresAt` | Yes | Result retention expiry timestamp. |

State enums:

| Model | Values |
| --- | --- |
| `status` | `received`, `filtered`, `duplicate`, `queued`, `steered`, `processing`, `completed`, `failed`, `expired` |
| `kind` | `progress`, `final` |
| `render` | `text`, `markdown` |

Output item fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `sequence` | Yes | Monotonic number within one event result record. |
| `kind` | Yes | `progress` or `final` in the first slice. |
| `text` | Yes | Sanitized user-visible output. |
| `render` | No | `text` or `markdown`; default `text`. |
| `createdAt` | Yes | ISO-8601 creation timestamp. |

Example accepted response:

```json
{
  "channel": "api",
  "botId": "acme",
  "eventId": "ticket:123",
  "status": "queued",
  "resultUrl": "/api/bots/acme/events/ticket%3A123/result",
  "expiresAt": "2026-05-30T09:30:00.000Z"
}
```

Example result response:

```json
{
  "channel": "api",
  "botId": "acme",
  "eventId": "ticket:123",
  "status": "processing",
  "progress": [
    {
      "sequence": 1,
      "kind": "progress",
      "text": "Checking ticket context.",
      "render": "text",
      "createdAt": "2026-05-30T03:30:02.000Z"
    }
  ],
  "result": null,
  "error": null,
  "expiresAt": "2026-05-30T09:30:00.000Z"
}
```

## North-Star Invariants

Use these invariants to review every API bot mapping before coding.

| North star | Required invariant | Failure if wrong |
| --- | --- | --- |
| Principal | A sender principal is a user auth identity in canonical `api:<botId>:<provider-user-id>` form. | Roles, pairing, allowlists, and owner actions match the wrong person or fail silently. |
| Bot namespace | Provider ids are bot-scoped before becoming principals, surfaces, or dedupe keys. | `user-123` from two unrelated providers becomes one auth identity. |
| Surface | `surfaceKind` plus `surfaceId` names the conversation or work-item boundary, not the sender. | Group messages split per sender, DMs merge incorrectly, or replies go to the wrong place. |
| Reply target | `reply.targetId` and `reply.params` are provider-addressing metadata for actions only. | Prompt context leaks delivery internals or provider sends go to the wrong address. |
| Session | `sessionKey` is derived from the mapped surface, agent, and API bot, then privately maps to runner `sessionId`. | Tool workspace continuity is lost or unrelated conversations share context. |
| Routing | Route matching must use the same canonical kind and id that session routing uses. | A configured surface appears correct but never admits the event. |
| Dedupe | Dedupe key is bot-scoped and based on a stable provider event id. | Retries duplicate prompts, or two API bots suppress each other's events. |
| Secrecy | Auth secrets stay as env refs and never enter connector metadata, logs, result records, or prompt context. | Config, transcripts, or result polling leak provider credentials. |

Examples: Telegram topics need chat id plus topic id, Slack threads need channel
id plus thread timestamp, Chatwoot reply delivery needs account id plus
conversation id, and Jira issue actions may address issue key plus comment id.
Prompt context should include enough canonical surface information for the AI to
address commands truthfully, but not provider secrets or low-level delivery
params by default.

## Config Shape

Use current `clisbot.json` style under `bots.api.<botId>`.

```json
{
  "bots": {
    "api": {
      "chatwoot": {
        "enabled": true,
        "ingress": {
          "successStatusCode": 202,
          "auth": {
            "mode": "hmac",
            "secretEnv": "CHATWOOT_WEBHOOK_HMAC_SECRET",
            "signatureHeader": "x-chatwoot-webhook-signature",
            "timestampHeader": "x-chatwoot-webhook-timestamp",
            "payload": "timestamp.rawBody",
            "toleranceSecondsEnv": "CHATWOOT_WEBHOOK_HMAC_TOLERANCE_SECONDS",
            "defaultToleranceSeconds": 300
          },
          "filter": {
            "all": [
              { "path": "$.event", "equals": "message_created" },
              { "path": "$.message_type", "equals": "incoming" },
              { "path": "$.private", "equals": false },
              { "path": "$.sender.type", "notEquals": "agent_bot" }
            ]
          },
          "map": {
            "eventId": "message_created:{{$.id}}",
            "surfaceKind": "dm",
            "surfaceId": "{{$.account.id}}:{{$.conversation.id}}",
            "senderId": "$.sender.id",
            "senderDisplayName": "$.sender.name",
            "text": "$.content",
            "replyTargetId": "$.conversation.id",
            "replyParams": { "accountId": "$.account.id" }
          }
        },
        "actions": {
          "message.send": {
            "method": "POST",
            "url": "{{env.CHATWOOT_BASE_URL}}/api/v1/accounts/{{reply.params.accountId}}/conversations/{{reply.targetId}}/messages",
            "headers": { "api_access_token": "{{env.CHATWOOT_API_ACCESS_TOKEN}}" },
            "body": {
              "content": "{{message.text}}",
              "message_type": "outgoing",
              "private": false
            },
            "rendering": { "native": "markdown" },
            "retry": { "mode": "none" }
          }
        }
      }
    }
  }
}
```

First-slice action rules:

- accepted action names are closed; initially only `message.send`
- undeclared action names are config errors
- `message send --channel api --bot <botId> --progress` always records progress
  in the result store
- `message send --channel api --bot <botId> --final` always records the final
  result in the result store
- if `actions.message.send` exists, also attempt provider delivery
- if `actions.message.send` is absent, no provider delivery is attempted and
  local result recording still succeeds

## Mapping And Filtering

Use a tiny owned declarative DSL, not arbitrary code execution.

Recommended lineage:

- field reads follow a JSONPath-like subset because `$`, dot paths, bracket
  keys, and array indexes are familiar across webhook tools
- interpolation follows Mustache-style `{{...}}` templates because it is common
  in API gateway and automation products
- filters follow a small query-DSL style with `all`, `any`, and `not`

Supported field path subset:

| Case | Example | Meaning |
| --- | --- | --- |
| Root object | `$` | Whole payload. |
| Dot property | `$.conversation.id` | Nested object property. |
| Bracket property | `$["custom-fields"]["issue key"]` | Property names with spaces, dashes, or reserved characters. |
| Array index | `$.attachments[0].url` | One known element. |
| Current item | `@.url` | Current item inside array projection. |

Deliberately exclude first slice:

- JSONPath filters such as `$..items[?(@.x > 1)]`
- recursive descent
- arbitrary JS expressions
- jq-like transforms
- regex capture groups in paths

Supported filters:

```json
{
  "all": [
    { "path": "$.event", "equals": "message_created" },
    { "path": "$.message_type", "in": ["incoming", "comment_created"] },
    { "path": "$.private", "equals": false },
    { "path": "$.sender.type", "notEquals": "agent_bot" },
    { "path": "$.content", "exists": true }
  ]
}
```

Additional filter shapes: `any`, `not`, `exists`, `in`, and `anyIn`.

Rules:

- missing path is not the same as JSON `null`
- equality is strict by default
- type coercion should be explicit if ever added
- filtered events should create terminal result records with `status:
  "filtered"` after auth and parse succeed

Array mapping should be explicit:

```json
{
  "attachments": {
    "from": "$.attachments",
    "map": {
      "id": "@.id",
      "url": "@.data_url",
      "contentType": "@.file_type"
    }
  }
}
```

Attachments remain out of first-slice processing, but documenting the mapping
shape now prevents a future incompatible mapper.

## Inbound Auth

Support all three modes:

| Mode | Use case | Security notes |
| --- | --- | --- |
| `hmac` | Server-to-server webhooks where the provider can sign raw bodies. | Strongest first-slice option. Verifies body integrity, sender possession of shared secret, and replay window when timestamp is included. |
| `bearer` | Providers that can send a static token but cannot sign payloads. | Standard and easy. Relies on TLS for transport integrity and bearer secrecy. Does not prove the body was signed by the sender after leaving TLS termination. |
| `none` | Local-only tests and development. | Must be rejected unless bound to loopback/local dev configuration. Never allow for public listen addresses. |

HMAC requirements:

- verify against the exact raw request body before JSON parsing
- support timestamped signing payload `<timestamp>.<raw_body>`
- use constant-time comparison
- reject missing, invalid, malformed, and stale signatures with `401`
- do not create result records for auth failures
- default replay tolerance: 300 seconds
- keep the secret in an env var, never inline config

TLS is still required. HMAC does not replace HTTPS. TLS protects the request on
the wire; HMAC protects clisbot from unauthenticated body forgery, body changes
after TLS termination, accidental exposure through proxies, and replay outside
the configured tolerance.

If HMAC is implemented in a browser or untrusted client, the secret can leak.
Use bearer or a server-side signing proxy for untrusted clients.

## Result Store, Queue, And Steering

Every authenticated parsed event should have an event-scoped result record.
Auth failures should not.

Status semantics:

| Status | Meaning | Terminal |
| --- | --- | --- |
| `received` | Auth, parse, and initial validation succeeded. | No |
| `filtered` | Event was intentionally ignored by configured filters. | Yes |
| `duplicate` | Event dedupe key was already seen. | Yes |
| `queued` | Event is accepted but waiting behind the session queue. | No |
| `steered` | Event was accepted as input into an already active run. | No |
| `processing` | Event is currently being handled by an agent run or linked run. | No |
| `completed` | Final result is available. | Yes |
| `failed` | Processing failed; inspect sanitized `error`. | Yes |
| `expired` | Result record aged out before the client fetched it. | Yes |

Do not add a top-level `admission` field. `status` is the lifecycle state. If
queue/debug context is needed later, expose optional metadata such as
`queue.position`, `queue.enteredAt`, `queue.startedAt`, or `run.id`.

If event B arrives while event A is processing on the same surface:

- B gets its own result record
- B may be `queued`, `steered`, or `duplicate`
- if B is steered into A's active run, B should still eventually resolve to a
  terminal result record, possibly linked to the same internal run
- A's result record must not be overwritten by B

Programmatic API clients should request intentional queue or steer behavior via
a mapped trusted `runMode: "queue" | "steer"` field. Chat-like providers can
still use the existing `/queue`, `\q`, `/steer`, and `\s` text prefixes for
human-entered commands, but API integrations should not smuggle control intent
inside user-visible text.

Retention recommendation:

- default result retention: 6 hours
- persist records across runtime restart until expiry
- bound progress entries per event, for example latest 20 entries
- bound stored text size and truncate with an explicit marker

## Rendering And Capabilities

First-slice rendering:

- `text`
- `markdown`

`--render native` must not pretend a provider supports rich rendering. For an
API bot, `native` means the bot's configured native render mode, constrained to
the action capability. If no provider delivery action exists, result-store
outputs should still record the requested render when it is supported.

First-slice capabilities:

```json
{
  "capabilities": {
    "result.poll": true,
    "message.send": true,
    "message.progress": true,
    "message.edit": false,
    "message.stream.chunk": false,
    "reaction.add": false
  }
}
```

Interpretation:

- `result.poll`: clients can query status/progress/result
- `message.send`: clisbot can record final visible messages and optionally
  deliver them through `actions.message.send`
- `message.progress`: clisbot can record progress messages and optionally
  deliver them through `actions.message.send`
- `message.edit`, `message.stream.chunk`, and `reaction.add`: future provider
  capabilities, not first-slice behavior

Future media delivery should be a capability matrix, not one boolean. Declare
generic file, image, video, audio, and voice separately; for each kind declare
whether the provider accepts local upload, remote URL, multiple files, captions,
and provider-native grouping. Unsupported media should fail validation before
provider dispatch unless the API bot explicitly declares link-only text
delivery.

Do not add provider delivery status to the first result shape. If added later,
it should cover progress and final outputs consistently, likely per output item
or per action name. Avoid `delivery.channel: "state"` and avoid
`not_configured`; absence of an action already means local result polling only.

## Chatwoot Compatibility

Chatwoot should integrate as an API bot, not as a channel named `webhook`.

Recommended endpoint: `POST /api/bots/chatwoot/events`.

Expected Chatwoot HMAC contract:

- `X-Chatwoot-Webhook-Timestamp: <unix timestamp>`
- `X-Chatwoot-Webhook-Signature: sha256=<hex>`
- signing payload: `<timestamp>.<raw_body>`
- env: `CHATWOOT_WEBHOOK_HMAC_SECRET`
- tolerance env: `CHATWOOT_WEBHOOK_HMAC_TOLERANCE_SECONDS`
- default tolerance: 300 seconds

Mapping notes:

- `eventId`: `message_created:<message id>`
- `surfaceId`: `<account id>:<conversation id>`
- `reply.targetId`: Chatwoot conversation id
- `reply.params.accountId`: Chatwoot account id for the reply API only
- ignore private messages and agent-bot echoes by default

Chatwoot reply API should be configured as `actions.message.send`.

## Jira Compatibility Sketch

Jira is a useful proof that the API channel is not chat-only. A first event can
map `surfaceKind` to `issue`, `surfaceId` to `{{$.issue.key}}`, and `eventId` to
`{{$.webhookEvent}}:{{$.issue.id}}:{{$.timestamp}}`. Later actions may include
description update, add comment, update comment, or reactions, but the first
slice should not accept those names yet.

## Considered And Superseded

Earlier direction: public channel id `webhook` with endpoint
`/webhook/bots/<botId>`.

Decision: superseded by `api` channel and `/api/bots/<botId>/events`.

Reason: "webhook" is a one-way ingress mechanism, while the actual product now
includes result polling, local progress/final state, optional provider delivery,
and future actions. Keeping `webhook` as the channel name would teach the wrong
mental model and make later result/status APIs feel bolted on.

Earlier direction: top-level `outbound` config for provider HTTP replies.

Decision: superseded by `actions.message.send`.

Reason: a top-level `outbound` block is short for the first send-message case
but creates a second schema path once progress, edit, streaming, reactions, or
provider mutations are added. `actions.message.send` is slightly more verbose,
but it gives one canonical extension model, one validation path, one status
surface, and no migration from `outbound` to actions later.

Earlier direction: dynamic connector/plugin ids for each provider.

Decision: keep one static built-in `api` channel and configure API bots under
`bots.api.<botId>`.

Reason: this fits the current built-in channel inventory and avoids a runtime
plugin loader before provider semantics prove they need native-channel depth.

## Validation Bundle

Minimum validation before implementation is called ready:

- config schema accepts `bots.api.<botId>.ingress` and optional
  `bots.api.<botId>.actions.message.send`
- `POST /api/bots/<botId>/events` rejects bad auth before parsing JSON
- HMAC verifies exact raw body and stale timestamp failures return `401`
- bearer auth works for providers without signing support
- local-only `none` is rejected on non-loopback public listeners
- filters can return terminal `filtered` result records
- duplicate event ids return terminal `duplicate` result records
- mapped principals are bot-scoped as `api:<botId>:<senderId>`
- mapped surfaces stay separate from principals and reply targets
- `reply.params` never appears in prompt context by default
- `message send --channel api --bot <botId> --progress` records progress
- `message send --channel api --bot <botId> --final` records final result
- absence of `actions.message.send` does not fail local result recording
- presence of `actions.message.send` attempts provider delivery after recording
- provider delivery failure does not erase stored progress or final result
- result polling returns `status`, `progress`, `result`, `error`, and
  `expiresAt`
- text and markdown are the only first-slice render modes
- docs and examples use JSON config, `api` channel naming, API event endpoints,
  and actions directly
