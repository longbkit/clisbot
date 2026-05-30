# Generic API Channel MVP

## Summary

Implement the built-in `api` channel so third-party systems can send events to
clisbot, poll processing status/progress/result, and optionally receive provider
HTTP message delivery through configured actions.

The first real target is Chatwoot agent-bot webhook delivery.

## Entrypoint

Use this task doc as the entrypoint for implementation. It is the source of
truth for MVP scope and should be enough to start coding without mining research
docs for hidden requirements.

Primary implementation path:

1. [Generic API Channel MVP](#generic-api-channel-mvp) - this task doc; current
   implementation brief and final first-slice scope.
2. [Generic API Channel Events And Actions ADR](../../../architecture/decisions/2026-05-25-generic-webhook-channel-connectors.md) -
   stable architecture decision and vocabulary.
3. [Channel Integration Playbook](../../../features/channels/channel-integration-playbook.md) -
   channel implementation checklist and media/rendering audit gates.
4. [Channels README](../../../features/channels/README.md) and
   [Backlog](../../backlog.md) - feature inventory and tracking context.

Supporting rationale and review docs:

- [Generic API Channel Events And Actions Grill](../../../research/channels/2026-05-25-generic-webhook-channel-grill.md) -
  original decision grilling, updated to the final `api` channel direction.
- [API Channel Naming And Result Polling Grill](../../../research/channels/2026-05-30-api-channel-result-polling-grill.md) -
  result polling, no top-level `outbound`, and actions-first delivery rationale.
- [Chatwoot API Media Action Thinking](../../../research/channels/2026-05-30-chatwoot-api-media-action.md) -
  future Chatwoot image/file delivery via existing `--file`/`--file-type` and
  multipart `attachments[]`; not MVP scope unless explicitly accepted.
- [Jira Server Webhook Ingress-Only Automation](../../../research/channels/2026-05-30-jira-server-webhook-ingress-only-automation.md) -
  recommended post-MVP validation path for Jira Server events; agent uses
  existing Jira MCP/CLI for Jira writes.
- [Jira Server API Bot AI Native Workflow](../../../research/channels/2026-05-30-jira-server-api-ai-native-workflow.md) -
  broader full-flex Jira plugin direction with clisbot-owned Jira actions; not
  the lightweight validation path and not MVP scope.
- [Large-Scale Doc Migration Lesson](../../../lessons/2026-05-30-large-scale-doc-migrations-need-inventory-and-repeatable-gates.md) -
  repeatable gates to avoid naming/contract drift during implementation.

## Status

Implemented first end-to-end slice in code and locally validated.

Implemented in this slice:

- static built-in `api` channel registration and config template support
- `bots.api.<botId>` config schema with listener, ingress auth/map/filter, and
  optional `actions.message.send`
- `POST /api/bots/<botId>/events`
- `GET /api/bots/<botId>/events/<eventId>/result`
- `POST /api/bots/<botId>/events/<eventId>/stop`
- `POST /api/bots/<botId>/surfaces/<surfaceId>/stop`
- HMAC, bearer, and loopback-only `none` auth
- declarative filter/map baseline
- shared channel result store under `src/channels/results`
- route/session handoff through existing channel interaction machinery
- `clisbot message send --channel api` for progress/final result recording and
  optional provider HTTP action delivery

Still deliberately outside this first slice:

- provider media/file delivery
- delivery status tracking
- retries and idempotency keys

Known partial coverage after the expanded local test pass: detailed API health
and live Chatwoot/Jira e2e remain follow-up work. Local coverage now includes
handler integration, mocked provider delivery, auth/mapper/result-store unit
matrices, and a real local `Bun.serve` listener smoke.

## Implementation Reading Contract

An implementation agent should treat this task doc as the primary
implementation brief for the MVP. It is intended to be self-contained for
first-slice behavior.

Read order:

1. Start at `Entrypoint`, then read this task doc end to end.
2. Use the ADR only to resolve architecture or vocabulary ambiguity:
   [Generic API Channel Events And Actions ADR](../../../architecture/decisions/2026-05-25-generic-webhook-channel-connectors.md).
3. Use the grill/research docs only for rationale, rejected alternatives, and
   explicitly future-scoped follow-up ideas:
   [Generic API Channel Events And Actions Grill](../../../research/channels/2026-05-25-generic-webhook-channel-grill.md) and
   [API Channel Naming And Result Polling Grill](../../../research/channels/2026-05-30-api-channel-result-polling-grill.md).

Do not mine the grill docs for extra MVP scope. If this task doc and a grill doc
disagree, this task doc wins for implementation scope unless the ADR says
otherwise.

## Why

Chatwoot is adding server-side HMAC signing for agent-bot webhooks, which
removes the main blocker for a public server-to-server ingress path. The same
channel should also support programmatic clients that do not want provider
outbound delivery and only need a result polling API.

## Final Decision Snapshot

These are not open questions for the MVP:

| Decision | Final answer |
| --- | --- |
| Public channel id | `api` |
| Config root | `bots.api.<botId>` |
| Ingress endpoint | `POST /api/bots/<botId>/events` |
| Result endpoint | `GET /api/bots/<botId>/events/<eventId>/result` |
| Event stop endpoint | `POST /api/bots/<botId>/events/<eventId>/stop` |
| Surface stop endpoint | `POST /api/bots/<botId>/surfaces/<surfaceId>/stop` |
| Default ingress success | `202 Accepted`, with optional per-bot `200` override |
| Result baseline | Always create result records for authenticated parsed events |
| Provider delivery | Optional via `actions.message.send` |
| No provider delivery | Still record progress/final result; do not fail only because action is absent |
| Top-level `outbound` | Not supported |
| Old webhook endpoint | No clisbot alias in first slice |
| Status model | One lifecycle `status`; no top-level `admission` |
| Delivery status | Not in first result shape |
| Code organization | Build a shared channel-result primitive, expose it only through API bot in this slice |
| Retention | Default 6 hours, bounded by count/text size; no retention upper-bound knob defined yet |

## Scope

- add built-in channel id `api`
- add config under `bots.api.<botId>`
- expose event ingress endpoint `POST /api/bots/<botId>/events`
- expose result endpoint `GET /api/bots/<botId>/events/<eventId>/result`
- expose event stop endpoint `POST /api/bots/<botId>/events/<eventId>/stop`
- expose surface stop endpoint `POST /api/bots/<botId>/surfaces/<surfaceId>/stop`
- verify inbound auth before JSON parsing
- support all inbound auth modes: HMAC, bearer, and local-only `none`
- support structured inbound filters
- support explicit field mapping and composed mapped strings
- support non-secret `reply.params` for action addressing only
- support result-store recording for progress and final output
- support optional `actions.message.send` provider HTTP delivery
- support text and Markdown render modes
- dedupe inbound events by `api:<botId>:<eventId>`
- route mapped surfaces through existing route, queue, steering, and session
  machinery
- expose useful health without leaking secrets

## First Slice Support Matrix

Supported:

- inbound endpoint: `POST /api/bots/<botId>/events`
- result endpoint: `GET /api/bots/<botId>/events/<url-encoded-eventId>/result`
- config location: `bots.api.<botId>`
- inbound auth: HMAC over raw body, bearer token, or local-only `none`
- inbound payload: JSON request body only
- field paths: root, nested property, bracket property, array index, and current
  array item for projection
- templates: string interpolation from payload paths, mapped values, env refs,
  message fields, and reply metadata
- filters: `all`, `any`, `not`, `equals`, `notEquals`, `exists`, `in`, `anyIn`
- mapped inbound fields: event id, surface kind/id, sender id/display name,
  text, optional `runMode`, reply target id, non-secret reply params
- principal: `api:<botId>:<provider-user-id>`
- result store: event-scoped `status`, `progress[]`, `result`, `error`,
  `expiresAt`
- output kinds: `progress`, `final`
- rendering: `text` and `markdown`
- actions: `actions.message.send` only, optional per bot
- stop: event-scoped and surface-scoped active-run stop using the same
  interrupt path as chat `/stop`
- retry: no retry by default
- health/debug: endpoint, auth mode, render mode, last ingress/action status,
  error code/category, without secrets

Not supported in the first slice:

- top-level `outbound`
- non-JSON inbound payloads
- provider-native attachments, edits, deletes, typing indicators, reactions,
  streaming chunks, rich cards, or custom provider actions as first-class
  behavior
- arbitrary JavaScript, jq, full JSONPath filter expressions, function calls,
  regex matching, numeric/date comparisons, or case-insensitive comparison
- cross-event stateful filters or multi-step provider workflows
- hidden secrets in `reply.params`
- automatic retry unless a later action explicitly adds bounded retry and
  idempotency behavior

Future capability expansion path:

- Keep `map` for inbound canonical event projection only.
- Keep `actions.message.send` as the first provider delivery action.
- Add richer behavior later as declared `capabilities` plus named `actions`,
  for example `message.edit`, `message.stream.chunk`, `reaction.add`, or
  provider-specific resource actions.
- Keep run control narrow: event stop and surface stop only trigger the same
  active-run interrupt path as chat `/stop`; do not add pause/resume/cancel
  queue semantics until a separate need is explicit.
- Media/file delivery must expand by declared media-kind capability, not by one
  generic "supports files" flag.
- Do not overload `reply.params` or action body templates with hidden operation
  intent. The action name must stay explicit and testable.

## Target Config Shape

Use the existing clisbot bot config hierarchy. Do not add `channels.api.bots`,
`channels.webhook.bots`, or a `connectors` alias.

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
            "timestampHeader": "X-Chatwoot-Webhook-Timestamp",
            "signatureHeader": "X-Chatwoot-Webhook-Signature",
            "signaturePrefix": "sha256=",
            "signingBase": "{{timestamp}}.{{rawBody}}",
            "toleranceSecondsEnv": "CHATWOOT_WEBHOOK_HMAC_TOLERANCE_SECONDS",
            "toleranceSecondsDefault": 300
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
            "runMode": "$.clisbot.runMode",
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
              "message_type": "outgoing",
              "private": false
            },
            "rendering": {
              "native": "markdown"
            },
            "retry": {
              "mode": "none"
            }
          }
        }
      }
    }
  }
}
```

Rendering semantics:

- `rendering.native` defines what `--render native` means for this action.
  In the Chatwoot example, native output is provider-compatible Markdown.
- Do not add automatic runtime fallback in the first slice. clisbot cannot
  truthfully know from a provider HTTP failure that Markdown was the problem.
- Render selection is deterministic: `text` sends plain text, `markdown` sends
  Markdown when supported, and `native` maps to the configured native render
  mode. Unsupported render requests should fail validation before the provider
  call instead of silently changing format.
- Provider rejection is an action failure, not a reason to rewrite and retry as
  text; result-store progress/final output must remain recorded.

## Inbound Auth Modes

All three auth modes are part of the MVP:

- `hmac`: preferred for production when the provider can sign the raw body. It
  verifies payload integrity at the application layer and supports replay
  protection when the provider sends a timestamp.
- `bearer`: required because many providers can only send a static token. It
  authenticates the caller but relies on TLS for body integrity. Keep the token
  in an env ref.
- `none`: required for local testing and private loopback-only development. It
  must be rejected or reported as high severity when bound to a public or
  non-loopback listener.

Auth failures return `401`, happen before JSON parsing for HMAC, and must not
create result records that could leak event ids or payload shape.

## Result API

Event ingress acknowledges quickly after auth, validation, mapping, and
enqueue/dedupe. It must not wait for the agent run to finish.

API contracts:

| Contract | Method and path | Auth | Request body | Success response | Scope |
| --- | --- | --- | --- | --- | --- |
| Ingest event | `POST /api/bots/<botId>/events` | API bot auth: HMAC, bearer, or local-only `none` | Provider JSON payload | `202` with `eventId`, `status`, `resultUrl`, `expiresAt` | MVP |
| Poll result | `GET /api/bots/<botId>/events/<eventId>/result` | API bot auth or operator auth | None | `200` result record | MVP |
| Stop event | `POST /api/bots/<botId>/events/<eventId>/stop` | API bot auth: HMAC, bearer, or local-only `none` | Empty body; HMAC still signs raw body | `200` updated result record | MVP |
| Stop surface | `POST /api/bots/<botId>/surfaces/<surfaceId>/stop` | API bot auth: HMAC, bearer, or local-only `none` | Empty body; HMAC still signs raw body | `200` stop result | MVP |
| Provider outbound | No clisbot public endpoint | Configured action auth | Rendered by `actions.message.send` | Provider-specific | Optional MVP action |

```http
POST /api/bots/<botId>/events
```

Default success response is `202 Accepted`. If a provider requires exact `200`,
support a per-bot `ingress.successStatusCode: 200` compatibility override.

```json
{
  "channel": "api",
  "botId": "chatwoot",
  "eventId": "message_created:123",
  "status": "queued",
  "resultUrl": "/api/bots/chatwoot/events/message_created%3A123/result",
  "expiresAt": "2026-05-30T09:30:00.000Z"
}
```

Result endpoint:

```http
GET /api/bots/<botId>/events/<url-encoded-eventId>/result
```

The response must not include secrets, raw payload, or full prompt text.

```json
{
  "channel": "api",
  "botId": "chatwoot",
  "eventId": "message_created:123",
  "status": "processing",
  "progress": [
    {
      "sequence": 1,
      "kind": "progress",
      "text": "Checking conversation context.",
      "render": "text",
      "createdAt": "2026-05-30T03:30:02.000Z"
    }
  ],
  "result": null,
  "error": null,
  "expiresAt": "2026-05-30T09:30:00.000Z"
}
```

Allowed `status` values:

- `received`: auth, parse, and initial validation succeeded
- `filtered`: event was intentionally dropped by filter
- `duplicate`: event id was already processed or queued
- `queued`: event is waiting behind the session queue
- `steered`: event was accepted as steering input into an active run
- `processing`: an agent run or linked run is in progress
- `completed`: final result is available
- `failed`: processing failed; include sanitized `error`
- `stopped`: active run was interrupted through event or surface stop
- `expired`: result record aged out

Do not include a top-level `admission` field. If queue/debug context is needed
later, expose optional metadata such as `queue.position` or `run.id`.

Status is tracked per `botId + eventId`, not per surface. If event B arrives
while event A is processing on the same surface, B gets its own result record:
`queued`, `steered`, or `duplicate`. A's result must not be overwritten by B.

Intentional queue/steer:

- Existing chat command prefixes still work in mapped text for human/chat-like
  providers: `/queue <message>`, `\q <message>`, `/steer <message>`, or
  `\s <message>`.
- Programmatic API clients should prefer mapped `runMode: "queue" | "steer"`
  from a trusted provider field instead of smuggling command prefixes into
  user-visible text.
- Missing `runMode` uses the configured route/agent `additionalMessageMode`.
- `runMode: "steer"` steers only when an active run can accept steering; if not,
  preserve ordering by queueing rather than dropping the event.

Stop endpoints:

The first slice supports two stop endpoints because they serve different
clients.

Event stop:

```http
POST /api/bots/<botId>/events/<url-encoded-eventId>/stop
```

Use event stop when the API client is tracking the submitted event and polling
that event's result.

Surface stop:

```http
POST /api/bots/<botId>/surfaces/<url-encoded-surfaceId>/stop
```

Use surface stop when an integration such as a Chatwoot chat flow needs to
stop whatever run is currently active for that conversation, regardless of which
event started it.

Shared semantics:

- auth uses the same API bot auth or operator auth as result polling
- successful stop triggers the same interrupt behavior as chat `/stop`
- event stop succeeds only when that event record has an active session and the
  active run is interrupted
- surface stop stops the current run for that surface without requiring the
  caller to know which event started it
- event stop for a terminal event returns an error such as `409 Conflict`
  because there is no running work left to stop
- surface stop with no active run returns `409 Conflict` or `404`, depending
  on whether the surface is known
- unknown or expired event ids return `404`

Retention:

- default result retention: 6 hours
- persist records across runtime restart until expiry
- bound stored progress entries per event, for example latest 20 entries
- bound stored text size and truncate with an explicit marker

## Result Store Storage Layout

Current first-slice implementation stores channel result state in one local JSON
document:

```text
${CLISBOT_HOME:-~/.clisbot}/state/channel-results.json
```

Implementation files: `src/infra/paths.ts` via
`getDefaultChannelResultsPath()` and `src/channels/results/result-store.ts`.
There is no public config knob in MVP; tests can inject a custom store path.

Top-level document shape:

| Field | Key shape | Purpose |
| --- | --- | --- |
| `results` | `<channel>:<botId>:<eventId>` | Event-scoped polling truth; for MVP usually `api:<botId>:<eventId>`. |
| `surfaces` | `<channel>:<botId>:<surfaceId>` | Latest known reply target for a surface, used by `message send` without `--reply-to` and by surface stop. |

Sample storage data:

```json
{
  "results": {
    "api:chatwoot:message_created:123": {
      "channel": "api",
      "botId": "chatwoot",
      "eventId": "message_created:123",
      "status": "processing",
      "progress": [
        { "sequence": 1, "kind": "progress", "text": "Checking context.", "render": "text", "createdAt": "2026-05-30T03:30:02.000Z" }
      ],
      "result": null,
      "error": null,
      "expiresAt": "2026-05-30T09:30:00.000Z",
      "updatedAt": "2026-05-30T03:30:02.000Z",
      "surfaceId": "3:970",
      "surfaceKind": "dm",
      "agentId": "default",
      "sessionKey": "agent:default:api:chatwoot:dm:3:970",
      "reply": { "targetId": "970", "params": { "accountId": 3 } }
    }
  },
  "surfaces": {
    "api:chatwoot:3:970": {
      "channel": "api", "botId": "chatwoot",
      "surfaceId": "3:970",
      "surfaceKind": "dm",
      "agentId": "default",
      "sessionKey": "agent:default:api:chatwoot:dm:3:970",
      "targetId": "970", "params": { "accountId": 3 },
      "activeEventId": "message_created:123",
      "updatedAt": "2026-05-30T03:30:02.000Z"
    }
  }
}
```

Stored data includes lifecycle, bounded outputs, run/surface context, and non-secret reply addressing.

Lifecycle behavior:

- authenticated parsed events create a `results` record before routing
- result creation/context updates also upsert the matching `surfaces` record
- appending `progress` keeps the latest 20 entries
- appending `final` writes `result` and moves status to `completed`
- text is capped at 12,000 characters with an explicit truncation marker
- expired records are marked `expired`, then pruned after a short grace window
- the file is rewritten as one JSON document in the first slice

Never store raw provider payloads, HMAC/bearer secrets, raw prompt envelopes,
provider response bodies, or attachment/media bodies in this result store.

Implementation thinking: keep public behavior scoped to API bot in this MVP,
but keep the primitive under `src/channels/results` so future channels can
reuse the same event/result state before provider delivery.

## Message Send And Actions

Shared message send should work whether provider delivery is configured or not.

If `actions.message.send` exists:

- `message send --channel api --bot <botId> --progress` records progress and
  attempts provider delivery
- `message send --channel api --bot <botId> --final` records final result and
  attempts provider delivery
- provider delivery failure does not erase stored progress/result

If `actions.message.send` is absent:

- the same commands write only to the result store
- no HTTP delivery is attempted
- the command should not fail only because provider delivery is absent

Future media compatibility:

- keep first-slice provider media delivery unsupported
- later declare support per media kind: generic file, image, video, audio, voice
- for each kind declare accepted sources: local upload, remote URL, or both
- declare multi-file behavior separately: unsupported, ordered sends, or
  provider-native album/group
- declare caption behavior separately: none, shared message caption, per-file
  caption, or provider-specific
- unsupported media must fail validation before provider dispatch, not silently
  degrade to a text link unless that link-only behavior is declared

Operator examples:

```bash
clisbot message send \
  --channel api \
  --bot chatwoot \
  --target dm:3:970 \
  --message "Da em da nhan thong tin."
