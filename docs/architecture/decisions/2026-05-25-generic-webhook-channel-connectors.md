# Generic API Channel Events And Actions

## Status

Accepted, amended 2026-05-30

## Date

2026-05-25

## Context

`clisbot` needs a low-effort integration path for third-party systems that can
send HTTP events and may accept HTTP message/action requests. The first target
is Chatwoot agent-bot webhook ingress, but the product shape is broader than
webhook-only:

- providers can push JSON events into clisbot
- clisbot processes those events asynchronously
- clients can poll event status, progress, and final result
- provider HTTP delivery can be configured, but can also be absent by design

Current channel architecture is intentionally static:

- channels are built-in product code, not runtime-loaded plugins
- install-time channel contracts live in the static channel installation
  inventory
- runtime behavior is exposed through the static `ChannelPlugin` registry
- provider-specific commands belong under `channel-native` or explicit action
  names

Adding a native channel per simple provider would repeat routing, config,
credential, result, and operator work. Adding a dynamic plugin loader first
would contradict the current single-package architecture and expand the blast
radius before the product need is proven.

## Decision

Represent programmatic third-party integrations as API bot configs under one
built-in `api` channel.

The built-in channel owns:

- HTTP event ingress
- API bot auth verification
- event filtering
- payload mapping
- canonical message, sender, and surface projection
- bounded event result storage
- progress and final output recording
- optional provider HTTP actions
- channel runtime plugin and installation contracts

Each integration is identified by bot/account id under `bots.api.<botId>`.
Public docs should prefer "API bot" or "API channel". Use "webhook" only for an
inbound transport mode, not as the channel id.

Shared command and config surfaces stay channel-shaped:

```bash
clisbot message send --channel api --bot chatwoot --target dm:3:970
```

The default event endpoint is:

```text
POST /api/bots/<botId>/events
```

The default result endpoint is:

```text
GET /api/bots/<botId>/events/<url-encoded-eventId>/result
```

The run-control endpoints are:

```text
POST /api/bots/<botId>/events/<url-encoded-eventId>/stop
POST /api/bots/<botId>/surfaces/<url-encoded-surfaceId>/stop
```

Do not add a `connectors` alias yet. Do not add `channels.api.bots` or
`channels.webhook.bots`; use the existing JSON bot config hierarchy.

Example config shape:

```json
{
  "bots": {
    "api": {
      "chatwoot": {
        "ingress": {
          "auth": {
            "mode": "hmac",
            "secretEnv": "CHATWOOT_WEBHOOK_HMAC_SECRET",
            "timestampHeader": "X-Chatwoot-Webhook-Timestamp",
            "signatureHeader": "X-Chatwoot-Webhook-Signature",
            "signaturePrefix": "sha256=",
            "signingBase": "{{timestamp}}.{{rawBody}}"
          },
          "map": {
            "eventId": "message_created:{{$.id}}",
            "surfaceKind": "dm",
            "surfaceId": "{{$.account.id}}:{{$.conversation.id}}",
            "senderId": "$.sender.id",
            "text": "$.content",
            "replyTargetId": "$.conversation.id",
            "replyParams": {
              "accountId": "$.account.id"
            }
          }
        },
        "actions": {
          "message.send": {
            "method": "POST",
            "url": "{{env.CHATWOOT_BASE_URL}}/api/v1/accounts/{{reply.params.accountId}}/conversations/{{reply.targetId}}/messages",
            "headers": {
              "api_access_token": "{{env.CHATWOOT_API_ACCESS_TOKEN}}"
            },
            "body": {
              "content": "{{message.text}}",
              "message_type": "outgoing"
            }
          }
        }
      }
    }
  }
}
```

## Result Store

Every authenticated parsed event should get an event-scoped result record.
Auth failures do not create records.

Implementation thinking: the MVP exposes this result store only for API bots,
but the storage primitive should be organized as shared channel infrastructure,
not Chatwoot/API transport-local state. Future Slack, Telegram, or other
channels may reuse the same processing/result record model before delivering
through their provider APIs. This is a code organization guardrail, not a
commitment to expose result polling for non-API channels in the MVP.

Ingress returns quickly after auth, validation, mapping, dedupe, and queue/run
acceptance. It does not wait for the agent run to finish. The default success
code is `202 Accepted`; a per-bot compatibility override may return `200` for
providers that require exact webhook acknowledgement.

Result records expose:

- `channel`: always `api`
- `botId`
- `eventId`
- `status`
- `progress[]`
- `result`
- sanitized `error`
- `expiresAt`

Allowed processing statuses:

- `received`
- `filtered`
- `duplicate`
- `queued`
- `steered`
- `processing`
- `completed`
- `failed`
- `stopped`
- `expired`

Do not add a top-level `admission` field. `status` is the lifecycle state. If
queue/debug details are needed later, expose optional metadata such as
`queue.position` or `run.id`.

Default result retention is 6 hours. Records should persist across runtime
restart until expiry, with bounded progress count and bounded text size.

