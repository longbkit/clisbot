# Channel slash commands — gap audit & implementation plan

Date: 2026-09-07
Status: implemented on 2026-09-08. Validation scope and remaining limitations are
recorded below. Behavior spec is
[README.md](README.md); end-user copy is [user-guide.md](user-guide.md).

## Implementation status (2026-09-08)

The implementation now includes the registry and generated help, org Access and
Guest gating, identity/status/cowork output, session lifecycle, direct turn
control, grant-bounded configuration, skills and per-account dynamic commands.
Handlers are extracted into `commands-dispatch.ts`, `commands-config*.ts`, and
`commands-lifecycle*.ts`; the existing `execution.ts` retains orchestration.

| Area                              | Implemented behavior                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry and native normalization | Shared command metadata, generated help, aliases and whole-message grammar; adapters normalize into the same parser.                                                                                      |
| Info and cowork                   | Access-aware private output. `PASEO_HUB_APP_WEB_URL` selects the web app origin; otherwise links use `paseo://`.                                                                                          |
| Lifecycle                         | `/new <message>`, authorized atomic `/resume`, transcript fork and auto-archived one-offs. Failed fork attachment/send restores the old binding; same-Agent resume preserves the current stream.          |
| Turn control                      | `/steer` and in-memory FIFO `/queue`, with release-time access and running-state checks.                                                                                                                  |
| Configuration                     | Grant-bounded catalogs and profiles; same-provider edits apply live, different-provider selections remain staged until `/new` or `/fork`.                                                                 |
| Access and dynamic commands       | Guest `(guest, guest)`, Guest administration UI, conversation visibility, unattended-mode checks, and account-scoped command persistence.                                                                 |
| Automation                        | Authorized run/step status and cowork links across the run's Hosts; stop checks each target and settles stopped runs as failed with reason `channel_stop`. Direct-only commands refuse automation routes. |
| Mutation replay                   | Durable receipts consume duplicate native message IDs. Pending receipts are never reclaimed automatically.                                                                                                |

### Verification evidence

The final focused regression gate passed **144 tests with 1 existing skipped test**
across `commands.test.ts`, `commands-extension.test.ts`, `commands-config.test.ts`,
`execution/execution.test.ts`, `bindings/bindings.test.ts`,
`db/channel-command-selection.test.ts`, and `workflows/channel-stop.test.ts`.
It covers addressing, configuration authority, multi-Host automation output,
creation, binding isolation, durable command receipts and workflow stop.

Earlier focused passes also covered lifecycle rollback and acknowledgement failure,
queue release, Guest isolation, daemon RPCs, native Discord/Google Chat/Feishu
adapters, and **14 App Access tests**. These overlapping runs are not summed into a
unique test count. The final execution skip is the existing local-media relay test.

Hub TypeScript checks passed for Node, the Start app and E2E sources. App,
Discord, Google Chat and Feishu TypeScript checks passed. Targeted lint passed
on **53 files**. `npm run db:check --workspace=@getpaseo/hub` passed with no schema
or generated-migration drift, and the final diff passed whitespace checks.

The existing database migration canary
`src/db/migrations.test.ts` → “a pre-0065 channel database migrates to latest”
reported a Telegram configuration expectation mismatch: the canary expects nested
`cfgAccount.config.apiRoot`, while the current adapter emits `cfgAccount.apiRoot`. This unrelated
baseline failure is not counted as a passing gate or hidden by the focused
command results.

**No live channel E2E, external native registration, or real-provider session
loop was run for this implementation.** Unit tests and migrated embedded-store
checks verify local contracts; they do not establish production transport delivery.

Implementation decisions that resolve earlier contradictory prose:

- **Provider changes stage before minting.** The README's explicit promise that
  `/fork` carries context into a staged provider takes precedence over the older
  phase-4 wording that immediately released the binding. Ordinary messages keep
  driving the existing session until `/new` or `/fork` applies the selection.
- **Authorize the effective live configuration.** Returning a staged selection to
  the still-running provider preserves its mode, provider options and feature
  values where the daemon keeps omitted values. Validation checks that merged
  configuration. `fast_mode: true` requires the separate `agent.fast.use`
  privilege for profile discovery/application, live edits, minting and resume;
  unattended features retain their approval-privilege checks.
