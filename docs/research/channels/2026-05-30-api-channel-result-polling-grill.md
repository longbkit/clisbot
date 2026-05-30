# API Channel Naming And Result Polling Grill

## Context

The prior grill called the integration surface `webhook`, but the actual
product shape is no longer webhook-only:

- third-party systems send inbound events to clisbot
- clisbot may send outbound messages back to a provider HTTP API
- clisbot may also store progress and final results locally for clients to poll
- outbound provider delivery can be absent by design

That makes `webhook` too narrow as the public channel name. A webhook is one
directional ingress. The emerging product is a bidirectional or programmatic API
channel with webhook ingress as one input mode.

## Recommendation

Rename the public channel from `webhook` to `api` before implementation if the
goal is long-term programmatic integration, not only chat-provider connector
integration.

Recommended vocabulary:

- `api` channel: the built-in clisbot channel for programmatic third-party
  integration
- API bot: one configured integration under `bots.api.<botId>`
- inbound webhook: one supported input mode for an API bot
- result store: bounded persisted state for event status, progress, and final
  result
- outbound action: optional provider HTTP call such as `message.send`

Avoid using `webhook` as the channel id once result polling and optional
outbound-less operation are first-class. Keep `webhook` only as a transport
mode or endpoint style inside the API channel.

## Naming Tradeoffs

`api` is broader and matches the user mental model for programmatic clients:
POST an event, poll status/progress/result, optionally receive callbacks. It is
also short and fits existing CLI shape:

```bash
clisbot message send --channel api --bot chatwoot --target dm:3:970 --message "..."
```

The risk is that `api` can collide conceptually with a future clisbot control
API. Mitigation: keep the channel namespace explicit in docs and endpoints:

- channel id: `api`
- bot config: `bots.api.<botId>`
- ingress/result endpoints: `/api/bots/<botId>/...`
- future operator/control API, if added, should use a distinct namespace such
  as `/control/...` or `/admin/...`

Alternative names:

- `http`: technically accurate for transport, but too low-level and not enough
  about the product use case.
- `connector`: accurate internally, but weaker as a user-facing channel id.
- `integration`: broad, but long and vague.
- `webhook`: accurate only for inbound event delivery; misleading for result
  polling and outbound API calls.

Recommendation: use `api` publicly, and use `connector` only as an internal
architecture word when discussing one configured provider integration.

## API Contract Summary

This is the proposed public contract shape if the channel is renamed to `api`.

Endpoint contracts:

| Contract | Method and path | Auth | Request body | Success response | Notes |
| --- | --- | --- | --- | --- | --- |
| Ingest event | `POST /api/bots/<botId>/events` | API bot auth: HMAC, bearer, or local-only `none` | Provider JSON payload | `202` with `eventId`, `status`, `resultUrl`, `expiresAt` | Auth failures return `401` and do not create result records. |
| Poll result | `GET /api/bots/<botId>/events/<eventId>/result` | Same API bot auth or operator auth | None | `200` result record | Includes processing `status`, `progress[]`, `result`, `error`, and `expiresAt`. |
| Stop event | `POST /api/bots/<botId>/events/<eventId>/stop` | API bot auth | Empty body in the first slice | `200` updated result record | MVP after Chatwoot chat-flow review. Stops only when the event has an active run; terminal events return `409`, unknown/expired events return `404`. |
| Stop surface | `POST /api/bots/<botId>/surfaces/<surfaceId>/stop` | API bot auth | Empty body in the first slice | `200` stop result | MVP after Chatwoot chat-flow review. Stops whatever run is active on that surface; no active run returns `409` or `404`. |
| Provider outbound | No clisbot public endpoint | Uses configured action auth | Rendered by `actions.message.send` | Provider-specific | Optional. Absence of the action means local result-store only. |

HTTP response code rule:

- `POST /events` returns `202 Accepted` by default because clisbot has accepted
  the event for asynchronous processing, not completed the AI work.
- `GET /result` returns `200 OK` when the result record exists, regardless of
  whether processing is still `queued`, `processing`, `completed`, or `failed`.
- Clients must read the JSON `status` field for processing state; HTTP `2xx`
  only means the API request itself succeeded.
- If a third-party webhook provider incorrectly requires exactly `200` for
  webhook acknowledgement, support a per-bot compatibility override such as
  `ingress.successStatusCode: 200`. Keep `202` as the canonical API default.

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