Event stop interrupts the active run associated with that event record. Surface
stop interrupts whatever run is currently active on the mapped surface, for
chat-flow integrations that do not know the active event id. Both endpoints use
the same active-run interrupt behavior as chat `/stop`; they do not introduce
pause/resume or queue-cancel semantics in the first slice. Terminal event
records return `409 Conflict`, and unknown event or surface ids return `404`.

## Actions

Provider delivery is optional and uses named `actions`. The first accepted
action name is `message.send`.

Rules:

- no top-level `outbound` in the first API-channel contract
- no arbitrary action names in the first slice
- `message send --progress` records progress in the result store
- `message send --final` records final result in the result store
- if `actions.message.send` exists, clisbot also attempts provider delivery
- if `actions.message.send` is absent, local result recording still succeeds
- provider delivery failure does not erase stored progress or final result

This keeps polling-only integrations simple while preserving a scalable path for
future `message.edit`, `message.stream.chunk`, `reaction.add`, and
provider-specific resource actions.

## Mapping, Filtering, And Rendering

The first mapper supports explicit inbound field paths, structured drop filters,
composed string fields, simple array projection, URL/header/body templates, and
non-secret `reply.params` for provider addressing fragments such as account id.

The syntax intentionally borrows from common config languages:

- JSONPath-like read subset for paths
- Mustache-like interpolation for composed strings
- query-DSL style `all`/`any`/`not` predicates for filters

Filter evaluation is strict and fail-closed: missing paths are distinct from
explicit JSON `null`, predicates do not coerce types, and unknown operators are
configuration errors.

The API channel is text-first:

- first-slice render modes: `text`, `markdown`
- `--render native` means the API bot's declared native render mode
- native provider payloads, attachments, edits, reactions, streaming, and typing
  are out of first-slice scope

## Auth

Public production event ingress requires provider authentication. If a provider
cannot send HMAC, bearer, or another verifiable secret, the integration must
either patch that provider, add a trusted proxy that injects a verified secret
toward clisbot, or stay on a private trusted network.

The MVP supports:

- `hmac` for signed server-to-server production webhooks
- `bearer` for providers that only support static webhook tokens
- `none` for local loopback testing only

`none` must not be accepted on public listeners without a high-severity startup
or health failure.

For Chatwoot, use the agent-bot webhook HMAC contract when available:

- `X-Chatwoot-Webhook-Timestamp`
- `X-Chatwoot-Webhook-Signature: sha256=<hex>`
- signing base `<timestamp>.<raw_body>`
- secret env `CHATWOOT_WEBHOOK_HMAC_SECRET`
- tolerance env `CHATWOOT_WEBHOOK_HMAC_TOLERANCE_SECONDS`
- default tolerance `300`

This applies to `:agent_bot_webhook`; ordinary account or inbox webhooks remain
out of scope unless they get the same signing behavior.

Known shared default secrets are acceptable only for local or UAT bootstrap.
Production-like runs should require an explicit non-default secret or report a
high-severity startup/health warning.

## Considered And Superseded

Earlier direction: one built-in `webhook` channel with config under
`bots.webhook.<botId>` and endpoint `/webhook/bots/<botId>`.

Decision: superseded by `api` channel with `bots.api.<botId>` and
`/api/bots/<botId>/events`.

Reason: a webhook is one-way ingress, while the product includes event ingress,
result polling, local progress/final state, and optional provider actions.
Keeping `webhook` as the channel id would make the status/result APIs look
bolted on and would teach the wrong integration model.

Earlier direction: top-level `outbound` config.

Decision: superseded by `actions.message.send`.

Reason: `outbound` is concise for the first reply case, but it creates a second
schema path once progress, edit, streaming, reactions, or provider resource
actions arrive. Named actions provide one validation path and one extension
model.

Earlier direction: a `connectors` alias or dynamic provider plugin ids.

Decision: do not add either yet.

Reason: the current static built-in channel inventory is sufficient, and adding
another naming layer would create parsing, migration, docs, and support cost
before the need is proven.

## Consequences

Good:

- basic provider integration becomes mostly config plus validation
- shared channel architecture remains static and truthful
- route, pairing, queue, loop, session, result, and operator send machinery can
  be reused
- API bot identity can be namespaced inside principals and session keys
- provider outbound is optional rather than required
- richer providers still have a clean path to native channels or explicit
  action hooks

Tradeoffs:

- the API channel becomes a small integration runtime and must keep mapping,
  auth, results, and HTTP actions well bounded
- first-slice behavior is intentionally less capable than Slack, Telegram, or
  Zalo
- `api:<botId>:<provider-user-id>` principal strings are longer than native
  channel principals but avoid cross-provider id collisions
- filter and template support is intentionally small; richer provider-specific
  behavior should graduate to a native channel or explicit action hook

## Links

- [Static Built-In Channel Installation Inventory](2026-05-13-static-built-in-channel-installation-inventory.md)
- [Channel-Native Replaces Message Custom](2026-05-24-channel-native-replaces-message-custom.md)
- [Generic API Channel Events And Actions Grill](../../research/channels/2026-05-25-generic-webhook-channel-grill.md)
- [API Channel Naming And Result Polling Grill](../../research/channels/2026-05-30-api-channel-result-polling-grill.md)