- **Private ordinary-text replies use DMs on all channels.** Slack/Discord
  ordinary messages do not contain native interaction tokens for ephemeral
  responses. The private-output invariant is retained; no public fallback.
- **Subscribe before first prompt.** Fork/one-off creation is idle, stream
  subscription is awaited, then the first message carries the `chat_history`
  attachment. Sending `initialPrompt` during creation would race attachment.
- **Resume is bounded.** Access to the target, project/configuration constraints,
  atomic compare-and-swap, and refusal of an Agent bound in another conversation
  prevent rebinding from exposing unrelated session history. A resumed external
  session on a tool-output route records a relay-output override. The override
  enables final-answer relay. Same-Agent resume preserves the existing stream;
  failed replacement attachment/first-prompt delivery rolls the binding back via
  compare-and-swap without canceling the source Agent. One-offs also enable their
  explicit answer without changing the route's normal answer-sync policy.
- **Transient means transient.** Queue holds and one-off reply associations are
  cleared on detach/Hub stop. They are separate from the durable ingress queue.
  Queue release rechecks access and current Agent state; the existing wire has
  no atomic send-only-if-idle operation, so an independent client can still start
  a turn after that check. The send uses steer to avoid canceling that turn.
- **Mutation dispatch is at most once per native source message.** A durable
  receipt is claimed before dispatch and completed with the result. A crash or
  uncertain RPC can leave it pending; pending receipts are never automatically
  reclaimed because the mutation may already have reached the daemon. Operators
  inspect the session before intentionally issuing a new source message. Read-only
  discovery does not claim mutation receipts; messages without a native message
  ID cannot use this receipt guarantee.
- **Existing orchestration size exception.** `execution.ts` already exceeds the
  file-size guideline. This change extracts command handlers and reduces its
  command logic; splitting unrelated orchestration is outside this change.

The audit below records the **2026-09-07 baseline**, before this implementation.
Its line numbers and descriptions of missing code are historical evidence.
The README and the status above describe the current behavior.

This plan takes the current channel command layer to the full
vocabulary in the reference table, as **shared platform code** across every
channel, and answers the specific problems raised: Slack/Discord/Google Chat
native-command conflicts, Telegram/Feishu addressing quirks, agent-command
collisions, and steer/queue across the channel→automation layers.

## Native adapter delivery

Discord startup upserts one `/paseo` application command with the optional text
option `command`; it does not replace other application registrations. The
interaction listener converts the selected subcommand to `/verb`, admits the
normalized event durably, then acknowledges the native interaction privately.
Interaction tokens are not persisted. The Hub's command-output privacy rules
apply separately from this transport acknowledgement.

Google Chat normalizes native `SLASH_COMMAND` payloads or command annotations,
including the configured `/paseo` umbrella, into the shared vocabulary and marks
them addressed. An operator must register the single `/paseo` command in the
Google Chat console; the adapter does not register it through an API. Feishu's
native `@all` exclusion is regression-tested. Native adapter tests do not replace
live registration and delivery checks; no such live checks ran in this change.

## Original baseline (2026-09-07)

- **Shared parser; `/agent` and `/model` already take an argument.**
  `packages/hub/src/channels/commands.ts` parses `status | stop | new | help |
agent <name> | model <name>` (`ChannelTextCommand`, `commands.ts:47`) plus
  `approve|deny`, with aliases; `ARGUMENT_COMMANDS` = {agent, model} read a
  trailing value, other verbs are whole-message only (`^\s*[/\\]?\s*([a-z]+)\s*$`,
  `commands.ts:169`). There is no general command **registry** yet — a new verb is wired by hand in several spots.