Output item fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `sequence` | Yes | Monotonic number within one event result record. |
| `kind` | Yes | `progress` or `final` in the first slice. |
| `text` | Yes | Sanitized user-visible output. |
| `render` | No | `text` or `markdown`; default `text`. |
| `createdAt` | Yes | ISO-8601 creation timestamp. |

State enums:

| Model | Values |
| --- | --- |
| `status` | `received`, `filtered`, `duplicate`, `queued`, `steered`, `processing`, `completed`, `failed`, `expired` |
| `kind` | `progress`, `final` |
| `render` | `text`, `markdown` |
| future delivery status | `pending`, `sent`, `failed` |

Retention and bounds:

| Setting | Recommendation |
| --- | --- |
| default retention | 6 hours |
| progress retention | Store the latest bounded set, for example 20 entries. |
| text size | Bound and truncate with an explicit marker. |
| persistence | Persist result records across runtime restart until expiry. |

Action config contracts:

| Contract | Supported in first slice | Required per bot | Meaning |
| --- | --- | --- | --- |
| `actions.message.send` | Yes | No | Canonical provider outbound HTTP delivery action. Bots without it still write progress/final outputs to the result store. |
| `result.poll` capability | Yes | Yes | Polling result store is baseline API behavior. |
| top-level `outbound` | No | No | Do not add this in the first slice or short term; use `actions.message.send` if outbound exists. |

## Result Store As First-Class Behavior

Outbound `message.send` should not be required. If an API bot has no outbound
action configured, clisbot should still accept inbound events, process them,
record progress/final output in the result store, and expose that state through
polling APIs.

Implementation thinking: even though the first public surface is API bot only,
the storage primitive should live at shared channel level rather than inside
Chatwoot/API transport code. Slack, Telegram, and later channels may eventually
record the same processing/result state and then deliver through their provider
APIs. Do not expose those channels through result polling in this slice; just
avoid an API-only storage design that would need to be moved later.

This enables a simple programmatic integration:

1. Client POSTs an event.
2. clisbot quickly returns event acceptance plus a result URL.
3. Client polls the result URL.
4. During processing, clisbot records progress updates.
5. On completion, clisbot records the final result.

Proposed POST response:

```json
{
  "channel": "api",
  "botId": "acme",
  "eventId": "ticket-123",
  "status": "queued",
  "resultUrl": "/api/bots/acme/events/ticket-123/result",
  "expiresAt": "2026-05-30T09:30:00.000Z"
}
```

Proposed result response:

```json
{
  "channel": "api",
  "botId": "acme",
  "eventId": "ticket-123",
  "status": "processing",
  "progress": [
    {
      "sequence": 1,
      "kind": "progress",
      "text": "Checking ticket context.",
      "createdAt": "2026-05-30T03:30:02.000Z"
    }
  ],
  "result": null,
  "error": null,
  "expiresAt": "2026-05-30T09:30:00.000Z"
}
```

When complete:

```json
{
  "status": "completed",
  "progress": [],
  "result": {
    "sequence": 2,
    "kind": "final",
    "text": "Here is the answer.",
    "render": "markdown",
    "createdAt": "2026-05-30T03:31:10.000Z"
  }
}
```

Progress entries and the final result should use the same output item model.
First-slice output kinds:

| Output kind | Meaning | Where it appears | Terminal |
| --- | --- | --- | --- |
| `progress` | Intermediate user-visible update from the agent. | `progress[]` | No |
| `final` | Final user-visible answer for the event. | `result` | Yes |

Output item fields:

| Field | Meaning | Notes |
| --- | --- | --- |
| `sequence` | Monotonic output sequence within one event result record. | Use it to order progress and final outputs. |
| `kind` | Output item kind. | First slice: `progress` or `final`. |
| `text` | User-visible content. | Store sanitized text only. |
| `render` | Content format. | First slice: `text` or `markdown`; default `text`. |
| `createdAt` | Output creation timestamp. | ISO-8601 string. |

Do not add extra output kinds until a real consumer needs them. Errors belong
in the top-level `error` object, not as an output kind.

Future delivery tracking, if needed, should be added deliberately rather than
included in the first result shape. A local polling-only result does not need
`delivery.channel: "state"` because the response itself is already the state
delivery path. If provider delivery status is added later, consider either:

- folding delivery into each output item status, so progress and final messages
  can both report delivery state, or
- adding an action-scoped delivery object, for example
  `delivery.actions["message.send"].progress[sequence].status`

