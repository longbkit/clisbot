---
title: Target Config And CLI Migration Inventory
date: 2026-04-18
area: configuration, control, channels, agents
summary: Implementation inventory for moving clisbot from the current channels/accounts/bindings model to the target app/bots/routes/agents mental model without leaving hidden legacy writers behind.
related:
  - config/clisbot.json.template
  - config/clisbot.json.v0.1.0.template
  - config/clisbot.json.v0.1.39.template
  - src/config/schema.ts
  - src/config/load-config.ts
  - src/control/accounts-cli.ts
  - src/control/channels-cli.ts
  - src/control/agents-cli.ts
---

# Goal

## Historical Note

This research doc records the 2026-04-18 migration inventory and proposal work.

It is not the stable contract source. For the current contract, use:

- `README.md`
- `docs/features/configuration/README.md`
- `docs/user-guide/channels.md`
- `docs/user-guide/cli-commands.md`

Compatibility note:

- older proposal examples in this doc may show prefixed route keys such as `channel:<id>`, `group:<id>`, or `dm:*`
- current canonical stored JSON uses raw ids under `groups` and `directMessages`
- operator-facing route ids still use `group:*`, `dm:*`, and `topic:<chatId>:<topicId>`

Refactor the runtime and operator surfaces so the product reads like this:

1. `app`
2. `bots`
3. `routes`
4. `agents`

North star:

- clean target model
- no accidental legacy writes
- no hidden compatibility paths that silently stay canonical forever
- one obvious user mental model across config, CLI, status, and docs

# Official Template Status

- `config/clisbot.json.template` is now restored as the official template name.
- `config/clisbot.json.v0.1.0.template` remains the archived old-shape snapshot.
- `config/clisbot.json.v0.1.39.template` remains the design reference for the current target direction.

# Progress Snapshot

## Completed so far

- public template, docs, and help were moved onto the official `app` + `bots` + `agents` model
- `accounts` no longer acts like an official writer path
- bot-aware runtime route resolution is already in place for the migrated Slack and Telegram slices
- the previously stale regression sweep is now migrated across:
  - `test/fast-start.e2e.test.ts`
  - `test/runtime-supervisor.test.ts`
  - `test/runner-cli.integration.test.ts`
  - `test/runtime-monitor.test.ts`
  - `test/loops-cli.test.ts`
  - `test/auth-resolve.test.ts`
  - `test/agents-cli.test.ts`
  - `test/interaction-processing.test.ts`
  - `test/owner-claim.test.ts`
  - `test/message-cli.test.ts`
- migrated regression batch is green for:
  - `test/config-template.test.ts`
  - `test/config.test.ts`
  - `test/accounts-cli.test.ts`
  - `test/channels-cli.test.ts`
  - `test/bots-cli.test.ts`
  - `test/routes-cli.test.ts`
  - `test/runtime-summary.test.ts`
  - `test/mode-config-shared.test.ts`
  - `test/telegram-route-config.test.ts`
  - `test/telegram-service.test.ts`
  - `test/slack-feedback.test.ts`
  - `test/slack-session-routing.test.ts`
  - `test/agent-service.test.ts`
  - `test/agent-prompt.test.ts`
  - `test/cli.test.ts`
  - `test/startup-bootstrap.test.ts`
  - `test/channel-credentials.test.ts`
  - `test/runtime-process.test.ts`
  - `test/channel-bots.test.ts`
- broad migration verification is now green at `277 pass, 0 fail`
- `bunx tsc --noEmit` is now green in this workspace

## Remaining obvious stale-test sweep

- no obvious stale first-wave regression cluster remains

# Current Canonical Truth

The official runtime and operator contract is now centered on:

- config root sections `app`, `bots`, and `agents`
- bot-local route ownership for Slack and Telegram
- official operator CLI surfaces `bots` and `routes`
- fail-fast behavior for removed legacy mutating surfaces

What still remains is convergence cleanup, not first-wave migration:

