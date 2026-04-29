---
title: clisbot Template v0.1.39 Comparison, Mapping, and Migration Plan
date: 2026-04-18
area: configuration, bots, agents, runners
summary: Compare the shipped v0.1.0 template with the revised v0.1.39 proposal where config is reorganized into app, bots, and agents while still surfacing every routing and feedback concept that current code already supports.
related:
  - config/clisbot.json.v0.1.0.template
  - config/clisbot.json.v0.1.39.template
  - src/config/template.ts
  - src/config/schema.ts
---

# Status

## Historical Note

This doc is a design-era comparison for the v0.1.39 proposal.

It should be read as historical migration context, not as the current canonical config contract.

Current canonical shape:

- `directMessages["*"]`
- `directMessages["<id>"]`
- `groups["*"]`
- `groups["<id>"]`
- Telegram topics under `groups["<chatId>"].topics["<topicId>"]`

Compatibility note:

- operator-facing route ids still use `dm:*`, `group:*`, and `topic:<chatId>:<topicId>`
- legacy storage-like aliases such as `channel:<id>` and `group:<id>` are accepted as compatibility input only

- `config/clisbot.json.v0.1.0.template` is the current shipped runtime template.
- `config/clisbot.json.v0.1.39.template` is the proposed next-shape template.
- `v0.1.39` is still a design artifact. It documents the target mental model and the migration contract. It does not claim current runtime parsing is already switched.

# Design Goal

The new shape should be easier to scan in this order:

1. `app`: global system behavior
2. `bots`: inbound surfaces and bot-specific routing policy
3. `agents`: agent identity plus runner defaults

At the same time, it should not silently drop any concept that current code already supports.

# Coverage Added In The Proposed Template

The current `v0.1.39` sample now brings out all important runtime concepts that are already present in current code, including:

- Slack `channelPolicy` and `groupPolicy`
- DM-specific route blocks for Slack and Telegram
- route-local `allowBots`
- route-local `commandPrefixes`
- route-local `streaming`
- route-local `response`
- route-local `responseMode`
- route-local `additionalMessageMode`
- route-local `surfaceNotifications`
- route-local `verbose`
- route-local `followUp`
- route-local `timezone`
- Slack `ackReaction`, `typingReaction`, and `processingStatus`
- Telegram `polling`
- credential source fields such as `credentialType`, `tokenFile`, `appTokenFile`, and `botTokenFile`

# Comparison Summary

## v0.1.0

- top-level shape is `tmux`, `session`, `app`, `agents`, `bindings`, `control`, `channels`
- channel config is provider-rooted under `channels`
- account fallback routing is split across route objects and top-level `bindings`
- Slack and Telegram route-local knobs exist, but they are scattered across provider-root config

## v0.1.39

- top-level shape is `meta`, `app`, `bots`, `agents`
- `app` owns global session persistence, auth, and control
- `bots` owns inbound policy, credentials, DM/group admission, and route-level agent overrides
- `agents.defaults` still owns the runner family defaults because runner choice follows the agent CLI
- top-level bindings disappear from the target mental model
- routing becomes a simple cascade:
  - route `agentId`
  - bot `agentId`
  - `agents.defaults.defaultAgentId`

# Key Decisions

## 1. Keep `defaults` for config bags

- use `defaults` when a node means inherited defaults
- use `default` when a node means one concrete bot or agent id

That keeps scanning predictable:

- `bots.defaults`
- `bots.slack.defaults`
- `bots.slack.default`
- `agents.defaults`

## 2. Keep runner defaults under `agents.defaults`

The current target no longer uses a separate top-level `runners` tree.

Instead:

- `agents.defaults.runner.defaults` owns shared runner behavior
- `agents.defaults.runner.codex` owns Codex-specific launch and session-id behavior
- `agents.defaults.runner.claude` owns Claude-specific launch and session-id behavior
- `agents.list[].runner` is the per-agent override escape hatch

This keeps the mental rule simple:

- if the agent uses `codex`, it inherits the Codex runner defaults
- if the agent uses `claude`, it inherits the Claude runner defaults
- if one agent needs something special, override that agent only

## 3. Rename `channels` to `bots`

The config is easier to understand when the operator thinks:

- which bot exists
- which channels or groups that bot is allowed to serve
- which agent that bot should route to by default

That is more natural than starting from the transport tree alone.

## 4. Flatten bot ids directly under each provider

The target shape uses:

- `bots.slack.default`
- `bots.slack.support`
- `bots.telegram.default`
- `bots.telegram.support`

It intentionally avoids one more `accounts` nesting layer.

## 5. Keep DM policy and DM route config separate

The target shape keeps:

- bot-level `dmPolicy` for the simple admission rule
- bot-level `directMessages` for route-local DM overrides already supported today

This avoids hiding current code behavior such as DM-local `responseMode`, `streaming`, or `followUp`.

## 6. Keep Slack `channelPolicy` visible

Even though the target mental model tries to stay simple, current code still distinguishes:

- Slack public channel fallback via `channelPolicy`
- Slack group or private-conversation fallback via `groupPolicy`

That difference is now kept visible in the proposal so current supported behavior is not lost.

# Path Mapping