Do not add a final-only `delivery.status` unless progress delivery status is
also addressed; otherwise progress can fail silently while the final result
looks clean.

## Outbound Optionality

Decision: local result recording is mandatory; provider outbound delivery is
optional.

If `actions.message.send` is configured:

- `message send --channel api --bot <botId> --progress` writes progress to the
  result store and attempts provider delivery
- `message send --channel api --bot <botId> --final` writes the final result to
  the result store and attempts provider delivery
- outbound failures should not erase the stored progress/result

If no outbound action is configured:

- the same `message send` commands write only to the result store
- no HTTP delivery is attempted
- the command should not fail only because outbound delivery is absent

This keeps programmatic polling simple and makes outbound provider delivery a
capability, not a requirement.

## Retention

Recommendation:

- default result retention: 6 hours
- persist result records so runtime restart does not lose in-flight client
  polling state
- cap stored progress entries per event, for example last 20 progress updates
- cap stored text size per event and truncate with an explicit marker

Reasoning: the result store is for short-lived asynchronous clients and
debugging, not a long-term event archive. Do not add a retention upper-bound
config knob in this grill yet.

## Status And Optional Delivery Tracking

Keep processing state simple in the first result shape. Add provider delivery
tracking only after a real provider needs it.

`status` should describe clisbot processing:

| Status | Meaning | Terminal | Similar model |
| --- | --- | --- | --- |
| `received` | Auth, parse, and initial validation succeeded. | No | HTTP `202 Accepted` pending work |
| `filtered` | Event was intentionally ignored by configured filters. | Yes | Webhook ignored / no-op |
| `duplicate` | Event dedupe key was already seen. | Yes | Idempotent replay response |
| `queued` | Event is accepted but waiting behind the session queue. | No | Job queue pending |
| `steered` | Event was accepted as input into an already active run. | No | Appended input / control message |
| `processing` | Event is currently being handled by an agent run or linked run. | No | Job running |
| `completed` | Final result is available. | Yes | Job succeeded |
| `failed` | Processing failed; inspect sanitized `error`. | Yes | Job failed |
| `expired` | Result record aged out before the client fetched it. | Yes | TTL expired |

Do not include a top-level `admission` field in the core response. `status` is
the current lifecycle state. A response with `status: "processing"` and
`admission: "queued"` is technically explainable as "this event originally
entered through the queue and is now running", but it is confusing for clients.
If queue/debug context is needed later, expose it as optional metadata such as
`queue: { "position": 0, "enteredAt": "...", "startedAt": "..." }` or
`run: { "id": "...", "linkedEventIds": [...] }`, not as a second lifecycle
state.

If added later, delivery status should cover progress and final outputs, not
only the final result:

| Delivery status | Meaning | Similar model |
| --- | --- | --- |
| `pending` | Provider outbound action is configured but not settled yet. | Send pending |
| `sent` | Provider outbound action succeeded. | Send succeeded |
| `failed` | Provider outbound action failed; stored result may still be available. | Send failed |

Avoid `not_configured` in the core response. Absence of outbound action config
already means local result-store polling only.

Error model:

| Field | Meaning | Example |
| --- | --- | --- |
| `error.code` | Stable machine-readable reason. | `outbound_http_401` |
| `error.category` | Coarse bucket for dashboards and retry/fail-safe decisions. | `provider_auth` |
| `error.message` | Optional sanitized human-readable summary. | `Outbound provider request was rejected.` |

This avoids a false failure when the AI result exists but the provider HTTP send
failed, and it avoids requiring outbound config for polling-only integrations.

## Queue And Steering

Status remains event-scoped. If event B arrives while event A is processing on
the same surface:

- B gets its own result record
- B may be `queued`, `steered`, or `duplicate`
- if B is steered into A's active run, B should still eventually resolve to a
  terminal result record, likely linked to the same run result
- A's result record must not be overwritten by B

Implementation should record a stable internal run reference when available so
multiple event records can point at the same processing run without duplicating
run truth.

## Capability Model

Keep the first slice focused:

- inbound webhook event
- result polling
- local progress/final result recording
- supported but per-bot-optional `message.send` outbound HTTP action

Future capabilities should be declared, not inferred from body templates:

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

Recommended future interpretation:

- `result.poll`: client can query status/progress/result
- `message.send`: clisbot can deliver visible messages to provider
- `message.progress`: progress is available in result store and optionally
  delivered to provider
