# Channel slash commands

One command vocabulary that works the same in every channel — Slack, Telegram,
Discord, Feishu, Google Chat. The commands are **in-conversation controls** for
the agent session bound to the conversation you type them in: start it, steer
it, configure it, stop it, or jump to it in the Paseo app. They are not
per-channel app registrations, so the same word works everywhere with zero
per-channel setup.

Audience: contributors. End users read the [user guide](user-guide.md). The gap
audit and build plan is [implementation-plan.md](implementation-plan.md).

## Command reference

Two tables: what ships today, then the proposed additions. Keep both in sync with
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

Each privilege, and what it unlocks — grant these to a Member, Team, or the Guest
group:

| Privilege         | What it unlocks                                               | Commands                                                                                                                                         |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| _public_          | anyone, even an unlinked guest                                | `/help`, `/me`                                                                                                                                   |
| `channel.use`     | use the channel account (chat) — the baseline to give a Guest | — (floor, not tied to a command)                                                                                                                 |
| `agent.interact`  | drive the bound session                                       | `/status`, `/cowork`, `/stop`, `/steer`, `/queue`, `/agent`, `/model`, `/provider`, `/effort`, `/permission`, `/skill`, `/command` (list/search) |
| `agent.create`    | start or rebind a session                                     | `/new`, `/resume`, `/fork`, `/side`, `/quick`                                                                                                    |
| `approval.config` | manage dynamic commands                                       | `/command add`, `/command remove`                                                                                                                |
| `approval.*`      | answer or suppress prompts                                    | `/approve`, `/deny`; an unattended `/permission` mode                                                                                            |

The per-command **Requires** columns below repeat this at the row level.

### Shipped today