| v0.1.0 path | v0.1.39 target | Notes |
| --- | --- | --- |
| root `session.mainKey` | `app.session.mainKey` | legacy OpenClaw-compatible shared session key name |
| root `session.identityLinks` | `app.session.identityLinks` | global session identity links |
| root `session.storePath` | `app.session.storePath` | session persistence location |
| root `session.dmScope` | `bots.defaults.dmScope` | DM isolation belongs closer to inbound bot surfaces |
| root `tmux.socketPath` | `agents.defaults.runner.defaults.tmux.socketPath` | runner infrastructure |
| root `control.*` | `app.control.*` | global control plane |
| root `defaultAgentId` | `agents.defaults.defaultAgentId` | global fallback agent |
| `agents.defaults.bootstrap.mode` | `agents.defaults.bootstrap.botType` | naming fix |
| `agents.list[].cliTool` | `agents.list[].cli` | naming alignment |
| `channels.slack.defaultAccount` | `bots.slack.defaults.defaultBotId` | default Slack bot id |
| `channels.telegram.defaultAccount` | `bots.telegram.defaults.defaultBotId` | default Telegram bot id |
| `channels.slack.accounts.<id>` | `bots.slack.<id>` | bot-rooted Slack config |
| `channels.telegram.accounts.<id>` | `bots.telegram.<id>` | bot-rooted Telegram config |
| `bindings[].agentId` for provider/account fallback | provider bot `agentId` | routing moves into the bot |
| `channels.slack.directMessages.*` | `bots.slack.<id>.directMessages.*` | DM-local Slack overrides remain explicit; canonical default key is `directMessages["*"]` |
| `channels.telegram.directMessages.*` | `bots.telegram.<id>.directMessages.*` | DM-local Telegram overrides remain explicit; canonical default key is `directMessages["*"]` |
| `channels.slack.channels.<id>` and `channels.slack.groups.<id>` | `bots.slack.<id>.groups."<id>"` | current canonical stored keys use raw ids; prefixed aliases are compatibility-only inputs |
| `channels.telegram.groups.<chatId>` | `bots.telegram.<id>.groups."<chatId>"` | Telegram group root |
| `channels.telegram.groups.<chatId>.topics.<topicId>` | `bots.telegram.<id>.groups."<chatId>".topics."<topicId>"` | Telegram topic override |

# Resolution Order

Proposed final order:

1. explicit message-level agent selection
2. route `agentId`
3. bot `agentId`
4. `agents.defaults.defaultAgentId`

# Why This Shape Reads Better

It matches the three most common operator starting points.

## 1. Bot-first

- “I just added a new Slack app or Telegram bot.”
- “Which agent is the default for this bot?”
- “Which groups, channels, or topics should this bot handle?”

## 2. Agent-first

- “I just created a new agent.”
- “Which existing bot should expose it?”
- “Which routes should override away from the bot default?”

## 3. Route-first

- “I need this Slack channel or Telegram topic enabled.”
- “Under which bot?”
- “Does it use the bot default agent or override to another agent?”

# Migration Plan

## Phase 1. Versioned artifacts only

- keep shipping `config/clisbot.json.v0.1.0.template`
- add and iterate on `config/clisbot.json.v0.1.39.template`
- treat `v0.1.39` as the contract discussion artifact

## Phase 2. Parser compatibility

- accept both old and new naming for:
  - `bootstrap.mode` and `bootstrap.botType`
  - `cliTool` and `cli`
- introduce compatibility loaders that can read both `channels` and `bots`

## Phase 3. Structural normalization

- map root `session.dmScope` to `bots.defaults.dmScope`
- map provider `defaultAccount` to provider `defaultBotId`
- map provider account objects into direct bot objects
- map top-level bindings into bot-level fallback `agentId`

## Phase 4. Route normalization

- map Slack public channels and Slack groups into the unified `groups` map with explicit key prefixes
- map Slack and Telegram direct-message blocks into `bot.directMessages`
- preserve route-local behavior fields such as `responseMode`, `additionalMessageMode`, `streaming`, `verbose`, `followUp`, `surfaceNotifications`, and `timezone`

## Phase 5. Legacy removal

- once runtime, docs, and CLI all agree on `bots`, remove `bindings`
- once runtime, docs, and CLI all agree on `bots`, remove provider-root token fields and old `channels` names
- only remove a legacy field after the new path is fully implemented, documented, and status-visible
- stop writing top-level `bindings`

## Phase 5: CLI migration

- make route admission commands account-aware by default
- let account creation flows accept a default agent at creation time
- support route-level override agent directly on the route command or through a dedicated follow-up command

## Phase 6: remove legacy writes

- stop writing:
  - provider-root token fields
  - top-level `bindings`
  - legacy route-level `agentId`
  - `bootstrap.mode`
  - `cliTool`

# Suggested CLI Direction

Low-level model:

```bash
clisbot accounts add slack --account alerts --agent claude
clisbot routes add slack-channel C07U0LDK6ER --account alerts
clisbot routes bind slack-channel C07U0LDK6ER --account alerts --agent reviewer
```

High-level orchestration can still exist later:

```bash
clisbot accounts setup slack --account alerts
clisbot agents setup reviewer
clisbot routes setup slack-channel C07U0LDK6ER
```

# Non-Goals For This Step

- implementing the full parser/runtime support for `v0.1.39`
- changing current shipped behavior beyond template and proposal docs
- claiming the current runtime already resolves account agent and route agent with this new precedence