- `message.edit`: provider delivery can update an existing message
- `message.stream.chunk`: provider supports true streaming or chunk append
- `reaction.add`: provider supports reaction mutation

## Outbound Config Shape

Decision: standardize on named `actions` from the beginning.

Example:

```json
{
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
      }
    }
  }
}
```

Why:

- one extension model from day one
- `message.send`, `message.progress`, `message.edit`, `reaction.add`, and
  future actions share naming, validation, logging, and docs
- makes outbound optional cleanly: no `actions.message.send` means local result
  store only
- avoids a future migration from `outbound` to `actions.message.send`
- status/result can report action delivery by name, for example
  `delivery.actions["message.send"]`

Cost:

- slightly more verbose for the first Chatwoot case
- implementer must build a small action dispatcher earlier
- the word "action" can invite over-generalization if the first slice accepts
  arbitrary action names without capability checks

Superseded alternatives:

- Top-level `outbound` was shorter for exactly one send-message operation, but
  it creates two schema paths once actions arrive and makes "no outbound" mean
  either polling-only or misconfigured delivery.
- A shorthand that compiles into `actions.message.send` could improve authoring
  ergonomics, but it still creates two visible config shapes before the need is
  proven.

Make `actions.message.send` the canonical place for provider delivery, and make
it optional. Do not add top-level `outbound` in the API-channel contract. Keep
the config easy with complete examples and later CLI/template helpers, not by
adding a second schema path.

The first slice does not need a large action engine. It only needs:

- a closed set of accepted action names, initially `message.send`
- validation that undeclared action names are config errors
- `message send --progress/--final` always writes to the result store
- if `actions.message.send` exists, also attempt provider delivery
- if `actions.message.send` is absent, return success for local state recording
  without adding delivery fields to the core response

This keeps polling-only integrations simple and prevents action naming drift.

## Grill Questions

Question 1: Should the channel id be renamed from `webhook` to `api` now,
before implementation?

Recommendation: yes, rename now if polling/result-store behavior is first-class.
Changing after implementation would create migration pain across config, CLI,
docs, auth principals, status keys, and operator habits.

Question 2: Should `POST /api/bots/<botId>/events` become the canonical inbound
endpoint instead of `POST /webhook/bots/<botId>`?

Recommendation: yes for the renamed channel. Keep "webhook" as docs language
for provider setup, but not as the product endpoint namespace.

Question 3: Should every accepted event have a result record even when it is
filtered or duplicated?

Recommendation: yes for authenticated events after parse. Use `filtered` and
`duplicate` terminal statuses. Do not create records for auth failures.

Question 4: Should a steered event get its own final result record?

Recommendation: yes, but it may link to the same run result as the event it
steered. Programmatic clients should never poll forever after receiving
accepted.

Question 5: Should result polling be the baseline and outbound provider delivery
be optional?

Recommendation: yes. This gives a simple API-first integration path and keeps
Chatwoot-style outbound as an additional action capability.

Question 6: What is the retention default?

Recommendation: default 6 hours, bounded by count and text size. Do not add a
retention upper-bound config knob in this grill yet.

Question 7: If a programmatic API client needs to stop work, should stop be
surface-scoped or event-scoped?

Recommendation: support both, because they serve different integration modes.

Event-scoped stop:

```http
POST /api/bots/<botId>/events/<eventId>/stop
```

Use this when API clients submit an event, receive an `eventId`, and poll
`/events/<eventId>/result`. Stopping the same event resource is easier to
understand, easier to authenticate, and naturally idempotent. It also avoids
exposing `surfaceId` in URLs for the common event-tracking client.

Surface-scoped stop:

```http
POST /api/bots/<botId>/surfaces/<surfaceId>/stop
```

Use this when a chat-flow integration, such as Chatwoot, wants to stop whatever
is currently running for the conversation without knowing which event started
the run.

Keep the behavior simple and aligned with existing chat channels. Event stop:
if the event is `queued`, remove the pending item; if it is `processing`, trigger
the same interrupt behavior as chat `/stop` for that event's active run/session; if
the event is terminal, return `409 Conflict`; unknown or expired event ids
return `404`. Surface stop: if the surface has an active run, trigger the
same `/stop` behavior; if not, return `409 Conflict` or `404` depending on
whether the surface is known.

Question 8: Should progress be append-only or editable?

Recommendation: append-only in the result store for auditability and simple
polling. Provider delivery may later use edit/stream capabilities, but the
stored result should remain an ordered update list.
