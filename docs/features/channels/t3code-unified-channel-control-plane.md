# T3 Unified Channel Control Plane

- **Created**: 2026-08-12
- **Status**: Proposed; selected product direction, implementation not started
- **Selection**: unified distribution with isolated T3 and clisbot runtimes

## Outcome

`clisbot start` should launch the complete local product by default: clisbot
channel runtime, T3 orchestration server, and the integrated T3 web app with a
Channels section. Users who do not need the web app use:

```bash
clisbot start --mode headless
```

`headless` is a presentation/deployment mode, not a runner. It does not mean
tmux, ACP, or Claude. Both modes retain the T3 server/API needed by T3-backed
conversations; headless only omits the bundled web surface. Runner/provider
selection remains an independent agent or route decision.

A temporary `t3.enabled: false` compatibility gate may preserve a clisbot-only
deployment during rollout. It must not be overloaded onto `headless`.

## Goals

- one command and one product URL for normal local use
- a T3 Channels screen for clisbot connections, bots, surfaces, routes,
  workspaces, agents, access, sync, progress, and approval policies
- Slack/Telegram/Zalo thread input can create or continue a bound T3
  conversation
- T3 input can selectively sync back to a bound channel thread
- users can share one T3 message or a whole T3 conversation to an allowed
  channel target
- native T3 code-change and document-reading views remain available
- channel credentials and provider behavior remain clisbot-owned
- T3 changes stay feature-gated and small enough to sync upstream regularly

## Non-Goals

- replacing provider-native APIs with ACP
- flattening Slack, Telegram, Discord, and Zalo into identical OAuth behavior
- moving clisbot credentials into browser storage
- making the T3 web process the canonical clisbot config store
- treating T3 pairing as sufficient multi-user resource authorization
- importing the full T3 source tree into clisbot in the first implementation
- rewriting existing tmux or ACP routes before T3-backed routing is proven

## Runtime Shape

```text
browser
  |
  v
T3 web ------------------------------+
  | typed T3 transport               |
  v                                  |
T3 server/provider runtime           |
  | clisbot integration adapter      |
  v                                  |
clisbot local control API <----------+
  |
  +-- config/auth/credentials
  +-- channel runtime and delivery
  +-- surface routes and bindings
  +-- tmux/ACP runners for non-T3 routes
```

One launcher supervises two child-runtime boundaries. A single binary/process
is not required for a one-command product.

### Runtime ownership

| Concern | Owner | Consumer |
| --- | --- | --- |
| Slack, Telegram, Zalo, API connections | clisbot channels | T3 Channels UI |
| bot credentials and provider auth sessions | clisbot configuration/channels | T3 receives write-only status, never raw stored secrets |
| surface directory and provider capabilities | clisbot channels | T3 target picker |
| routes, agents, workspaces, sync policy | clisbot configuration | T3 Channels UI |
| app and agent roles for channel actions | clisbot auth | T3 adapter and channel runtime |
| T3 web session identity | T3 auth | identity bridge |
| T3 conversation, provider run, code changes, checkpoints | T3 | clisbot binding/event subscriber |
| external surface to T3 conversation binding | clisbot agents/routing | both runtimes |
| channel rendering and delivery receipts | clisbot channels | T3 event bridge |
| one approval decision | T3/provider execution owner | T3 UI and clisbot channel projections |

For T3-backed routes, clisbot keeps `sessionKey -> T3 conversationId` as the
continuity binding while T3 owns native conversation and run truth. This is an
extension of the current runtime architecture and remains gated on acceptance
of the linked proposed ADR. Existing tmux/ACP routes keep the current
`SessionService -> RunnerBackend` ownership.

## Start Modes

### UI mode — default

```bash
clisbot start
clisbot start --mode ui
```

Required readiness:

- clisbot runtime is healthy
- T3 server is healthy
- integrated web assets and Channels feature are available
- the tested clisbot/T3 compatibility pair matches

The command prints the URL and pairing/login guidance. It should not place a
pairing token in logs or automatically post one to a channel. Opening a browser
is a separate `--open` convenience; UI mode means the UI is served, not that a
browser is always forced open.

### Headless mode

```bash
clisbot start --mode headless
```

Required readiness:

- clisbot runtime is healthy
- T3 server/API is healthy when any T3-backed route is enabled
- no integrated web asset server or automatic browser launch is required

If no T3-backed route is configured, an implementation may defer the T3 server
in headless mode, but status must state that it is dormant and start it before
the first T3-backed route is admitted. Silent fallback to a different runner is
not allowed.

### Resolution and persistence

Resolve presentation mode in this order:

1. explicit `clisbot start --mode <ui|headless>`
2. `CLISBOT_MODE`
3. persisted `app.presentationMode`
4. `ui`

`--persist` may write the explicitly selected mode during first-run/bootstrap.
Existing automation that requires the old no-web behavior must add
`--mode headless` or persist it. This default change is operator-visible and
requires release notes and startup help updates.

## Channel-Control Resource Contract

The T3 UI edits resource-oriented clisbot APIs. Every mutable resource has an
`id`, `revision`, and `updatedAt`. Mutations include `expectedRevision`; stale
writes return a conflict and the UI reloads before retrying.

### `ChannelConnection`

One authenticated provider installation/account.

Core fields:

- `id`
- `provider`: `slack`, `telegram`, `zalo-bot`, `zalo-oa`, `zalo-personal`,
  `api`, or a registered future provider
- `displayName`
- `status`: `disconnected`, `connecting`, `ready`, `degraded`, `error`
- `capabilities`
- secret field status such as `configured` or `missing`, never the secret value

### `BotInstance`

One clisbot bot identity attached to a connection.

Core fields:

- `id`
- `connectionId`
- `displayName`
- `enabled`
- provider-specific non-secret settings
- default route, access, sync, progress, and approval policy references

### `SurfaceRoute`

One configured DM, group, channel, thread, or topic route.

Core fields:

- `id` using the existing human-facing surface vocabulary
- `botId`
- `surfaceId` and optional `parentSurfaceId`
- `agentId`
- `workspacePath` or workspace reference
- optional policy overrides

Slack `channel:<id>` remains compatibility input only; shared UI wording uses
the canonical `group` concept while showing provider-native labels to users.

### `ConversationBinding`

Maps one clisbot session/surface to one T3 conversation.

Core fields:

- `id`
- `sessionKey`
- `t3ConversationId`
- `originSurfaceId`
- `routeId`
- `createdBy`
- `syncPolicyId`
- last consumed T3 and channel cursors

Only one active binding may exist for a session key. Rebinding is explicit and
audited.

### `SyncPolicy`

Controls which direction and event types cross the boundary.

```json
{
  "inbound": {
    "channelUserMessages": true,
    "channelAttachments": true
  },
  "outbound": {
    "assistantFinal": true,
    "progress": false,
    "toolCalls": false,
    "toolResults": false,
    "permissionRequests": true,
    "usage": false
  },
  "maxProgressMessages": 3,
  "showConversationLink": true
}
```

Default policy sends user input inward, final answers outward, and actionable
permission requests outward. Raw tool calls, tool results, usage, and verbose
progress default off.

### `AccessPolicy`

Controls T3 conversation creation, viewing, sharing, and approval.

Core fields:

- `createConversation`: `admins`, `members`, or `disabled`
- `viewConversation`: `bound-participants`, `workspace-members`, or `admins`
- `shareMessage`: role list
- `shareConversation`: role list
- `approve`: role list
- optional explicit principal allow/block lists

The policy resolves at app, bot, and exact route levels. Exact route overrides
bot defaults; bot overrides app defaults. `disabled` and explicit blocks retain
the existing deny-before-run semantics.

### `ApprovalPolicy`

Core modes:

- `interactive`: authorized T3 or channel surface can decide
- `web-only`: only T3 renders decision controls
- `deny`: reject requests that require approval
- `auto-allow`: select an allowed approval option automatically

`auto-allow` is an administrator-only high-risk setting. Its configured scope
must say whether it can choose `allow-once` only or also `allow-always`. It is
clisbot/T3 policy, not an ACP field. The final decision payload sent to the
provider remains provider-contract data.

## Channels UI

The T3 sidebar adds `Channels` only when the feature flag is enabled and the
authenticated actor has channel-control read permission.

### Admin views