| Command                                 | Does                                                                                                                                                                   | Requires                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `/status`                               | Agent + session state.                                                                                                                                                 | agent.interact          |
| `/stop`                                 | Stop the running turn.                                                                                                                                                 | agent.interact          |
| `/new`                                  | Start a fresh session in this conversation.                                                                                                                            | agent.create            |
| `/agent [<name>]`                       | Switch the conversation's agent. Today: the route's closed menu; this feature reshapes it to apply an **agent profile** ([below](#agent-profiles-and-the-route-menu)). | agent.interact + grant² |
| `/model [<name>]`                       | Bare: show the model menu. `/model <name>`: switch this conversation's model.                                                                                          | agent.interact + grant² |
| `/help`                                 | This command list.                                                                                                                                                     | — (public)              |
| `/approve [id] [answer]` · `/deny [id]` | Answer the newest open approval, or the one named by `<id>`.                                                                                                           | approval authority¹     |

Slack: if `/…` collides with a native command, use the backslash form —
`\approve`, `\status`.

¹ Approvals resolve against the open prompt with the existing two
approval-authority checks, not a single privilege.
² **+ grant** — also bounded by the sender's `AgentConfigurationGrant`; see
[Provider, model, effort](#provider-model-effort).

### Proposed additions

Not built yet — the plan is [implementation-plan.md](implementation-plan.md).
`•` = applies on that route kind.

| Command                                                         | Does                                                                                                         | Requires                | Direct | Automation |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------- | :----: | :--------: |
| `/cowork` (`/open`, `/app`)                                     | Reply with a link that opens the bound session in the Paseo app/web; private in public conversations.        | agent.interact          |   •    |     •      |
| `/me`                                                           | Your channel identity and access here.                                                                       | — (public)              |   •    |     •      |
| `/resume <id>`                                                  | Bind an existing session `<id>` here, replacing the current binding.                                         | agent.create            |   •    |     —      |
| `/steer <message>`                                              | Admit `<message>` into the running turn.                                                                     | agent.interact          |   •    |     —      |
| `/queue <message>`                                              | Hold `<message>` until the current turn ends.                                                                | agent.interact          |   •    |     —      |
| `/provider [list]` · `/provider search <kw>` · `/provider <id>` | Show/find providers you may use; switch one (resets model+effort to that provider's defaults — new session). | agent.interact + grant² |   •    |     —      |
| `/model [list]` · `/model search <kw>`                          | Extend the shipped `/model` with list/search of the **current provider's** models.                           | agent.interact + grant² |   •    |     —      |
| `/effort [list]` · `/effort <id>`                               | List the **current model's** effort levels; set one (live).                                                  | agent.interact + grant² |   •    |     —      |
| `/permission [<mode>]` (`/mode`)                                | Show / set the provider's mode. An unattended mode needs the matching `approval.*` privilege.                | agent.interact          |   •    |     —      |
| `/skill [list]` · `/skill search <kw>` · `/skill <name>`        | List/search skills; run one on the agent.                                                                    | agent.interact          |   •    |     —      |
| `/command [list]` · `/command search <kw>`                      | List/search dynamic commands.                                                                                | agent.interact          |   •    |     —      |
| `/command add <name> <prompt>` · `/command remove <name>`       | Create or remove a dynamic command.                                                                          | approval.config         |   •    |     —      |
| `/fork [message]`                                               | Fork this conversation into a new session (carries context) and continue here (rebinds).                     | agent.create            |   •    |     —      |
| `/side <message>`                                               | One-off question in a new session seeded with this conversation's context; binding unchanged.                | agent.create            |   •    |     —      |
| `/quick <message>`                                              | One-off question in a fresh, unrelated session; binding unchanged.                                           | agent.create            |   •    |     —      |

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
Guest group, say, `channel.use` (chat) and leave `/help`/`/me` public, and a public
channel works for anyone; grant it more and guests can do more. Nothing above is
reachable without the named privilege, so a guest gets only what the Guest group
holds. The Guest subject is a **new addition to org Access** this feature needs —
see [implementation-plan.md](implementation-plan.md#resolved-decisions).

## Starting sessions

Five commands (two shipped, three proposed) mint or rebind a session. Two
questions decide which: does it carry this conversation's context, and does it
take over the binding?

| Command            | Context                     | Takes over the conversation |
| ------------------ | --------------------------- | --------------------------- |
| `/new [message]`   | fresh, none                 | yes — continue here         |
| `/resume <id>`     | an existing session         | yes — continue here         |
| `/fork [message]`  | forked from current session | yes — continue here         |
| `/side <message>`  | forked from current session | no — one-off answer         |
| `/quick <message>` | fresh, none                 | no — one-off answer         |

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

## Naming decisions

Names are the contract users learn; these are chosen against
[the glossary](../../glossary.md), not invented.

- **`/agent [<name>]` = apply an agent profile** — the reusable named bundle
  (**Agent profile** in the glossary: provider + model + mode + thinking), not the
  running session. `/agent list` shows the profiles you may use; `/agent <name>`
  applies one. Shipped `/agent` today switches among the route's closed `selectable`
  menu; this feature reshapes it to agent profiles bounded by your access grant. See
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
- **`/fork` / `/side` / `/quick`** — the two axes are context (forked vs fresh)
  and whether it takes over the binding; `/fork` = fork + continue here, `/side` =
  fork + one-off, `/quick` = fresh + one-off. See [Starting sessions](#starting-sessions).
- **Additions this feature specifies** — `/cowork`, `/me`, `/resume`, `/steer`,
  `/queue`, `/provider`, `/effort`, `/permission`, `/skill`, `/command`, `/fork`,
  `/side`, `/quick`, plus `list`/`search` on `/model`. `/status`, `/stop`, `/new`,
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
  that drifts. Instead each channel registers **one** umbrella command
  (Slack/Google Chat `/paseo <sub>`, Discord one `/paseo` application command)
  whose payload is rewritten to the plain-text form; the vocabulary stays in one
  place.
- **Some channels have no slash API at all.** Telegram group messages and Feishu
  are plain text only. There the words above are the whole interface, so the
  parser must accept a bare command with no channel affordance.
- **Addressing differs.** Telegram glues `@bot/status` on mobile and appends
  `/status@bot` from autocomplete; Slack sends `<@U…> /status`; Feishu counts a
  direct @mention but not `@all`. The shared normalizer strips the leading/glued
  mention and the `/`, `\`, or bare prefix before matching, so every spelling
  reaches the same verb (`stripMentions` in `commands.ts`).
- **Slack `/` collisions.** When a team already owns a native `/status`, or a
  client blocks unregistered `/…`, the **backslash** form (`\status`,
  `\approve`) is the conflict-free spelling and rides the same parser.

### Platform commands vs the agent's own commands

The platform vocabulary is a **closed, known set** — the tables above. It matches
only as a whole message, and only the argument-taking verbs (`/agent`, `/model`,
and the proposed setters) read a trailing value; everything else is whole-message
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
  This is the full surface, and the one to build first.
- **Automation route** — each accepted inbound starts a **new** workflow run
  (channel-workflow-integration audit), so there is no single turn to steer into
  and no single config to set — the automation revision owns each step's agent.
  Steering, queueing, session lifecycle, and config are therefore **direct-only**
  in v1; on an automation route they return "not available on an automation
  route", not silence. What does apply is run-scoped and read-only: `/stop`
  cancels the active run(s) for the route, `/status` reports them, `/cowork`
  links to the running agent, and `/me`/`/help` always work.

This is the deliberately simple answer to "queue/steer per session doesn't fit a
multi-layer automation": don't force it to. One rule — commands target the
binding's owner — gives direct bindings the whole surface and automation
bindings a minimal, honest subset. Extending steer/queue to workflow runs is a
later, separate design, not a v1 fallback.

## Where a `/set` lands

**Today, switching agent or model re-mints the session.** `/agent <name>` and
`/model <name>` persist the choice against the conversation
(`store.access.setConversationSelection` → `selectedAgent` / `selectedModel`) and
then end the bound session the way `/new` does (`endBoundSession`), so the next
message opens a fresh session on the new target. The current code fixes a running
agent's provider and model at create time, so a model change this way loses the
current session's history — the cost of the re-mint.

**The enhancement: same-provider changes go live.** The daemon already supports
live edits — `set_agent_model_request`, `set_agent_thinking_request`,
`set_agent_mode_request`, and the bundle `agent.config.apply.request`
(`packages/protocol/src/messages.ts:1843`) — the same RPCs the Paseo app uses to
change model/effort/mode between turns. So `/model`, `/effort`, and `/permission`
should apply **live** on the running session when the provider is unchanged (no
re-mint, no lost history); the daemon rejects a model or bundle from a different
provider. Only switching to a `/agent` bundle on a **different provider** still
re-mints, because there is no `set_agent_provider`.

**Zero daemon changes** either way: the live-edit RPCs already exist and the
daemon already handles them; the channel daemon client just adds facade methods
that call them (`packages/hub/src/channels/daemon/client.ts`). No new wire.

The per-conversation selection store already exists
(`store.access.setConversationSelection`); the additions extend it (effort, mode)
so the choice is sticky and layers over the route default at the next mint. It is
never written into the Route, whose immutable org-owned revision a channel message
must not mutate
([channel-workflow-integration audit](../../audits/2026-09-02-channel-workflow-integration-gaps.md)).
A staged provider change is explicit in the reply — for example: _"Provider
staged: openai (gpt-5.6-luna / medium). `/new` starts a fresh session on it;
`/fork` carries this conversation's context across."_ A live `/model` or `/effort`
reply, by contrast, confirms the change took effect on the running session now.

## Agent profiles and the route menu

Two things named "agent" meet here; keep them straight.

- **The route's closed menu** — what shipped `/agent`/`/model` use today.
  `selectionMenu`/`resolveSelection` (`policy/selection.ts`) offer only the route's
  own agent plus the `selectable.agents` / `selectable.models` the route author
  listed in `hub.yml`. It is **closed on purpose**: a command that could name any
  agent or model would let a participant reach every environment the Hub can run,
  so anything off the list is refused. It is an allowlist, not a catalog.
- **Agent profiles** — the reusable named bundles from the app (**Agent profile**
  in [the glossary](../../glossary.md); `agentProfiles` in daemon config: provider,
  model, mode, thinking, features, notes; host feature `agentProfiles`). Applying
  one copies those values onto the agent — the same thing the app's profile picker
  and the `list_profiles` MCP tool do. They ride in on `server_info`, so the channel
  reads them with no new RPC.

This feature makes **`/agent` = apply an agent profile**: `/agent list` shows the
profiles you may use, `/agent <name>` applies one (its model/mode/thinking go live;
a different provider re-mints, per [Where a `/set` lands](#where-a-set-lands)). The
**bound is your access grant**: you only see and apply profiles whose
provider/model fall inside your `AgentConfigurationGrant` (org Access), the same
bound as `/provider`/`/model`/`/effort`. The route's closed `selectable` list is the
shipped mechanism this replaces; going forward the per-user grant is the allow rule,
which is why a public **Guest** may be granted a narrow set while a developer gets
more.

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

Not everyone in a public channel may see a link into your dev environment or your
identity. Command **output** is scoped:

- Turn controls (`/stop`, `/steer`, `/queue`) and their acknowledgements post in
  the conversation as usual.
- Identity, link, and config output — `/cowork`, `/status`, `/me`, and `list` /
  `search` results — is delivered to the **requester privately** when the
  conversation is public (ephemeral on Slack/Discord, DM on
  Telegram/Feishu/Google Chat), gated by the sender's privileges. A `/cowork` link
  never lands where a bystander without `agent.interact` can use it.

## Maintaining this doc

- The reference tables are the source of truth for the vocabulary. When you add,
  rename, or re-scope a command, edit the right table **and** the privilege legend
  **and** `commands.ts` + `textCommandHelpText()` in the same change, gate it on an
  org Access privilege
  (`authorizeChannelPrivilege`), and mirror the user-facing lines in
  [user-guide.md](user-guide.md). Move a row from Proposed to Shipped when it lands.
- Privilege names in **Requires** come from `ACCESS_PRIVILEGES`
  (`packages/hub/src/access/contract.ts`). If you cite one here, it must exist there.
- New product terms (`/cowork`, dynamic command, Guest group) go in
  [the glossary](../../glossary.md) when they ship; this doc links, it does not
  redefine.