- dead compatibility-only helper files with old guidance have been removed from the active codebase
- current user guide, startup help, and main feature-doc entry points already point at the bot-rooted contract
- older research and task artifacts still need a lighter historical sweep so they do not read like current product guidance

# Target Mental Model

## Top-Level Sections

- `app`: global runtime behavior
- `bots`: provider-specific bot definitions and bot defaults
- `routes`: optional explicit route map if the CLI uses it as an operator surface
- `agents`: agent identities plus runner defaults

## Product Rule

The operator should be able to think in either direction:

1. bot-first
2. route-first
3. agent-first

without learning a different naming model for each surface.

# Config Path Mapping

## Global Paths

| Current path | Target path | Notes |
| --- | --- | --- |
| `tmux.socketPath` | `agents.defaults.runner.defaults.tmux.socketPath` or equivalent runner-default path | Must stay agent-runner owned, not channel-owned |
| `session.mainKey` | `app.session.mainKey` | Keep for single-person shared-session use case |
| `session.identityLinks` | `app.session.identityLinks` | Global identity linking |
| `session.storePath` | `app.session.storePath` | Durable session metadata path |
| `session.dmScope` | `bots.defaults.dmScope` | DM routing identity belongs closer to inbound bot surfaces |
| `control.*` | `app.control.*` | Global operator/runtime behavior |
| `app.auth.*` | `app.auth.*` | Stays global |

## Agent Paths

| Current path | Target path | Notes |
| --- | --- | --- |
| `agents.defaults.workspace` | `agents.defaults.workspace` | Keep |
| `agents.defaults.runner` | `agents.defaults.runner.defaults` plus CLI-family branches if needed | Normalize runner family ownership cleanly |
| `agents.defaults.stream` | `agents.defaults.runner.defaults.stream` or `agents.defaults.stream` | Must choose one canonical owner and use it everywhere |
| `agents.defaults.session` | `agents.defaults.session` | Keep unless runner/session ownership changes |
| `agents.list[].cliTool` | `agents.list[].cli` | User-facing naming cleanup |
| `agents.list[].bootstrap.mode` | `agents.list[].bootstrap.botType` | Align with product language |

## Bot Paths

| Current path | Target path | Notes |
| --- | --- | --- |
| `channels.slack.defaultAccount` | `bots.slack.defaultBotId` | rename account -> bot |
| `channels.telegram.defaultAccount` | `bots.telegram.defaultBotId` | rename account -> bot |
| `channels.slack.accounts.<id>` | `bots.slack.<id>` | flatten account nesting |
| `channels.telegram.accounts.<id>` | `bots.telegram.<id>` | flatten account nesting |
| provider root token fields | provider bot fields only | stop using root provider token fallback as canonical |
| `channels.slack.defaultAgentId` | `bots.slack.<defaultBotId>.agentId` or provider default fallback | remove duplicated routing source |
| `channels.telegram.defaultAgentId` | `bots.telegram.<defaultBotId>.agentId` or provider default fallback | remove duplicated routing source |
| `bindings` fallback account binding | bot `agentId` | move fallback routing into the bot |

## Route Paths

| Current path | Target path | Notes |
| --- | --- | --- |
| `channels.slack.channels.<id>` | `bots.slack.<botId>.groups."<id>"` or `routes.slack."<id>"` | current canonical stored keys use raw ids; older prefixed keys remain compatibility inputs only |
| `channels.slack.groups.<id>` | `bots.slack.<botId>.groups."<id>"` or `routes.slack."<id>"` | same ownership rule; CLI may still accept compatibility aliases like `channel:<id>` or `group:<id>` |
| `channels.telegram.groups.<chatId>` | `bots.telegram.<botId>.groups."<chatId>"` or `routes.telegram."<chatId>"` | same ownership rule |
| `channels.telegram.groups.<chatId>.topics.<topicId>` | topic child under target route shape | preserve Telegram topic override |
| `channels.slack.directMessages` | bot DM config under `bots.slack.<botId>.directMessages` | current canonical default key is `directMessages["*"]` |
| `channels.telegram.directMessages` | bot DM config under `bots.telegram.<botId>.directMessages` | current canonical default key is `directMessages["*"]` |