- **Cross-channel normalization already lives in the parser.** `stripMentions`
  (`commands.ts:102`) handles Slack `<@U…>`, the `\` backslash form, Telegram
  glued/spaced/doubled `@bot` and the `/cmd@bot` autocomplete suffix. Slack native
  `slash_commands` events are rewritten to `/word` before parsing
  (`execution.ts:645`).
- **Dispatch seam.** `ChannelPlane.onInbound` (`execution.ts:229`) →
  `normalizeInbound` → `readInboundKind` → identity-link command
  (`parseChannelIdentityLinkCommand`, `execution.ts:272`) → approval command
  (`execution.ts:276`) → `resolveTextCommand` (`execution.ts:280`) → route
  admission (`resolveInboundRoute`, `execution.ts:286`) → `handleTextCommand`
  (`execution.ts:299`, impl `:1135`) or `handleAgentMessage` (`:310`).
- **Command execution is direct daemon RPC.** `/status` reads
  `daemon.listAgents()` + in-memory open prompts; `/stop` calls
  `daemon.cancelAgent(agentId)`; `/new` cancels, `releaseThreadBinding` (deletes
  the row), then re-mints on the next message (`execution.ts:1194–1251`, `:662`).
- **`/agent` / `/model` ship as a closed-menu switch that re-mints.**
  `selectionMenu`/`resolveSelection` (`policy/selection.ts`) offer only the route's
  own agent + `route.selectable.agents`/`.models`; the choice persists via
  `store.access.setConversationSelection` (`selectedAgent`/`selectedModel`), then
  `endBoundSession` ends the session so the next message re-mints on the new target
  (`execution.ts:1262`), and the create path reads the selection
  (`execution.ts:1396`). Because the current code fixes provider+model at create
  time, this re-mint loses the session's history.
- **The daemon supports live config edits the channel doesn't use yet.**
  `set_agent_model_request`, `set_agent_thinking_request`, `set_agent_mode_request`,
  and `agent.config.apply.request` (`packages/protocol/src/messages.ts:1843`) are
  what the app uses to change model/effort/mode between turns; the daemon rejects a
  cross-provider model. Only provider is truly create-time (no `set_agent_provider`).
  The channel `DaemonConnection` facade (`daemon/client.ts:39`) exposes none of them
  — it has `createAgent`, `sendAgentMessage`, `cancelAgent`, `listAgents`,
  permission, timeline.
- **Binding.** `thread_bindings` (`schema.ts:1946`, `ThreadBindingRecord`,
  `db/types.ts:1686`) links a conversation key to `agentId`/`daemonId` and stores
  an immutable `route` revision pin (`StoredRouteSummary`). No mutable
  settings/override column.
- **No per-conversation config store.** The only durable, per-account mutable
  store separate from the revision is the keyed store
  (`packages/hub/src/channels/state/keyed-store.ts`, mounted per account at
  `supervisor/index.ts:911`), used today for Telegram offsets, send-dedupe, and
  `conversation-metadata`.
- **Direct vs automation branch.** `route.target.kind` (`"agent" | "workflow"`,
  `config/compile.ts:111`). One common admission (`resolveInboundRoute` +
  `routeExecutionLimiter.admit`, `execution.ts:286`, `:824`); the split is in
  `handleAgentMessage` (`execution.ts:845`) and mirrored in `conversationAgentFor`
  (`execution.ts:1405`) for command targeting.
- **Command gating is the channel actor-role model.** `resolveChannelActorRole`
  (`policy/roles.ts`) → `owner` (session initiator or `*`) / `admin` (holds any
  `approval.*` on the route) / `member` / `guest`; `CHANNEL_COMMAND_ROLE` sets each
  verb's floor (help=guest, status=member, stop/new=owner, agent/model=admin) and
  `mayRunChannelCommand` refuses an unlisted verb. These roles are a documented
  **projection** over the Hub's control-plane privilege model (`policy.ts`:
  `bot.interact` / `approval.*` + config-file `controlPlane.roles`), **not a second
  RBAC** (`roles.ts` header) — so within the channel plane they are the intended
  long-term gate, not a stopgap. `mayUseChannel`/`mayTrigger` (`policy.ts:392`,
  `execution.ts:1267`) is the "may act at all" floor. The org Access model
  (`access/contract.ts`, `channelIdentities`, `authorizeChannelPrivilege`) reuses the
  same `approval.*` names and has channel hooks, but is a separate vocabulary used
  elsewhere; the decision (see [Resolved decisions](#resolved-decisions)) is to move
  channel command gating **to org Access**. Private replies already exist: `ephemeral`
  (Slack/Discord) and the `initiatorOnly` command pattern (`policy.ts:427`,
  `approvals/harness.ts:59`).
- **Deep link exists.** `buildAgentDeepLink` →
  `paseo://h/<serverId>/agent/<agentId>`, `buildAgentDeepLinkRoute` → the same
  path (`packages/protocol/src/agent-deep-link.ts`); the app/web SPA serves that
  route (`app/h/[serverId]/agent/[agentId].tsx`). There is **no** universal
  `https://` link and no Hub web agent page.