- Connections: add, reauthorize, disable, inspect health, remove
- Bots: create, enable, disable, and select provider connection
- Surfaces: load known channels/groups/topics according to capabilities; show
  manual target entry when listing is unavailable
- Routes: select bot, surface, workspace, agent, and policy overrides
- Access: assign users/principals to existing clisbot app and agent roles
- Delivery: edit sync categories, progress bounds, conversation link, and
  approval mode
- Diagnostics: show which runtime owns a failure and the last truthful health
  message

### Normal-user views

- share this message
- share or bind this conversation
- choose only targets visible to both the user's credential and bot policy
- open the bound external thread
- open a T3 link received in a channel after authenticating

Conversation URLs never include pairing credentials. A user who lacks access
sees an authorization flow, not the conversation payload.

## Identity And Roles

T3 pairing authenticates a client session. It does not by itself establish that
all sessions on a device belong to one person, nor that every paired session
may read every conversation.

The integration adds an identity bridge:

- one T3 authenticated actor maps to one local clisbot principal or local user
  record
- provider identities such as `slack:U...` and `telegram:...` may be linked
  explicitly; they are never merged by display name or email guess
- T3 admin capability maps to clisbot `owner` or `admin` only through an
  explicit bootstrap/grant
- app roles remain `owner`, `admin`, and `member`; agent roles remain `admin`
  and `member`
- new permissions cover channel connection management, route management,
  conversation creation/viewing, sharing, and approval decisions

Per-conversation ACL checks must execute on the T3 server, not only by hiding
UI controls. clisbot still enforces route and channel admission before a
channel message reaches the provider.

## Provider-Specific Setup

### Slack

Admin setup installs the Slack app/bot and stores the bot credential in
clisbot. Optional user OAuth is a separate credential used only for user-scoped
channel discovery or “send as me” sharing when explicitly enabled.

The picker shows only the intersection of:

- targets visible to the chosen user credential, when used
- targets where the bot can post
- targets allowed by clisbot policy

Private channels may still require a human invitation. “Add bot” must show the
provider action or exact manual instruction; it must not claim success before
Slack confirms membership.

### Telegram

A Bot API credential cannot list every chat available to a logged-in user and
cannot add itself to a group. Known groups/topics come from configured routes,
the surface directory, or admitted inbound updates. The UI supports manual id
entry and explains that an admin must add the bot.

Telegram Login Widget identity is not a replacement for Bot API channel
authorization. A Telegram personal/userbot flow is out of scope unless added
as an explicitly separate high-risk provider.

### Zalo

`zalo-bot`, `zalo-oa`, and `zalo-personal` remain different connection types
with different credential, discovery, and warning flows. The UI renders from
declared capabilities and does not promise a generic Zalo OAuth path.

### Other providers

Discord can later use OAuth2 user/guild discovery plus a distinct bot install.
OpenClaw registers here only when it implements the channel integration seam;
an OpenClaw execution backend registers as a runner instead.

## Bidirectional Event Flow

### Channel to T3

1. channel runtime receives and authenticates the provider event
2. existing admission and route policy runs
3. clisbot resolves or creates the `ConversationBinding`, subject to
   `createConversation`
4. clisbot submits the message with source event id, principal, surface, and
   attachment references
5. T3 appends it to the bound conversation and starts or queues the provider
   turn
6. clisbot subscribes to resulting events for outbound delivery

### T3 to channel

1. a user submits in the T3 conversation
2. T3 records the event and provider run
3. the integration bridge emits normalized conversation events
4. clisbot applies `SyncPolicy`, channel capability, and delivery bounds
5. clisbot renders provider-native output and records the delivery receipt
6. retries reuse the same event/delivery id

Message origin is preserved so an event delivered to Slack is not ingested
back into T3 as a new user message.

## Progress And Tool Events

Event categories are independently configurable:

- user input
- assistant final
- progress/status
- tool call
- tool result
- permission request/decision
- usage/cost
- system error

`maxProgressMessages` bounds append-only progress. On editable surfaces,
clisbot may reconcile several updates into one live message. Tool calls default
to summarized and off for external channels; secrets, command environment, and
large payloads are sanitized before policy evaluation and rendering.

## Distribution, Packages, And Upstream Workflow