```

For Jira, `message.send` can mean add-comment only if the Jira API bot declares
that action. Description updates and existing-comment edits are not portable
message sends; keep them behind explicit future action names or native commands
with review/confirm semantics.

## Mapper And Filter Baseline

Use a small declarative DSL rather than arbitrary code execution:

- paths use a JSONPath-like read subset: `$.a.b`, `$["custom field"]`,
  `$.items[0].id`, and `@.field` inside array projection
- composed strings use Mustache-like interpolation: `{{$.account.id}}`
- filters use `all`, `any`, `not`, plus predicates such as `equals`,
  `notEquals`, `exists`, `in`, and `anyIn`
- array projection uses `from` plus `map`; `$` is root payload and `@` is the
  current item

Semantics:

- path lookup is read-only and must not call functions
- missing path resolves to missing, not `null`
- predicates are strict by default; do not coerce strings to booleans/numbers
- `exists` checks presence, while `equals: null` checks explicit JSON `null`
- unknown operators or invalid paths are config errors
- invalid payload shape fails closed for filters and fails the inbound event for
  required mapped fields

Array mapping example:

```json
{
  "attachments": {
    "from": "$.attachments",
    "map": {
      "id": "@.id",
      "fileName": "@.file_name",
      "contentType": "@.content_type",
      "url": "@.data_url"
    }
  }
}
```

Provider-native attachment delivery remains out of first slice.

## Chatwoot First Slice

Use Chatwoot agent-bot webhook, not ordinary account/inbox webhook, because the
current Chatwoot HMAC patch signs only `:agent_bot_webhook`.

Inbound HMAC contract:

- timestamp header: `X-Chatwoot-Webhook-Timestamp`
- signature header: `X-Chatwoot-Webhook-Signature`
- signature value: `sha256=<hex>`
- signing base: `<timestamp>.<raw_body>`
- secret env: `CHATWOOT_WEBHOOK_HMAC_SECRET`
- tolerance env: `CHATWOOT_WEBHOOK_HMAC_TOLERANCE_SECONDS`
- tolerance default: `300`

The `Target Config Shape` section is the source of truth for Chatwoot filter,
mapping, action URL, action auth, and action body examples.

## Implementation Plan

Implementation and test traceability:

| # | Scope | Implementation | Unit coverage | Integration coverage | E2E/live coverage |
| --- | --- | --- | --- | --- | --- |
| 1 | Config schema/template for `bots.api` | Done: `src/channels/api/config-schema.ts`, template contract, config helpers | `test/config-template.test.ts` validates defaults and official template | `test/channel-bots.test.ts`, `test/routes-cli.test.ts`, `test/pairing-cli.test.ts` cover shared CLI inventory using `api` | Not live-tested |
| 2 | Channel installation and runtime plugin | Done: registry, installation inventory, `src/channels/api/plugin.ts` | `test/channel-installation-inventory.test.ts` covers built-in installation seam | Message/routes/pairing CLI tests accept `api` as a supported channel | Not live-tested |
| 3 | Listener routing for `/api/bots/<botId>/events` with raw body | Done: `ApiChannelService` and `handleApiRequest` | Path parsing is covered through handler tests | `test/api-channel.test.ts` posts to event/result URLs and verifies acceptance/result | Local `Bun.serve` listener smoke covered; no external live provider test |
| 4 | HMAC before JSON parse | Done: auth verifies raw body before JSON parse | `test/api-auth.test.ts` covers missing signature, stale timestamp, wrong secret | Bad HMAC with invalid JSON returns `401` and creates no result record | No provider HMAC live test |
| 5 | Bearer and loopback-only `none` | Done | Bearer/none covered through handler tests | Bearer success and non-loopback `none` rejection covered | No public-bind startup warning test yet |
| 6 | Mapper/filter DSL and `reply.params` | Done: `src/channels/api/mapper.ts` | `test/api-mapper.test.ts` covers bracket paths, arrays, `in`, `anyIn`, and projection | Event mapping, filter drop, reply params, and action templates covered | Not live-tested with Chatwoot/Jira payloads |
| 7 | Canonical envelope and principal `api:<botId>:<provider-user-id>` | Done | `test/auth-resolve.test.ts` preserves provider ids containing `:` | API ingress builds route/session context using the mapped sender and surface | Not live-tested |
| 8 | Existing routing, queue, steering, session, and dedupe seams | Done for first slice | Existing route/session tests cover shared machinery; API-specific duplicate and `runMode: steer` covered | API happy path enqueues/processes; stop tests use stored session context | No live long-running run test |
| 9 | Result store with progress/final output records | Done: shared `src/channels/results/result-store.ts`, default path `${CLISBOT_HOME:-~/.clisbot}/state/channel-results.json` | `test/channel-results-store.test.ts` covers persistence, progress/final, expiry, and prune grace | Polling result, filtered result, final output, surface reply index, and stop status covered | Restart behavior covered at store level, not process e2e |
| 10 | `actions.message.send` HTTP delivery, templates, no retry | Done for text/Markdown only | `test/api-message-actions.test.ts` covers provider action and no-action store-only behavior | Mocked fetch verifies Chatwoot URL/header/body and result-store final record | No live Chatwoot send |
| 11 | `clisbot message send --channel api` | Done through channel plugin | Message CLI accepts `api` through shared command tests | `sendApiMessage` integration test records final and calls provider action | No CLI subprocess smoke yet |
| 12 | Runtime health details | Partial: plugin reports active/disabled/stopped summary | Existing runtime summary tests cover generic channel health inventory | No API-specific last ingress/action status test | Detailed endpoint/auth/render/last-action health is not implemented yet |
| 13 | Result endpoint | Done | Covered through handler-level tests | Happy path polls `/result` until `completed` | Local real listener smoke covers `/events` and `/result` |
| 14 | Event and surface stop endpoints | Done | Covered through handler-level tests | Event stop, terminal-event `409`, and surface stop are covered | No live long-running run stop test yet |
| 15 | Docs and Chatwoot examples | Done for MVP plus follow-up thinking docs | Drift checks run with `rg` | Docs link task, ADR, channel playbook, Chatwoot media thinking, Jira validation thinking | Live Chatwoot/Jira docs remain validation follow-up |

## Risks And Decisions

- Prompt context should show a safe derived reply command, not raw
  `reply.params`. For Chatwoot, the prompt-visible target should be enough:
  `clisbot message send --channel api --bot chatwoot --target dm:3:970`.
- If an API bot needs hidden non-secret address fragments that cannot be
  derived from the prompt-visible target and no prior inbound surface record
  exists, manual `message send` should fail with a clear missing-address error.
- Do not add `/webhook/chatwoot` or `/webhook/bots/chatwoot` as clisbot aliases
  in the first slice. Configure Chatwoot to call `/api/bots/chatwoot/events`, or
  use an external rewrite if another system owns the old path.
- Do not accept account/inbox Chatwoot webhooks as production-public unless they
  get the same HMAC contract.
- Do not use the known default secret for production. clisbot should warn or
  fail when `CHATWOOT_WEBHOOK_HMAC_SECRET` is missing or equal to
  `vexere-chatwoot-chatbot-webhook-secret` in production-like runs.
- HMAC is not a TLS replacement. It is application-level server-to-server auth
  and replay control. The secret must stay in Chatwoot backend/proxy and clisbot
  env, never in a browser client.
- Keep retry disabled by default. Retrying Chatwoot sends without a
  provider-supported idempotency key can duplicate replies.
- Keep result records bounded and sanitized. They help providers, operators, and
  tests understand whether an event was filtered, deduped, queued, completed, or
  failed, but must not become a raw payload archive.

## Validation

Latest local gate:

- `bun test test/api-channel.test.ts test/api-message-actions.test.ts test/api-auth.test.ts test/api-mapper.test.ts test/channel-results-store.test.ts`: 24 pass
- `bunx tsc --noEmit`: pass
- `bun run check`: 970 pass, 0 fail, 3419 expectations, 115 files
- `git diff --check`: pass before commit `fbba84a`

| Area | Current coverage | Remaining gap |
| --- | --- | --- |
| HMAC success and `sha256=` prefix | Covered by handler test and isolated missing-signature, stale timestamp, wrong-secret tests | None for first slice |
| HMAC before JSON parse | Covered by bad-HMAC invalid-JSON test returning `401` and no result record | None for first slice |
| Bearer auth | Covered by bearer success and wrong-token failure tests | None for first slice |
| Local-only `none` | Covered for non-loopback rejection | Public-bind startup/health warning is not implemented yet |
| Filters | Covered for outgoing message filtered result | Add private/agent-bot/template/activity fixture tests if Chatwoot payload variants are finalized |
| Mapper/templates | Covered for event id, surface id, reply params, URL/header/body templates, bracket paths, arrays, `in`, `anyIn`, and projection | None for first slice |
| Principal parsing | Covered by auth principal normalization test | None known |
| Dedupe | Covered for duplicate event id on same bot and same event id across another bot | None for first slice |
| Result statuses | Covered for `filtered`, `queued`, `steered`, `processing`, `completed`, `failed`, `expired`, and `stopped`; duplicate response is covered | None for first slice |
| Result store progress/final without provider action | Covered by explicit no-action `message.send` test plus handler flow | None for first slice |
| Result store storage layout | Documented in `Result Store Storage Layout`; standalone store persistence/expiry/prune tests added | Process restart e2e remains optional follow-up |
| `actions.message.send` | Mocked fetch verifies Chatwoot URL, header, body, render, and final result | No live Chatwoot send test |
| Stop endpoints | Event stop, terminal-event `409`, and surface stop covered | No live long-running process stop test |
| Real HTTP listener | Covered by local `Bun.serve` smoke for event ingress and result polling | External provider networking remains live-validation follow-up |
| External e2e | None | Live Chatwoot webhook/send and Jira webhook-ingress validation remain follow-up |