- **Fork and mode-list already have RPCs.** `buildAgentForkContext(agentId)` returns
  a `chat_history` attachment (host feature `agentForkContext`), and
  `create_agent_request` accepts `attachments`, `initialPrompt`, and `autoArchive`
  (`packages/protocol/src/messages.ts:1654`) — the app's fork
  (`packages/app/src/hooks/use-fork-agent.ts`) is exactly this. `list_provider_modes_request`
  / `list_provider_models_request` / `list_available_providers_request`
  (`messages.ts:1683`) back the `list`/`search` reads. None are exposed by the
  channel `DaemonConnection` facade yet.
- **Agent profiles exist in daemon config.** `agentProfiles` (`AgentProfileSchema`
  — provider / model / modeId / thinkingOptionId / featureValues / notes,
  `messages.ts:162`) ride on `server_info` behind the `agentProfiles` host feature;
  applying one is a field-for-field copy onto the agent. The channel doesn't surface
  them yet — shipped `/agent` switches route `selectable` agents, not profiles.

## Gap summary

| Need                                                                | Have                                                                | Gap                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~20 commands with arguments and sub-commands                        | 6 verbs; args on `/agent` `/model`                                  | Sub-command/search grammar + a command **registry** (metadata: name, aliases, args, privilege, route-kinds, handler)                                                                                          |
| Generated help / discovery, `search`                                | one static help string                                              | Help + `list`/`search` render from the registry                                                                                                                                                               |
| Per-conversation config: model/effort/mode live, provider on `/new` | `/agent`/`/model` ship (re-mint); selection store + live RPCs exist | Expose `set_agent_*`/`agent.config.apply` in the facade; apply live when provider unchanged; add `/provider` `/effort` `/permission` (scoped, qualified, confirm-triple); extend the existing selection store |
| `/cowork` link, private in public convos                            | deep-link builder only                                              | Web-origin config to emit an `https://` link; wire `ephemeral`/`initiatorOnly`                                                                                                                                |
| `/resume <id>`, `/new <message>`                                    | `/new` only                                                         | Rebind to a given agentId; first-prompt on mint                                                                                                                                                               |
| `/stop` cancels an automation run                                   | cancels the direct agent turn                                       | Resolve + cancel active Workflow run(s) for the route                                                                                                                                                         |
| `/steer`, `/queue`                                                  | steer exists via `sendAgentMessage`; no channel command             | Direct-route commands mapping to steer / client-side hold                                                                                                                                                     |
| `/skill`, `/command` list/search; dynamic `/command add`/`remove`   | none                                                                | Read agent skills/commands; a dynamic-command store + pass-through                                                                                                                                            |
| `/fork`, `/side`, `/quick` (fork / one-off sessions)                | fork + attach RPCs exist, not exposed                               | `buildAgentForkContext` + create `attachments`/`initialPrompt`/`autoArchive` in facade; transient reply routing for one-offs                                                                                  |
| `/permission` (mode list/set)                                       | `list_provider_modes` + `set_agent_mode` exist                      | Expose both in the facade; gate unattended modes on `approval.*`                                                                                                                                              |
| `/me`, richer `/status`                                             | identity-link command exists; basic `/status`                       | Read Member/access for `/me`; add link + context-left to `/status`                                                                                                                                            |
| Access-gated commands                                               | org Access + channel hooks exist; no Guest subject                  | Gate each verb via `authorizeChannelPrivilege`; add the **Guest** subject to org Access; wire `/cowork` private reply                                                                                         |

## Concerns raised, and how this plan answers them

### 1. Shared, common handling across channels

Keep the boundary the repo already chose and the 2026-08-29 audit endorses: **one
shared parser and vocabulary; per-channel adapters only normalize native/mention
forms down to plain text.** The growth from 4 to ~20 commands is exactly the
trigger that audit named for centralizing metadata. Replace the ad-hoc union with
a **command registry**: each entry declares name, aliases, argument shape,
minimum access, applicable route kinds, and a handler. The parser, `/help`,
`list`, and `search` all derive from it, so adding a command is one entry, not
edits in five places. This is PaseoClaw-owned code in `packages/hub/src/channels/`
and stays out of upstream Paseo files.

### 2. Slack / Discord / Google Chat native-command conflicts