The selected artifact model, three-package analysis, maintained-fork workflow,
feature flag, upstream sync, and subtree/submodule tradeoffs are part of this
feature contract in [T3 Source Integration And Release Workflow](t3code-source-integration-workflow.md).

## Persistence

Do not add a second config authority.

| Data | Durable owner |
| --- | --- |
| connections, bots, routes, policies | existing clisbot app config through config-owned mutation APIs |
| channel secrets | existing clisbot credential files/stores with owner-only permissions |
| clisbot app/agent role bindings | clisbot auth config |
| `sessionKey -> T3 conversationId` | clisbot session continuity storage, after schema review |
| T3 conversation/run/checkpoint data | T3 storage |
| channel event idempotency and delivery receipt | existing clisbot channel-owned stores where lifecycle matches |

Before changing the session or channel stores, implementation must update the
persistence inventory with schema, concurrency, retention, migration, and
independent-store test evidence.

## Failure And Status Contract

`clisbot status` must separately report:

- launcher/supervisor
- clisbot runtime
- T3 server/API
- T3 web assets or `headless`
- configured provider health
- compatibility manifest and active T3 revision
- channel connection health

UI-mode startup must not report healthy when the web or T3 server failed.
Channel delivery failure remains observer-local and does not redefine a T3 run
as failed. T3 provider failure must not be mislabeled as Slack or Telegram
failure.

## Security Requirements

- bind the integrated product to loopback by default
- require explicit trusted-network configuration for remote access
- never emit pairing credentials in channel links, logs, or normal status
- keep secrets write-only from the browser after initial submission
- use short-lived, audience-bound service credentials between T3 and clisbot
- enforce permissions server-side on every mutation and conversation read
- record actor, resource, prior revision, outcome, and timestamp for sensitive
  connection, role, sharing, and approval mutations
- keep `blockUsers` and disabled-surface behavior stronger than admin
  convenience

## Delivery Slices

| Slice | Scope | Exit evidence |
| --- | --- | --- |
| F0 | maintained fork, feature flag, versioned compatibility manifest, launcher spike | T3 passes flag-on/off startup; one command reports both runtimes |
| F1 | read-only Channels inventory and health | T3 UI matches clisbot CLI/config truth without exposing secrets |
| F2 | revision-aware connection, bot, route, workspace, and agent mutations | stale-write, auth, migration, and cross-process tests |
| F3 | Slack inbound creates/continues T3 conversation; link rendering | shared test channel transcript and restart/resume evidence |
| F4 | T3-to-Slack final answer sync and manual message/conversation share | retry, dedupe, loop-prevention, ACL evidence |
| F5 | bounded progress, tool summaries, and cross-surface approval | one idempotent decision from T3 or Slack; timeout/late-click tests |
| F6 | Telegram and Zalo capability-driven setup/sync | provider-specific discovery/add-bot behavior and live test evidence |
| F7 | default UI release and documented headless mode | install, update, rollback, UI/headless, offline-cache, and status evidence |

## Acceptance Criteria

- `clisbot start` serves a usable integrated T3 UI by default
- `clisbot start --mode headless` runs without serving/opening the web app
- one Slack thread maps to one T3 conversation across restart
- one T3 conversation can sync final answers to its bound Slack thread without
  echo loops or duplicates
- policy can independently toggle final, progress, tool, approval, and usage
  event delivery
- progress output respects `maxProgressMessages`
- unauthorized users cannot create, view, share, configure, or approve beyond
  their effective role
- channel links never disclose pairing tokens
- T3 feature-off behavior remains upstream-like
- a tested upstream T3 sync can be adopted by changing one pinned revision

## Related Docs

- [Research: T3 Code And clisbot Unified Product Options](../../research/channels/2026-08-12-t3code-clisbot-unified-product-options.md)
- [T3 Source Integration And Release Workflow](t3code-source-integration-workflow.md)
- [Proposed T3 Unified Distribution Boundary](../../architecture/decisions/2026-08-12-t3-unified-distribution-boundary.md)
- [Web Chat Channel Architecture](2026-07-03-web-chat-channel-architecture.md)
- [Authorization](../auth/README.md)
- [Configuration](../configuration/README.md)
- [Runtime Architecture](../../architecture/runtime-architecture.md)
- [Persistence Store Inventory](../../architecture/persistence-stores.md)