# Current Code Ownership Map

## Schema And Loading

These files define or materialize the current old shape:

- `src/config/schema.ts`
- `src/config/template.ts`
- `src/config/load-config.ts`
- `src/config/config-file.ts`
- `src/config/duration.ts`
- `src/config/env-substitution.ts`

## Bot Credential And Bootstrap Writers

- `src/config/channel-bot-management.ts`
- `src/config/channel-bots.ts`
- `src/config/channel-credentials.ts`
- `src/config/channel-credentials-shared.ts`
- `src/config/channel-runtime-credentials.ts`
- `src/control/channel-bootstrap-flags.ts`
- `src/control/runtime-bootstrap-cli.ts`

## Fallback Binding Logic

- `src/config/bindings.ts`
- `src/control/channels-cli.ts`
- `src/control/agents-cli.ts`
- any runtime route resolver still calling `resolveTopLevelBoundAgentId`

## Operator Read Surfaces

- `src/control/runtime-summary.ts`
- `src/control/runtime-summary-rendering.ts`
- `src/control/runtime-health-store.ts`
- `src/control/startup-bootstrap.ts`
- `src/cli.ts`

# Files That Still Read Or Write Old Canonical Paths

## Must Change In The First Implementation Wave

- `src/config/schema.ts`
- `src/config/template.ts`
- `src/config/load-config.ts`
- `src/config/channel-bot-management.ts`
- `src/config/channel-credentials.ts`
- `src/config/channel-credentials-shared.ts`
- `src/config/channel-bots.ts`
- `src/config/bindings.ts`
- `src/control/channel-bootstrap-flags.ts`
- `src/control/runtime-bootstrap-cli.ts`
- `src/control/accounts-cli.ts`
- `src/control/channels-cli.ts`
- `src/control/channels-cli-rendering.ts`
- `src/control/agents-cli.ts`
- `src/control/runtime-summary.ts`
- `src/control/runtime-health-store.ts`
- `src/control/startup-bootstrap.ts`
- `src/cli.ts`

## Must Review Before Claiming Migration Complete

- `src/channels/slack/*`
- `src/channels/telegram/*`
- `src/agents/*` route resolution entrypoints
- `src/control/message-cli.ts`
- tests that assert exact config JSON shape
- docs that still teach `channels`, `accounts`, or `bindings` as the product model

# Target Runtime Contract

## Rule 1

Runtime should load one canonical target shape.

That means:

- parser may temporarily read old shape only at the boundary
- normalization must convert old shape into one internal canonical structure
- everything downstream should read the normalized target shape only

## Rule 2

Writers should only write the target shape.

That means:

- no new writes to `bindings`
- no new writes to `channels.<provider>.accounts`
- no new writes to provider root token fields unless explicitly kept as target contract
- no mixed write path where one command writes `bots` and another still writes `channels`

## Rule 3

Status must describe the same mental model the config and CLI use.

That means:

- `clisbot status`
- startup warnings
- runtime health actions
- CLI help

all need to speak in terms of bots and routes, not legacy accounts and bindings.

# CLI Surface Inventory

## Current

- `clisbot channels ...`
- `clisbot accounts ...`
- `clisbot agents bind ...`

## Target

- `clisbot bots ...`
- `clisbot routes ...`
- `clisbot agents ...`

## Expected Behavior Direction

- `add` should mean create-only
- `set-...` should mean overwrite or reassign
- `remove` should mean delete
- if `add` hits an existing resource, CLI should explain which `set-...` command to use
- `--bot` should be the only bot selector for route-facing commands
- `--channel` should stay explicit when selecting a provider

# Tests That Will Need Rewrite

High-confidence impacted tests:

- `test/config-template.test.ts`
- `test/config.test.ts`
- `test/accounts-cli.test.ts`
- `test/channels-cli.test.ts`
- `test/agents-cli.test.ts`
- `test/bootstrap.test.ts`
- `test/startup-bootstrap.test.ts`
- `test/runtime-summary.test.ts`
- `test/channel-bots.test.ts`
- `test/channel-credentials.test.ts`
- `test/cli.test.ts`