These channels require **pre-registering** each command (Slack manifest, Discord
`application.commands`, Google Chat console `commandId`) and collide with reserved
or team-owned names. Registering ~20 evolving commands per channel is per-channel
setup that drifts. Do not. Register **one umbrella command per channel** (`/paseo
<sub>`, already the Slack pattern in `commands.ts`) whose payload is rewritten to
the plain-text form before the shared parser; keep the `\` backslash spelling as
the conflict-free fallback. Same recipe for Discord and Google Chat when their
verticals wire native commands; until then, mention + plain text already works.

### 3. Telegram / Feishu addressing quirks (and the general rule)

Telegram groups have no slash-command API; mobile glues `@bot/status` and
autocomplete appends `/status@bot`; Feishu has no slash menus and treats `@all`
as not-addressed. The general rule that fixes all of them at once: **never rely on
a channel's native command detection — normalize addressing (mention, prefix,
glue) down to plain text in the shared parser, and match the whole message.** The
current `stripMentions` already covers the Slack/Telegram forms; extend it as new
channels land (Feishu `@all` exclusion, Discord/Google Chat rewrite) so no channel
needs its own command logic. This closes the class of "petty" per-channel bugs
rather than patching them one by one.

### 4. Invoking an agent's own skill/command without conflict

Fixed precedence, no guessing (spec: [README](README.md#platform-commands-vs-the-agents-own-commands)):

1. A whole message equal to a platform command runs it (closed, documented set).
2. `/skill <name>` and `/command <name>` are the explicit doors to the agent's
   skills and dynamic commands, so a shared name is still reachable.
3. Anything else — any `/word` not in the set — passes through to the agent as an
   ordinary prompt, unchanged (today's fallthrough behavior).

A platform reserved word can't be shadowed by an agent skill, and an agent skill
can't be swallowed by the platform.

### 5. Queue/steer across the channel→automation layers

The honest, minimal answer: **commands act on the binding's execution owner, and
there are two owners.** A **direct** route binds one long-lived agent session —
steer/queue/stop/config all target it. An **automation** route starts a new
workflow run per inbound (2026-09-02 audit), so there is no single turn to steer
into and no single config to set. In v1, steer/queue/session-lifecycle/config are
**direct-only**; on an automation route they return "not available on an
automation route" (loud, not silent). What applies to automation is run-scoped and
read-only: `/stop` cancels the active run(s) for the route (the audit already
scopes `/status` and `/stop` to active Workflow executions), `/status`/`/cowork`
report/link the running agent, `/me`/`/help` always work. Build the direct case
first — the branch already exists at `conversationAgentFor` (`execution.ts:1405`).
Extending steer/queue to workflow runs is a later, separate design, not a v1
crutch.

### 6. Other issues surfaced by this audit

- **Live re-model beats the current re-mint.** `/agent`/`/model` re-mint today
  (`endBoundSession`); the daemon instead supports live edits via
  `set_agent_model_request` / `set_agent_thinking_request` / `set_agent_mode_request`
  / `agent.config.apply` (what the app uses), so a same-provider model/effort/mode
  change should apply live with no lost history. Only a **provider-changing**
  `/agent` switch must re-mint (no `set_agent_provider`). Zero daemon diff — the
  daemon already handles these; the change is Hub-side facade methods.
- **Gating = the shipped channel role model.** Per-command authority is
  `resolveChannelActorRole` + `CHANNEL_COMMAND_ROLE` (owner/admin/member/guest,
  `policy/roles.ts`), with `mayUseChannel`/`mayTrigger` as the "may act at all"
  floor. New verbs just add a `CHANNEL_COMMAND_ROLE` entry. The org Access grant
  model is a separate layer, not the channel command gate.
- **No universal https link.** `/cowork` can emit `paseo://…` today; an
  `https://<origin>/h/<serverId>/agent/<agentId>` link needs the app's public web
  origin — resolved below to an instance-level `appWebUrl`, `paseo://` fallback.
- **`/command add` needs a store + pass-through.** Dynamic commands are the
  largest new surface: a store of `name → prompt` plus expanding `/name` into the
  stored prompt before it reaches the agent. Scope resolved below to the channel
  account. Treat as its own phase.
- **`/status` context vs quota.** The channel `AgentSnapshot` exposes
  title/provider/model/status/cwd, but `contextWindowUsedTokens`/`…MaxTokens`
  already ride the wire (`packages/protocol/src/messages.ts:425`) — declaring them
  on the channel `AgentSnapshot` gives context-left with zero daemon diff. Quota
  needs the separate `provider.usage.list` RPC and is provider-specific, so it is
  deferred; copy promises context-left only.

