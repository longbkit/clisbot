# Channel slash commands

One command vocabulary that works the same in every channel — Slack, Telegram,
Discord, Feishu, Google Chat. The commands are **in-conversation controls** for
the agent session bound to the conversation you type them in: start it, steer
it, configure it, stop it, or jump to it in the Clisbot app. They are not
per-channel app registrations, so the same word works everywhere with zero
per-channel setup.

Audience: contributors. End users read the [user guide](user-guide.md). The gap
audit and build plan is [implementation-plan.md](implementation-plan.md).

## Command reference

The tables below describe the implemented shared command surface. Keep them in sync with
`packages/hub/src/channels/commands.ts` and `textCommandHelpText()`. Every command
matches the **whole message**; anything else falls through to the agent as an
ordinary prompt (see [Invocation](#invocation-one-parser-every-channel)).

The **Requires** column names the **org Access** privilege the command needs
(`packages/hub/src/access/contract.ts`) — the decided standard for channel command
gating ([why](implementation-plan.md#resolved-decisions)). The channel resolves the
sender to a Hub Member via `channelIdentities` and checks the privilege with
`authorizeChannelPrivilege`; an unlinked sender acts as the **[Guest group](#the-guest-group)**.
`+ grant²` commands are additionally bounded by the sender's
`AgentConfigurationGrant` (which providers/models/thinking they may use) and by the
conversation-visibility constraint.

Chat is separate from Host and Project access. Everything that stays inside the
Route's configuration needs only `channel.use`: the Route's publisher was checked
for that configuration when they published it, and a conversation's `/model` or
`/agent` choice was checked against whoever made it. Personal grants are for
changing the configuration or reaching outside it
([decision](../../audits/2026-09-18-channel-chat-authority-and-limits.md)).

Each privilege, and what it unlocks — grant these to a Member, Team, or the Guest
group:

| Privilege         | What it unlocks                                            | Commands                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _public_          | anyone, even an unlinked guest                             | `/help`, `/me`                                                                                                                                                       |
| `channel.use`     | chat with the Route's Agent — the baseline to give a Guest | `/status`, `/stop`, `/new`, `/followup` (this conversation), `/steer`, `/queue`, `/skill`, `/command` (list/search/run), `/fork`, `/side`, `/quick`, `/routedefault` |
| `agent.interact`  | change or leave the Route's configuration                  | `/cowork`, `/agent`, `/model`, `/provider`, `/effort`, `/permission`                                                                                                 |
| `agent.create`    | bring a session from elsewhere                             | `/resume`                                                                                                                                                            |
| `approval.config` | manage dynamic commands                                    | `/command add`, `/command remove`                                                                                                                                    |
| `approval.*`      | answer or suppress prompts                                 | `/approve`, `/deny`; an unattended `/permission` mode                                                                                                                |
| `channel.manage`  | change a Connection's Route defaults³                      | `/promoteroutedefault`                                                                                                                                               |

The per-command **Requires** columns below repeat this at the row level.

### Session controls and approvals

| Command                                 | Does                                                                                                                                                   | Requires                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `/status`                               | Agent + session state.                                                                                                                                 | channel.use             |
| `/stop`                                 | Stop the running turn.                                                                                                                                 | channel.use             |
| `/new`                                  | Clear the binding; the next message starts fresh. `/new <message>` starts immediately.                                                                 | channel.use             |
| `/agent [<name>]`                       | Switch the conversation's agent. Apply an **agent profile** bounded by the caller's configuration grant ([below](#agent-profiles-and-the-route-menu)). | agent.interact + grant² |
| `/model [<name>]`                       | Bare: show the model menu. `/model <name>`: switch this conversation's model.                                                                          | agent.interact + grant² |
| `/help`                                 | This command list.                                                                                                                                     | — (public)              |
| `/approve [id] [answer]` · `/deny [id]` | Answer the newest open approval, or the one named by `<id>`.                                                                                           | approval authority¹     |

Slack: if `/…` collides with a native command, use the backslash form —
`\approve`, `\status`.

¹ Approvals resolve against the open prompt with the existing two
approval-authority checks, not a single privilege.
² **+ grant** — also bounded by the sender's `AgentConfigurationGrant`; see
[Provider, model, effort](#provider-model-effort). A configuration with `featureValues.fast_mode: true` also
requires `agent.fast.use`. This check applies to profile discovery/application,
live configuration, session creation and `/resume`; ordinary configuration or
creation privileges do not imply Fast mode access.
³ `channel.manage` is checked by `authorizeChannelAccountManagement`, not
`authorizeChannelPrivilege`: an organization owner or admin holds it, and so does
a Member or Team assigned the **Manage** level on that Connection. The Manage
level requires the All conversations constraint, because a Route can match
conversations outside a narrower list. A Guest never holds it. See
[Route defaults](#route-defaults).

### Discovery, configuration, and additional session controls

Implementation and verification notes are in [implementation-plan.md](implementation-plan.md).
`•` = applies on that route kind.

| Command                                                                                                   | Does                                                                                                           | Requires                                         | Direct | Automation |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | :----: | :--------: |
| `/cowork` (`/open`, `/app`)                                                                               | Reply with both links to the bound session ([below](#session-links)).                                          | agent.interact                                   |   •    |     •      |
| `/me`                                                                                                     | Your channel identity and access here.                                                                         | — (public)                                       |   •    |     •      |
| `/followup [status\|auto\|mention-only\|pause\|resume]`, `/followup route [auto [minutes]\|mention-only]` | Show or change whether messages need a mention, here or on the whole route ([below](#follow-up)).              | channel.use; `route` changes need channel.manage |   •    |     •      |
| `/resume <id>`                                                                                            | Bind an existing session `<id>` here, replacing the current binding.                                           | agent.create                                     |   •    |     —      |
| `/steer <message>`                                                                                        | Admit `<message>` into the running turn.                                                                       | channel.use                                      |   •    |     —      |
| `/queue <message>`                                                                                        | Hold `<message>` until the current turn ends.                                                                  | channel.use                                      |   •    |     —      |
| `/provider [list]` · `/provider search <kw>` · `/provider <id>`                                           | Show/find providers you may use; stage one (reset model+effort to its defaults; `/new` or `/fork` applies it). | agent.interact + grant²                          |   •    |     —      |
| `/model [list]` · `/model search <kw>`                                                                    | Extend the shipped `/model` with list/search of the **current provider's** models.                             | agent.interact + grant²                          |   •    |     —      |
| `/effort [list]` · `/effort <id>`                                                                         | List the **current model's** effort levels; set one (live).                                                    | agent.interact + grant²                          |   •    |     —      |
| `/permission [<mode>]` (`/mode`)                                                                          | Show / set the provider's mode. An unattended mode needs the matching `approval.*` privilege.                  | agent.interact                                   |   •    |     —      |
| `/skill [list]` · `/skill search <kw>` · `/skill <name>`                                                  | List/search skills; run one on the agent.                                                                      | channel.use                                      |   •    |     —      |
| `/command [list]` · `/command search <kw>`                                                                | List/search dynamic commands.                                                                                  | channel.use                                      |   •    |     —      |
| `/command add <name> <prompt>` · `/command remove <name>`                                                 | Create or remove a dynamic command.                                                                            | approval.config                                  |   •    |     —      |
| `/fork [message]`                                                                                         | Fork this conversation into a new session (carries context) and continue here (rebinds).                       | channel.use                                      |   •    |     —      |
| `/side <message>`                                                                                         | One-off question in a new session seeded with this conversation's context; binding unchanged.                  | channel.use                                      |   •    |     —      |
| `/quick <message>`                                                                                        | One-off question in a fresh, unrelated session; binding unchanged.                                             | channel.use                                      |   •    |     —      |
| `/routedefault`                                                                                           | Show the Route serving this conversation, its default, and this conversation's configuration when it differs.  | channel.use                                      |   •    |     —      |
| `/promoteroutedefault` · `/promoteroutedefault undo`                                                      | Make this conversation's configuration the serving Route's default; undo its last change.                      | channel.manage³                                  |   •    |     —      |

On an **automation** route, `/stop` cancels the active run and `/status` reports
it; the direct-only additions answer "not available on an automation route". See
[Route kind decides the surface](#route-kind-decides-the-surface).

`/agent` and `/provider`/`/model`/`/effort` are complementary: `/agent <name>`
applies a whole **agent profile**, while `/provider`, `/model`, and `/effort` tune
the individual axes. Both obey one hierarchy — see
[Provider, model, effort](#provider-model-effort).

### The Guest group

Gating uses org Access, whose subjects are Members and Teams — a channel sender is
resolved to a Member through `channelIdentities`. A sender with **no linked Member**
(the common case in a public channel) acts as the **Guest** group: a first-class
subject a public deployment assigns privileges to, exactly like a Team. Grant the
Guest group `channel.use` (chat) and leave `/help`/`/me` public, and a public
channel works for anyone, including starting sessions with the Route's
configuration. An open-audience Route admits Guests without that grant. Grant the
Guest group more and guests can also change the configuration. Nothing above is
reachable without the named privilege, so a guest gets only what the Guest group
holds. The Guest subject is persisted as `(guest, guest)` in org Access with no default grants; linked Members do not inherit it. See
see [implementation-plan.md](implementation-plan.md#resolved-decisions).

## Starting sessions

Five commands mint or rebind a session. Three questions decide which: does it
carry this conversation's context, does it take over the binding, and which
workspace does it land in ([workspace organization](../workspace-organization/README.md)).

| Command            | Context                     | Takes over the conversation | Workspace                   |
| ------------------ | --------------------------- | --------------------------- | --------------------------- |
| `/new [message]`   | fresh, none                 | yes — continue here         | new, named from the message |
| `/resume <id>`     | an existing session         | yes — continue here         | the resumed session's       |
| `/fork [message]`  | forked from current session | yes — continue here         | the source session's        |
| `/side <message>`  | forked from current session | no — one-off answer         | the source session's        |
| `/quick <message>` | fresh, none                 | no — one-off answer         | new, named from the message |

- **Fork** (`/fork`, `/side`) copies this conversation's transcript into the new
  session (`buildAgentForkContext` → a `chat_history` attachment on the create
  request), so the agent starts with what has happened here. Needs a host that
  supports fork (`agentForkContext`).
- **One-off** (`/side`, `/quick`) answers in a throwaway session (`autoArchive`)
  and leaves your bound session exactly as it was — ask on the side without
  disturbing the running work. The answer posts back in this conversation; the
  binding does not move.
- `/fork` is also how you apply a **staged provider** while keeping context: it
  mints the new session with the staged config and continues here.

### Lifecycle boundaries

`/new` without a message clears the binding; the next accepted message creates
the session. `/new <message>` creates and sends that first prompt immediately.
`/resume` checks access to the target session and its project/configuration before
an atomic binding replacement; it rejects a target already bound to another
conversation. A resumed external session on a tool-output route uses a persisted
relay override because a channel reply tool cannot be injected into an existing
session. This override enables final-answer relay, including after restart.
Resuming the already-bound Agent is a no-op after authorization; it preserves
the current stream buffer. Fork/resume replacement restores the previous binding
with compare-and-swap if stream attachment fails; a fork also restores it if the
first prompt is rejected. The source Agent is canceled and detached only after
the replacement is ready.

`/queue` holds messages in Hub memory and releases them FIFO at turn boundaries.
It sends immediately if the session is idle. Access is checked again at release,
and a newly running turn observed before the send keeps the message held. The
current daemon wire has no atomic send-only-if-idle operation: another client
can still start a turn between that check and the send RPC. The RPC uses steer
so this race does not cancel that independent turn. Rebinding, detaching, or stopping the
Hub clears the hold; this is not the durable channel ingress queue. `/side` and
`/quick` also use transient reply associations, removed after terminal output.
They create `autoArchive` sessions and explicitly enable final-answer relay for
the one-off, even when ordinary route answer sync is disabled. This override
does not alter the persisted route or the current binding. Session creation stays idle until stream
subscription completes, then sends the first message and any fork attachment so
first-turn output is observable.

### Mutation retries

For an event with a native message ID, the dispatcher records a durable receipt
before a session/configuration mutation. Redelivery of that same source message
is consumed without repeating the mutation. A pending receipt is never reclaimed
automatically: dispatch may already have reached the daemon before a crash or
connection loss. Inspect the current session before intentionally retrying with
a new message. An acknowledgement failure does not undo or repeat an accepted
mutation. This is an at-most-once dispatch guarantee, not a claim that every
accepted command completed successfully; events without native IDs cannot use it.

## Naming decisions

Names are the contract users learn; these are chosen against
[the glossary](../../glossary.md), not invented.

- **`/agent [<name>]` = apply an agent profile** — the reusable named bundle
  (**Agent profile** in the glossary: provider + model + mode + thinking), not the
  running session. `/agent list` shows the profiles you may use; `/agent <name>`
  applies one. The route's former closed `selectable` menu is replaced by agent profiles bounded by your access grant. See
  [Agent profiles and the route menu](#agent-profiles-and-the-route-menu).
- **`/cowork`** — the point is moving work between the channel and the app in
  both directions, so the verb names co-working across surfaces, not just "open".
  `/open` and `/app` are accepted aliases for discoverability.
- **`/effort` = the thinking control** — Paseo's cross-provider term is **thinking
  option**; "effort" is Codex/OpenAI-native. `/effort` is the user-facing spelling
  and `/thinking` is an alias; both set `thinkingOptionId`.
- **`/permission` = Mode** — a provider's Mode (plan / default / full-access …)
  governs how much the agent may do without asking, so users reach for
  "permission"; providers like Claude Code literally call it "permission mode".
  `/permission` sets `modeId`; `/mode` is the glossary-aligned alias. Distinct
  from `/approve`/`/deny`, which answer an open permission _prompt_.
- **`/routedefault` / `/promoteroutedefault`** — "route" is the glossary's
  **Route**, the ordered rule inside a Connection. The write is one long word on
  purpose: it reaches conversations other than the caller's, so it should be
  typed deliberately, and `promote` says the direction — from this conversation
  up to its Route.
- **`/fork` / `/side` / `/quick`** — the two axes are context (forked vs fresh)
  and whether it takes over the binding; `/fork` = fork + continue here, `/side` =
  fork + one-off, `/quick` = fresh + one-off. See [Starting sessions](#starting-sessions).
- **Commands covered by this feature** — `/cowork`, `/me`, `/resume`, `/steer`,
  `/queue`, `/provider`, `/effort`, `/permission`, `/skill`, `/command`, `/fork`,
  `/side`, `/quick`, `/routedefault`, `/promoteroutedefault`, plus `list`/`search`
  on `/model`. `/status`, `/stop`, `/new`,
  `/agent`, `/model`, `/help`, `/approve`, `/deny` already ship.

## Invocation: one parser, every channel

Channels disagree about slash commands in every way that matters, so none of
them own the command surface — a single plain-text parser does, and each channel
normalizes its native and addressing forms **down to that plain text** before
the parser runs.

- **Some channels require pre-registering each command.** Slack (app manifest
  `slash_commands`), Discord (`application.commands` scope), and Google Chat
  (console command with a numeric `commandId`) will not deliver an unregistered
  `/word`. Registering ~20 evolving commands per channel is per-channel setup
  that drifts. Instead each channel uses **one** umbrella command
  (Slack/Google Chat `/paseo <sub>`, Discord one `/paseo` application command)
  whose payload is rewritten to the plain-text form; the vocabulary stays in one
  place. Discord upserts its registration at startup; Google Chat requires
  the operator to configure `/paseo` in the app console.
- **Some channels have no slash API at all.** Telegram group messages and Feishu
  are plain text only. There the words above are the whole interface, so the
  parser must accept a bare command with no channel affordance.
- **Addressing differs.** Telegram glues `@bot/status` on mobile and appends
  `/status@bot` from autocomplete; Slack sends `<@U…> /status`; Feishu counts a
  direct @mention but not `@all`. The shared normalizer strips the leading/glued
  mention and the `/`, `\`, or bare prefix before matching, so every spelling
  reaches the same verb (`stripMentions` in `commands.ts`).
- **Several bots share a room.** Outside a DM a command, `/link`, or a dynamic
  command runs only when it names this bot (`mentionedBot`); otherwise it is
  ignored, never forwarded to the agent (`commandAddressesThisBot` in
  `execution.ts`). A Slack, Discord, or Google Chat native command reaches one
  app, and its vertical reports it as a mention. A bare Telegram `/status` names
  no bot and every admin or privacy-off bot in the group receives it, so it
  counts only in a DM; the group command menu inserts `/status@bot`. Typed
  `approve`/`deny` are exempt: they answer a prompt this bot posted and stay
  silent when it has none.
- **Slack `/` collisions.** When a team already owns a native `/status`, or a
  client blocks unregistered `/…`, the **backslash** form (`\status`,
  `\approve`) is the conflict-free spelling and rides the same parser.

### Follow-up

`interaction.followUp` decides whether an **unmentioned** message continues a
bound session. It refines `requireMention`: a DM, or a Route with
`requireMention: false`, admits every message.

- `mention-only` (the default): every message needs a mention.
- `auto`: after a mention, unmentioned messages in that conversation continue
  the session for `ttlMinutes` (default 5, clisbot's `participationTtlMin`)
  after the agent's latest activity — every stream event refreshes it, so a long
  turn keeps it open; then a new mention is needed. The window is kept in Hub
  memory, so after a Hub restart the next message needs a mention. A pause ends
  only when a mention is accepted, not when a refused or throttled one arrives.

Two scopes change it:

| Form                                           | Changes                                                                                                            | Needs            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `/followup auto\|mention-only\|pause\|resume`  | This conversation only: its binding key, so one thread, one topic, or a whole channel under `binding.key: channel` | `channel.use`    |
| `/followup route auto [minutes]\|mention-only` | The Route serving the conversation, for every conversation it serves                                               | `channel.manage` |

- **Conversation override.** `pause` requires a mention until the next accepted
  one; `resume` returns to the Route. The reply names the scope (`this thread`,
  `this topic`, `this channel`). The override lives in
  `channel_conversation_follow_ups`, apart from the `/agent` and `/model`
  selection, so `/promoteroutedefault` does not clear it. In a DM, or on a Route
  without `requireMention`, a change is refused: it would have no effect.
- **Channel root on a thread-anchored Slack Route.** The message there opens its
  own thread, so an override would only cover that thread. Clisbot stores it
  anyway; the Hub refuses and points to running it in the thread or to
  `/followup route`.
- **Route change.** It publishes a Channel revision through the same path as
  `/promoteroutedefault` (compile guard, delegation check, attributed to the
  sender). It writes `interaction.followUp` on the Route and keeps the authored
  leaves it does not name, so `mention-only` keeps a custom `ttlMinutes` for a
  later `auto`. Conversation overrides stay until `/followup resume`. Clisbot has
  no chat form for this; it is config-file only there.
- **Route editor.** It shows the leaf as **Continue without a mention**. Saving a
  Route writes `followUp` only when you changed that control or the Route
  already authored it, so a Route inheriting `auto` from its account keeps
  inheriting.
- **Arguments.** Only the forms above parse as the command. Anything else, such
  as `followup on the PR`, goes to the agent as a prompt.

### Platform commands vs the agent's own commands

The platform vocabulary is a **closed, known set** — the tables above. It matches
only as a whole message, and only the argument-taking verbs (`/agent`, `/model`,
and the setters) read a trailing value; everything else is whole-message
only. Precedence is fixed and needs no guessing:

1. A whole message that is a platform command runs the platform command.
2. `/skill <name>` and `/command <name>` are the explicit doors to the agent's
   skills and dynamic commands — use them to reach an agent skill even if it
   shares a name with a platform word.
3. Anything else — including a `/word` that is not a platform command — passes
   through to the agent as an ordinary prompt, unchanged.

So a platform reserved word can never be shadowed by an agent skill, and an
agent skill is never swallowed by the platform: the reserved set is small,
documented, and the only thing that wins as a bare message.

## Route kind decides the surface

Commands act on the **binding's execution owner**, and there are two owners.

- **Direct route** — the conversation is bound to one agent session. `/steer`,
  `/queue`, `/stop`, and the `/provider` / `/model` / `/effort` / `/permission` /
  `/agent` config commands all have one obvious target: that session and its next turn.
  This is the full direct-command surface.
- **Automation route** — each accepted inbound starts a **new** workflow run
  (channel-workflow-integration audit), so there is no single turn to steer into
  and no single config to set — the automation revision owns each step's agent.
  Steering, queueing, session lifecycle, and config are therefore **direct-only**
  in v1; on an automation route they return "not available on an automation
  route", not silence. What does apply is run-scoped: `/stop`
  cancels the active run(s) for the route after authorizing their execution targets,
  `/status` reports the authorized run/step summaries, and `/cowork` links each
  Agent using its own Host identity, including runs spanning multiple Hosts.
  `/me` and `/help` always work.

This is the deliberately simple answer to "queue/steer per session doesn't fit a
multi-layer automation": don't force it to. One rule — commands target the
binding's owner — gives direct bindings the whole surface and automation
bindings a minimal, honest subset. Extending steer/queue to workflow runs is a
later, separate design, not a v1 fallback.

## Where a `/set` lands

Same-provider model, thinking, and mode changes apply live through the existing
`set_agent_model`, `set_agent_thinking`, `set_agent_mode`, and `agent.config.apply`
RPCs. They preserve the running session and its history.

A provider-changing `/provider` or `/agent` selection is **staged** in the existing
conversation selection store. It resets provider-dependent defaults and leaves
the current binding running. Ordinary messages still reach that bound session.
`/new [message]` starts fresh with the selection; `/fork [message]` copies the
current history into a new session with the selection and rebinds here. While a
different provider is staged, configuration setters update the staged selection
and do not apply the new provider's model or mode to the old running session.
Replies identify whether the change is live or staged. When changing a staged
provider back to the provider of the still-running session, the final live
configuration preserves that session's mode and feature values unless the
selection explicitly overrides them. Authorization checks this resulting bundle,
including any preserved Fast mode or unattended features.

Selections persist across `/new` and layer over the route defaults. They never
rewrite the immutable, organization-owned Channel revision; only
`/promoteroutedefault` does ([Route defaults](#route-defaults)). The Hub facade
reuses existing daemon RPCs; this feature introduces no new daemon protocol.

## Route defaults

Most changes are for the conversation you are in, so `/model`, `/provider` and
the rest stay conversation-scoped. When the choice should apply to everyone the
same Route serves, `/promoteroutedefault` makes this conversation's configuration
the Route's default. The caller never names the Route: Routes match in order, by
conversation and by message text (`contains`), so only the Hub knows which one
served this message. That Route is the one changed, and `/routedefault` shows it.

- **Where it lives.** The Route's `agentControls:` leaf (provider, model, mode,
  thinking option, feature values) over the named `agent:` in `hub.yml`
  (`channels/config/agent-controls.ts`). It changes one Route, not an agent that
  other Routes and Automations share. A block that names a provider is a whole
  configuration, read the way a conversation selection is: it replaces the named
  agent's model, mode, thinking option and feature values, keeps its provider
  `options` only under the same provider, and a field it leaves out is unset
  rather than inherited. That is what makes a promoted conversation start exactly
  what it ran. A block without a provider overrides the named agent field by
  field. The leaf can also sit in an account's or the policy's `defaults:`; the
  most specific layer's block wins whole.
- **How it is written.** An ordinary Channel revision, through `deployRevision`:
  the same compile guard, delegation applied to the effective agent of **the
  changed Route only**, `createdByUserId` set to the Member, and `expectedRevisionId` so a
  concurrent publish is refused rather than overwritten. The command refuses a
  Route that changed since the running plane compiled it, ignoring an earlier
  default change (`routeIdentity`). Delegation is scoped because every other Route
  in the revision is unchanged and was authorized by whoever published it;
  checking all of them would refuse a Connection manager whose own Route is
  within their grants whenever another account uses a Project they lack. A Hub UI
  save still checks every Route.
- **What happens to the conversation.** Its own selection is cleared, since the
  Route now says the same thing. Its behavior does not change.
- **What happens to running sessions.** Nothing. The default is not part of the
  Route target, so bindings keep their sessions, and only the next session a
  Route starts uses the new value. The supervisor adopts a revision that differs
  only in `agentControls` in place (`route-defaults/signature.ts`,
  `ChannelPlane.refresh`) instead of restarting accounts, because a restart
  cancels Route-owned turns in every account.
- **Undo.** `/promoteroutedefault undo` restores the value the Route's default had
  before its most recent change, published as a new revision. It reads the
  revision history and stops where the Route itself was different, so it never
  reaches past a reorder or an edit of the match, target or other defaults. A
  second undo reapplies the change it undid.

Replies are English, like every other command reply, until the Hub has locale
support.

## Agent profiles and the route menu

`/agent list` lists named **Agent profiles** from daemon configuration
(`get_daemon_config_request`, gated by the host's `agentProfiles` feature).
`/agent <name>` applies the provider/model/mode/thinking bundle. Same-provider
changes apply live; a different provider is staged as described above.

Every visible or applicable profile must fit the caller's
`AgentConfigurationGrant`. The former route `selectable.agents` / `selectable.models`
menu is no longer the command authorization boundary. An unlinked Guest may be
given a narrow configuration grant; linking a Member switches to that Member's
own assignments and team grants.

## Provider, model, effort

These three nest, and mixing them across providers is the easy mistake — a model
name that exists under two providers, an effort level that only some models have.
The list is bounded by your `AgentConfigurationGrant` (you never see a provider or
model you may not use), and the commands enforce one hierarchy so a list or a set
is never ambiguous:

- **Scoped lists.** `/provider` lists providers; `/model` lists only the **current
  provider's** models; `/effort` lists only the **current model's** effort levels.
  Another provider's models never appear mixed in.
- **Qualified names.** When a model or effort name could match under more than one
  provider, `list`/`search` results carry the parent — `openai/gpt-5.6-luna`, not a
  bare `gpt-5.6-luna` — so look-alike names across providers stay distinct.
- **Refuse, don't guess.** Setting a model or effort that isn't valid for the
  current provider/model, or outside your grant, is refused with the valid options,
  never silently cross-applied.
- **Confirm the whole triple.** Every set echoes the full resolved state —
  _"Provider: openai · Model: gpt-5.6-luna · Effort: medium"_ — so the config is
  always unambiguous, and a provider change (which resets model + effort to that
  provider's defaults) is obvious.

`/agent <name>` sets all three at once by applying an agent profile; `/provider`,
`/model`, `/effort` tune them one axis at a time. Both land in the same place ([Where a
`/set` lands](#where-a-set-lands)).

## Visibility in public conversations

Every command replies in the conversation and thread it was invoked from,
including `/cowork` and `/status`, whose output carries a session link. The
reply follows the Route's `reply.anchor` exactly as the agent's replies do
(`channels/reply-anchor.ts`): under `thread`, a command sent at the Slack channel
root is answered in a thread on that message rather than at the root. An
unrouted `/help` or `/me` has no anchor and replies where it was sent. Ordinary
messages carry no native interaction token on Slack or Discord, so the only
private surface available is a requester DM — and a reply in a DM the caller is
not looking at is indistinguishable from the bot ignoring the command.

What bounds a link instead is access, not delivery: a caller needs
`agent.interact` in the conversation to get one, and the link only opens for
someone who can already authenticate to that Host. Treat a public conversation
as the audience of every command you run there.

## Session links

`/cowork` and `/status` offer two destinations — the web app and the installed
app — as two short labeled links.

Channels linkify `http(s):` and nothing else. Slack renders link markup around a
`paseo://` URL as literal text; that is measured, not assumed (post a probe and
read `message.blocks` back: the https URL becomes a `link` element, the custom
scheme stays `text`). And the app registers only the `paseo` scheme — no
`associatedDomains`, no verified intent filters — so no https URL opens it
directly.

So the app destination is an https URL on the Hub, `GET /api/open/agent/<id>?host=<serverId>`,
which 302s into the deep link (`channels/session-open-link.ts`). It carries no
authority: the app still authenticates to the Host, and the route only echoes
ids that match the daemon's id shape. Without `PASEO_HUB_APP_WEB_URL` there is no
origin to build either https URL from, and the reply falls back to one bare
`paseo://` URL — long, but copyable, which link markup would not be.

## Maintaining this doc

- The reference tables are the source of truth for the vocabulary. When you add,
  rename, or re-scope a command, edit the right table **and** the privilege legend
  **and** `commands.ts` + `textCommandHelpText()` in the same change, gate it on an
  org Access privilege
  (`authorizeChannelPrivilege`), and mirror the user-facing lines in
  [user-guide.md](user-guide.md). Keep implementation and verification status in the implementation plan.
- Privilege names in **Requires** come from `ACCESS_PRIVILEGES`
  (`packages/hub/src/access/contract.ts`). If you cite one here, it must exist there.
- New product terms (`/cowork`, dynamic command, Guest group) go in
  [the glossary](../../glossary.md) as they are implemented; this doc links, it does not
  redefine.