Likely impacted by downstream route resolution:

- `test/slack-feedback.test.ts`
- `test/telegram-service.test.ts`
- `test/interaction-processing.test.ts`
- `test/agent-service.test.ts`
- `test/session-key.test.ts`
- `test/message-cli.test.ts`

# Migration Strategy

## Phase 0

Freeze the artifact boundary:

- official template name restored
- migration inventory documented

## Phase 1

Introduce one canonical normalized target model in `src/config`.

Output of `loadConfig()` should become the target shape even if temporary legacy input support exists.

## Phase 2

Move all writers to the target model:

- bootstrap
- credential persistence
- bot management
- route management
- agent default routing

## Phase 3

Move all readers to the target model:

- runtime summary
- startup/bootstrap messaging
- route resolution
- health hints

## Phase 4

Rename public CLI surface:

- parser
- help text
- docs
- tests

## Phase 5

Remove legacy writes and legacy user-guide language.

Compatibility should be loader-only, clearly bounded, and easy to delete later.

# Obvious Risks

## Risk 1: Mixed Canonical Writes

If one command still writes `bindings` while another writes bot-local `agentId`, routing will become ambiguous fast.

## Risk 1.5: Current Runtime Cannot Represent Route-Owned Bot Selection

This is the most important migration blocker discovered during inventory.

Current runtime facts:

- Slack and Telegram services already run per `accountId`
- session keys already carry `accountId`
- fallback binding resolution already accepts `accountId`
- but route config is still provider-global:
  - `channels.slack.channels`
  - `channels.slack.groups`
  - `channels.slack.directMessages`
  - `channels.telegram.groups`
  - `channels.telegram.directMessages`

Current route resolution does not carry a canonical `botId` or `accountId` on the route itself.

That means the target model:

- one Slack provider
- multiple bots
- different routes owned by different bots

cannot be represented truthfully by a loader-only translation into the current runtime shape.

Affected runtime files that prove this:

- `src/channels/slack/route-config.ts`
- `src/channels/telegram/route-config.ts`
- `src/channels/route-policy.ts`
- `src/config/bindings.ts`

Migration consequence:

- a config-boundary shim alone is not enough
- route storage and route resolution must become bot-aware before multi-bot target config can be treated as fully implemented
- until that refactor lands, any target config support must either stay clearly partial or stay limited to one bot per provider

## Risk 2: Bootstrap Drift

`start` and `init` currently touch many config paths indirectly. If they are not migrated together, first-run behavior will keep reintroducing old shape.

## Risk 3: Status Lies

If runtime summary still reports `defaultAgentId`, `defaultAccount`, or `channels.*` after the write path changes, operator trust will drop.

## Risk 4: Credential Regression

Slack uses two credentials per bot. Telegram uses one. A shape cleanup must not lose:

- `credentialType`
- `tokenFile`
- `appTokenFile`
- `botTokenFile`
- runtime-only mem credentials
- canonical credential file fallback

# Self-Review Checklist Before Coding

- every writer path is identified
- every reader path is identified
- bootstrap flow is included
- runtime status flow is included
- credential persistence flow is included
- tests that pin old JSON shape are listed
- target contract is canonical at one layer only
- legacy input support, if kept at all, is loader-only and removable

# Immediate Next Implementation Order

1. `src/config/schema.ts`
2. `src/config/load-config.ts`
3. `src/config/template.ts`
4. `src/config/channel-credentials*.ts`
5. `src/config/channel-bot-management.ts`
6. `src/control/runtime-bootstrap-cli.ts`
7. `src/control/accounts-cli.ts` -> target `bots` surface
8. `src/control/channels-cli.ts` -> target `routes` surface
9. `src/control/agents-cli.ts` routing cleanup
10. `src/control/runtime-summary*.ts`
11. CLI help, docs, tests