## Design decisions

- **Command registry** in `packages/hub/src/channels/commands.ts` (or a new
  `commands/` folder if it crosses the 500-line file target): typed entries with
  `{ name, aliases, args, privilege, routeKinds, handler }`. Parser, help,
  `list`, `search` derive from it. Keep functions ≤50 lines (PaseoClaw limits).
- **Argument grammar.** Extend the whole-message match to `verb + rest`, then
  per-command arg parsing (id, keyword, free text). Preserve "whole message only"
  so mid-sentence words never trigger.
- **Config apply: live over re-mint.** Today `/agent`/`/model` re-mint
  (`endBoundSession`). Enhancement: when the provider is unchanged, apply
  model/effort/mode **live** via facade methods over `set_agent_model_request` /
  `set_agent_thinking_request` / `set_agent_mode_request` / `agent.config.apply`
  (zero daemon diff); only a provider-changing `/agent` switch re-mints. Persist the
  choice by **extending the existing selection store**
  (`store.access.setConversationSelection`) with effort/mode, so it stays sticky and
  layers over the route default at the next mint — no new store.
- **Provider → model → effort is one hierarchy.** List commands scope to the level
  above (`/model` = the current provider's models, `/effort` = the current model's
  levels), and lists are bounded by the caller's `AgentConfigurationGrant`;
  `list`/`search` qualify ambiguous names as `provider/model`; a set outside the
  current provider/model — or outside the grant — is refused; every set confirms the
  resolved triple. This is the anti-confusion contract for the config commands, so
  provider/model/effort are never mixed across providers.
- **`/agent` applies an agent profile.** Read `agentProfiles` from `server_info`,
  filter to profiles whose provider/model fall inside the caller's
  `AgentConfigurationGrant` (org Access), then apply via the config path —
  model/mode/thinking live, a different provider re-mints. This reshapes the shipped
  route-`selectable` switch: the **per-user grant** is the bound. `/agent` = preset;
  `/provider`/`/model`/`/effort`/`/permission` = single axes.
- **Gating = org Access privileges.** Each command requires a privilege from
  `ACCESS_PRIVILEGES` (`access/contract.ts`), checked with `authorizeChannelPrivilege`
  after resolving the sender to a Member via `channelIdentities`: `/status`,
  `/cowork`, `/steer`, `/queue`, `/skill`, `/command` (list/search), `/agent`,
  `/model`, `/provider`, `/effort`, `/permission` = `agent.interact`; `/new`,
  `/resume`, `/fork`, `/side`, `/quick` = `agent.create`; `/command add`/`remove` =
  `approval.config`; an unattended `/permission` mode = the matching `approval.*`;
  `/approve`/`/deny` = the open prompt's authority; `/help`/`/me` = public. An
  **unlinked** sender acts as the **Guest** group. This replaces the control-plane
  role projection (`CHANNEL_COMMAND_ROLE`) as the gate.
- **Private replies** reuse the `ephemeral` route option (Slack/Discord) and the
  `initiatorOnly` command pattern (`policy.ts:427`) for identity/link/config
  output in public conversations.
- **Deep link** via `buildAgentDeepLink` / `buildAgentDeepLinkRoute`
  (`packages/protocol/src/agent-deep-link.ts`); prepend an instance-level app web
  origin (`appWebUrl`, same pattern as `RuntimeConfiguration.publicUrl()` /
  `publicBaseUrl`) for the https form, else emit the `paseo://` link.
- **Dynamic commands** live in a Hub DB table keyed by `(org, channel, accountId,
name)` — shared, listable account config, not transient keyed-store state.
  `add`/`remove` need `approval.config`; a name equal to a platform reserved word
  is rejected. Dispatch gains one step before passthrough: platform command →
  `/skill`,`/command` doors → account dynamic-command lookup → agent passthrough.
- **Fork & one-off sessions.** `/fork`/`/side` call `buildAgentForkContext` for a
  `chat_history` attachment, then `create_agent_request` with it + the message as
  `initialPrompt`; `/quick` skips the attachment. `/fork` rebinds; `/side`/`/quick`
  create `autoArchive` sessions, route the single reply back through a transient
  in-memory association (agentId → conversation + requester), and leave the binding
  untouched. The forking pair is gated on the `agentForkContext` host feature.
- **Modes = `/permission`.** List via `list_provider_modes_request`, set live via
  `set_agent_mode_request`. Setting an `isUnattended` mode requires the matching
  approval privilege (`APPROVAL_PRIVILEGES`), since it can suppress prompts.

## Original phased delivery and acceptance criteria

Each phase is independently shippable behind the existing channel feature gating
and leaves both the base Paseo experience and unmodified-client pairing intact.

**Phase 0 — Registry + argument grammar + generated help.** Convert the parser to
a metadata registry; add `verb + rest` parsing; generate `/help`. No new command
behavior yet. Tests: parser table (every alias, every addressing form, whole-
message-only) extend `commands.test.ts`.

**Phase 1 — Info & cowork.** `/me`, enrich `/status` (binding, link, access,
context-left from the wire fields; quota deferred), `/cowork` with the deep link +
`appWebUrl` + private reply. Requires: `/help`·`/me` public, `/status`·`/cowork` =
`agent.interact`. Tests: privilege gating (linked vs Guest), public-vs-DM reply routing.

**Phase 2 — Session lifecycle.** `/new <message>` (first prompt on mint),
`/resume <id>` (rebind to an existing agentId), `/stop` extended to cancel the
active automation run(s). Requires: `agent.create`. Tests:
rebind replaces prior binding; automation `/stop` cancels only the route's runs.

**Phase 3 — Turn control (direct).** `/steer` → `sendAgentMessage(steer)`,
`/queue` → client-side hold released on turn end. Automation route returns the
"not available" message. Tests: steer reaches the running turn; automation refusal.

**Phase 4 — Agent config (direct).** Extend the shipped `/agent`/`/model` switch
with `/provider`, `/effort`, `/permission`, and `list`/`search` on
`/provider`/`/model`; make same-provider changes apply live. Reads:
`list_available_providers` / `list_provider_models` / `list_provider_modes`.
Writes: facade methods for `set_agent_model`/`set_agent_thinking`/`set_agent_mode`/
`agent.config.apply`; extend `store.access.setConversationSelection` with
effort/mode. A `/provider` change (or a cross-provider `/agent`) re-mints and resets
model+effort to that provider's defaults; same-provider model/effort/mode apply
live. Enforce the provider→model→effort hierarchy: scope each list to the level
above, qualify ambiguous names as `provider/model`, refuse cross-provider targets,
and confirm the full triple after every set. Requires: `agent.interact` + grant
(unattended `/permission` = the matching `approval.*`). Tests: `/model`/`/effort`/`/permission` change the running
session with no re-mint when the provider is unchanged; `/provider` re-mints and
resets defaults; `/model list` shows only the current provider's models; a
cross-provider model is refused; unattended mode needs an approval privilege;
selection sticky across `/new`. `/agent` lists/applies agent profiles
(`agentProfiles` from `server_info`), bounded by the caller's `AgentConfigurationGrant`.

**Phase 5 — Extend the agent.** `/skill` and `/command` list/search (read the
agent's skills/commands), then dynamic `/command add`/`remove` writing the
per-account `name → prompt` table, with pass-through expansion and reserved-name
rejection. Requires: `agent.interact`; `/command add`/`remove` = `approval.config`.
Tests: dynamic command round-trips; account scope isolation; reserved name
rejected; `/skill <name>` reaches the agent even on name collision.

**Phase 6 — Fork & one-off sessions (direct).** `/fork` (fork + rebind), `/side`
(fork + one-off), `/quick` (fresh + one-off). Facade: `buildAgentForkContext` and
`create_agent_request` with `attachments`/`initialPrompt`/`autoArchive`; a transient
in-memory reply association (agentId → conversation + requester) routes a one-off's
reply back; `agentForkContext` gates the forking pair. Requires: `agent.create`.
Tests: fork carries the transcript; `/fork` rebinds and applies a staged provider;
`/side`/`/quick` leave the binding and auto-archive; the reply returns to the
conversation.

## Resolved decisions

- **RBAC — converge on org Access (the standard); add a Guest group.** Channel
  commands gate on org Access privileges (`ACCESS_PRIVILEGES`, `access/contract.ts`)
  via `channelIdentities` + `authorizeChannelPrivilege`, and config commands are
  bounded by the sender's `AgentConfigurationGrant`. This **supersedes** the earlier
  "keep the control-plane role model" note: the role projection
  (`CHANNEL_COMMAND_ROLE`) is no longer the gate. Two consequences: **(a)** org
  Access gains a **Guest** subject — a public-deployment group for unlinked senders,
  new to `contract.ts`/`store.ts`/`schema.ts`; **(b)** the per-conversation **owner**
  notion (session initiator) has no org-Access equivalent and is **dropped for
  gating** — anyone holding the privilege may act (this is why session control is
  open to any participant). `mayUseChannel`/`mayTrigger` stays the "may act at all"
  floor. This is a Hub-core change, wider than channel code — see
  [Open items](#open-items).
- **Dynamic command scope — per channel account.** Team-shared, not per-person or
  per-conversation, stored in the Hub DB table above. Per-conversation overrides
  can come later if a need appears.
- **`/status` — context-left now, quota later.** Context-left reads the existing
  `contextWindow*` wire fields (zero daemon diff); quota waits on the
  `provider.usage.list` RPC being wired into the channel client.
- **Web origin — instance-level `appWebUrl`.** One per Hub deployment (the app's
  public origin, distinct from the Hub's own UI origin), reusing the
  `RuntimeConfiguration` pattern; `paseo://` fallback when unset.
- **`/provider` kept, complementary to `/agent`.** `/agent <name>` picks a preset
  bundle from the route menu; `/provider`/`/model`/`/effort` tune single axes. Both
  obey the provider→model→effort hierarchy (scoped lists, qualified names,
  full-triple confirmation), so the two paths never yield an ambiguous config.

## Original open items — resolved during implementation

The big RBAC question is **decided**: converge on org Access (see
[Resolved decisions](#resolved-decisions)). The implementation resolves the questions below as `(guest, guest)` assignments, no initiator-owner command gate, and existing identity linking plus Guest grants:

- **Guest subject shape.** Add `guest` to `ACCESS_SUBJECT_KINDS` (a grantable group
  like `member`/`team`) vs a per-resource `guestPrivileges` field. Recommendation: a
  subject kind — it reuses the assignment machinery and conversation-visibility
  constraints. Touches `access/contract.ts`, `access/store.ts`, `db/schema.ts` (the
  `subjectKind` check).
- **Owner (session initiator).** Dropped for gating (org Access has no equivalent).
  Confirm nothing needs initiator-only authority; if something does later, add a thin
  conversation-local overlay rather than reviving the role model.
- **Identity-link friction.** Org-Access gating needs the sender linked
  (`channelIdentities`); an unlinked sender gets only the Guest group's grants.
  Confirm the linking/onboarding path is acceptable for the target deployments, and
  record the whole model in `docs/permissions.md`.

Rule of thumb that got us here: **an architecture choice is long-term only when a
doc states the decision and its rationale; anything else is provisional by
default.**

## Upstream boundary

All of this is PaseoClaw-owned channel code under `packages/hub/src/channels/` and
`packages/channels/*`, plus reuse of existing protocol RPCs — the deep-link helper
and the `set_agent_*` / `agent.config.apply` live-config messages the daemon
already handles. No daemon protocol change is required; the only new client code is
Hub-side facade methods over those existing RPCs. The one part beyond `channels/`
is Hub-core, not channel-local: org Access gains a **Guest** subject
(`access/contract.ts`, `access/store.ts`, `db/schema.ts`) — still Hub, still no
daemon/protocol change, but treat it as its own reviewed change. Upstream Paseo
files are not renamed, split, or reformatted. With the channel feature gate
off, the base Paseo experience and unmodified-client pairing are unchanged — verify
both before calling any phase done.

## Retry and interrupted commands

Side-effecting commands use a durable receipt keyed by organization, channel account,
source conversation and native event ID. The receipt is recorded before dispatch.
A completed receipt consumes a transport replay; an unfinished receipt is never
reclaimed automatically because the daemon may already have accepted the action.
The reply asks the requester to inspect the session before submitting a new message.
This is at-most-once dispatch, not exactly-once recovery. Command-button receipts use
the one-use action identity rather than the containing message ID. Events without a
native message ID cannot use this durable guard.

Queued messages recheck the requester's current channel participation and
`agent.interact` grant before release. Mint and resume also validate mode and feature
values against approval authority, so another Member's persisted unattended selection
does not transfer that authority to the next requester.
