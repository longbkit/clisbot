# Timezone Config CLI And Loop Resolution

## Summary

Add a low-friction timezone model so prompt timestamps and wall-clock loops use the operator's intended timezone instead of silently depending on the host process timezone.

The user-facing concept should stay simple:

- the app has one default timezone
- an agent can override that when the assistant persona or workspace has a regional context
- a route can override that when one group, channel, or topic has a different timezone
- a single loop can override that without changing config

Do not make fresh users memorize IANA timezone values before they can start the app.

## Status

Implemented

## Decision

Do not try to infer the user's timezone from every Slack or Telegram message in the first implementation.

Instead:

- infer the host timezone only as a bootstrap default
- log what was inferred so the operator can catch UTC/server defaults early
- make `app.timezone` the canonical persisted default
- let the bot guide the user to set timezone later through CLI-backed actions
- keep per-user timezone profile as a later feature

Reason:

- current Telegram message payloads do not include a reliable sender timezone
- current Slack message events do not carry sender timezone without extra profile lookup scopes, caching, and fallback design
- most early teams share one practical timezone
- explicit operator config is safer than hidden guesses
- users can still mention a timezone naturally for one-off loop intent

## Pre-Implementation Truth

### Host timezone fallback

Before this change, the code used JavaScript host timezone discovery in some defaults:

```ts
Intl.DateTimeFormat().resolvedOptions().timeZone
```

That returns the timezone of the process environment, not the human sender.

On a UTC server, this often returns `UTC` even when the operator is in Vietnam.

### Existing config levels

The older schema and template already exposed several timezone fields:

- `app.control.loop.defaultTimezone`
- `bots.defaults.timezone`
- `bots.slack.defaults.timezone`
- `bots.telegram.defaults.timezone`
- `bots.slack.<botId>.timezone`
- `bots.telegram.<botId>.timezone`
- `directMessages["<id>"].timezone`
- `groups["<id>"].timezone`
- Telegram `groups["<chatId>"].topics["<topicId>"].timezone`

The older template seeded host timezone into:

- `bots.defaults.timezone`
- `bots.slack.defaults.timezone`
- `bots.telegram.defaults.timezone`

The older CLI did not expose first-class get, set, or clear commands for those timezone defaults.

Original gaps this task closes:

- `app.timezone` did not exist
- `agents.list[].timezone` did not exist
- prompt timestamp used host timezone, not the resolved app, agent, or route timezone
- `app.control.loop.defaultTimezone` is a loop-specific default, but the operator intent is usually "the app's default timezone"
- existing default-level bot timezone fields create drift because they are seeded everywhere but not easy to inspect or mutate through CLI

## Target Shape

### Minimal fresh config

Fresh bootstrap should write only the canonical app default, not duplicate the same timezone across every provider, bot, and agent.

```json
{
  "app": {
    "timezone": "Asia/Ho_Chi_Minh",
    "control": {
      "loop": {
        "maxRunsPerLoop": 20,
        "maxActiveLoops": 10
      }
    }
  },
  "agents": {
    "defaults": {},
    "list": [
      {
        "id": "default"
      }
    ]
  }
}
```

Notes:

- `app.timezone` is the canonical default for prompt timestamp and new wall-clock loops.
- `app.control.loop.defaultTimezone` should leave the template and user-facing docs after migration.
- `bots.defaults.timezone`, `bots.slack.defaults.timezone`, and `bots.telegram.defaults.timezone` should leave the target template and target config after migration.
- Existing runtime must keep reading `app.control.loop.defaultTimezone` as a legacy fallback.
- Existing persisted loop records keep their own `loop.timezone` snapshot and must not be migrated away.

### Optional overrides

Only set narrower timezone fields when there is a real difference from the app default.

```json
{
  "app": {
    "timezone": "Asia/Ho_Chi_Minh"
  },
  "agents": {
    "list": [
      {
        "id": "support-us",
        "timezone": "America/Los_Angeles"
      }
    ]
  },
  "bots": {
    "telegram": {
      "default": {
        "groups": {
          "-1001234567890": {
            "timezone": "America/Los_Angeles",
            "topics": {
              "4": {
                "timezone": "Asia/Singapore"
              }
            }
          }
        }
      }
    }
  }
}
```

## Mental Model

Guide, help, and bot responses should teach timezone in this order:

1. App timezone: the default for this clisbot install.
2. Agent timezone: use when a specific assistant persona, workspace, or role has a regional context.
3. Surface timezone: use when a specific group, channel, DM, or topic has a regional context.
4. One-off loop timezone: use when only this schedule should use another timezone.
5. Bot timezone: advanced/admin override only when a concrete bot identity has a different regional context.

This is the operator decision order, not the resolver specificity order. At runtime, a narrower route or topic override still wins over an agent override because it was explicitly scoped to the current surface.

Examples:

- "set timezone to Vietnam time" means set `app.timezone`
- "agent support-us uses LA time" means set `agents.list[].timezone`
- "this group uses LA time" means set the current route timezone
- "this topic uses Singapore time" means set the current topic route timezone
- "create this loop at 7am LA time" means pass a one-off loop timezone and do not change config

If the user says "this bot uses timezone X", ask one clarifying question because "bot" can mean app default, current agent, or current surface:

```text
Do you want to change the app default timezone, the current agent timezone, or only this group/topic?
```

## Effective Timezone Rule

Use one resolver for prompt timestamp and new wall-clock loop creation.

Resolution order:

1. explicit one-off loop timezone, for example `clisbot loops create ... --timezone <iana>`
2. route or topic timezone
3. agent timezone
4. bot timezone
5. `app.timezone`
6. legacy `app.control.loop.defaultTimezone`
7. legacy `bots.defaults.timezone`
8. legacy `bots.<provider>.defaults.timezone`
9. host timezone

Notes:

- explicit one-off wins because the command or user message named this specific schedule
- route wins over agent when the operator explicitly scoped the override to the current group, channel, DM, or topic
- agent wins over bot because agent timezone represents the assistant persona or workspace
- default-level bot timezone fields are legacy compatibility only and should not be part of the target happy path
- host timezone is the final fallback only

## Bootstrap Rule

Fresh start should not force timezone selection before the user can run clisbot.

Default command remains simple:

```bash
clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN --persist
```

Bootstrap behavior:

1. infer host timezone with `Intl.DateTimeFormat().resolvedOptions().timeZone`
2. write `app.timezone` to the inferred timezone
3. do not seed the same timezone into agent, bot, provider, or route overrides
4. log the detected timezone, configured app timezone, and how to change it
5. if the host timezone is `UTC` or `Etc/UTC`, print a stronger warning that this may be the server timezone

Optional automation flag remains useful but should not be the main happy path:

```bash
clisbot start --cli codex --bot-type personal --timezone Asia/Ho_Chi_Minh --telegram-bot-token TELEGRAM_BOT_TOKEN --persist
clisbot init --cli codex --bot-type team --timezone Asia/Ho_Chi_Minh
```

Example startup log:

```text
Detected host timezone: Etc/UTC
Configured app timezone: Etc/UTC
Warning: host timezone is UTC. This may be a server timezone, not your real working timezone.
To change it, ask the bot "set timezone to Vietnam time" or run: clisbot timezone set Asia/Ho_Chi_Minh
```

## CLI Surface Proposal

### App timezone

This is the primary user-facing CLI.

```bash
clisbot timezone get
clisbot timezone set Asia/Ho_Chi_Minh
clisbot timezone clear
clisbot timezone doctor
```

`set` mutates `app.timezone`. Help should not teach legacy `app.control.loop.defaultTimezone`; migration removes that field from persisted config.

### Agent timezone

Use the same `get-<key>` / `set-<key>` / `clear-<key>` style used by other control CLIs.

```bash
clisbot agents get-timezone --agent default
clisbot agents set-timezone --agent support-us America/Los_Angeles
clisbot agents clear-timezone --agent support-us
```

Do not add `agents.defaults.timezone` in the first implementation. App timezone covers the normal global default; per-agent timezone is the only agent-level override.

### Route timezone

Use route timezone when the place where the conversation happens has its own regional context.

```bash
clisbot routes get-timezone --channel telegram group:-1001234567890 --bot default
clisbot routes set-timezone --channel telegram group:-1001234567890 --bot default America/Los_Angeles
clisbot routes clear-timezone --channel telegram topic:-1001234567890:4 --bot default
```

### Bot timezone

Keep this as advanced/admin CLI, not the main guide path.

```bash
clisbot bots get-timezone --channel telegram --bot default
clisbot bots set-timezone --channel telegram --bot default Asia/Ho_Chi_Minh
clisbot bots clear-timezone --channel telegram --bot default
```

Provider-default and cross-provider bot-default timezone commands should not be added. Existing default-level timezone fields are migrated into `app.timezone` and removed from old configs.

### Loop timezone

Keep loop creation low-friction.

Default behavior:

- if no timezone is passed, new calendar loops use the effective timezone resolver
- interval and times loops do not need timezone
- calendar loops persist the resolved timezone on the loop record at creation time
- operator CLI creation asks for timezone confirmation before creating the first wall-clock loop
- chat `/loop` creation persists immediately to avoid conversational friction, then prints enough information for the user to verify and fix quickly if the timezone is wrong

Optional one-off override:

```bash
clisbot loops create --channel telegram --target -1001234567890 --sender telegram:1276408333 --timezone America/Los_Angeles every day at 07:00 check tickets
```

Do not add slash `/loop --timezone ...` in the first pass unless needed. In chat, the model can understand natural language such as "7am LA time" and pass the timezone through the CLI/tooling path.

Agent-bound prompt guidance should stay minimal:

```text
For schedule/loop/reminder requests, inspect `clisbot loops --help` and use the loops CLI.
```

The prompt should not teach loop syntax, timezone resolver internals, or first-loop state. `clisbot loops --help` and the loop create command output are the source of truth for CLI-backed loop creation.

### First wall-clock loop confirmation

When no wall-clock loop has been created successfully yet, the operator CLI must refuse to create the first wall-clock loop until timezone is confirmed, regardless of whether the effective timezone came from app config, migration, or host-detected bootstrap.

AI agents must not infer this state themselves. They should run the loops CLI and follow its output.

Chat slash command exception:

- `/loop every ...` creates immediately because an extra confirmation turn is too much friction in chat
- the response must include timezone, next run in local time plus UTC, and exact cancel guidance
- if timezone is wrong, the user can cancel the loop, ask the bot to set the correct timezone, then create the loop again

Example user message:

```text
mỗi sáng 7h tổng hợp thông tin
```

Example first CLI create output:

```text
confirmation_required: first wall-clock loop
proposed schedule: every day at 07:00
timezone: Asia/Ho_Chi_Minh
next run: 2026-04-27 07:00 Asia/Ho_Chi_Minh

Anh muốn tạo loop mỗi ngày lúc 07:00 Asia/Ho_Chi_Minh đúng không?
Nếu timezone chưa đúng, anh nói "đổi timezone sang <timezone>" trước, rồi em tạo loop sau.

If correct, rerun with:
clisbot loops create ... --confirm
```

If the user confirms:

- rerun the same create command with the confirmation flag
- create the loop only after `--confirm` is present
- persist the resolved `timezone` snapshot on the loop record
- reply with schedule, timezone, and next run

If the user says the timezone is wrong:

- guide the bot to set the right timezone first, usually with `clisbot timezone set <iana>`
- then create the loop using the updated effective timezone

After the first successful CLI wall-clock loop, do not ask this extra confirmation again. Every loop creation response must still show the timezone clearly:

```text
Đã tạo loop mỗi ngày lúc 07:00 Asia/Ho_Chi_Minh.
Next run: 2026-04-27 07:00 Asia/Ho_Chi_Minh.
```

## Migration Plan

### Config migration on first start after upgrade

Run migration only when `meta.schemaVersion` is older than the target schema version.

Steps:

1. create a timestamped backup of the existing config file
2. log the backup path
3. dry-run the new config document and validate it
4. apply the config update only after validation passes
5. log success with the new schema version

### Timezone field migration

This migration intentionally cleans the old default-level timezone shape. The target is not just to copy values into `app.timezone`; the target is to remove the old default fields from the persisted config so they cannot shadow app or agent timezone later.

Rules:

1. If `app.timezone` exists, keep it.
2. Else if `app.control.loop.defaultTimezone` exists, move that value to `app.timezone`.
3. Else if `bots.defaults.timezone` exists, move that value to `app.timezone`.
4. Else if a provider default timezone exists, move the first existing provider default value to `app.timezone`.
5. Else infer host timezone and write it to `app.timezone`.
6. Remove `app.control.loop.defaultTimezone` from the config document after migration.
7. Remove `bots.defaults.timezone`, `bots.slack.defaults.timezone`, and `bots.telegram.defaults.timezone` from the config document after migration.
8. Keep concrete bot and route timezone overrides because those are narrower than app default and more likely to be intentional.
9. Keep runtime read compatibility for old default-level timezone fields only as a pre-migration fallback.
10. Do not mutate persisted loop records or remove `loop.timezone`.

Removal scope:

- remove `app.control.loop.defaultTimezone`
- remove `bots.defaults.timezone`
- remove `bots.slack.defaults.timezone`
- remove `bots.telegram.defaults.timezone`
- do not introduce `agents.defaults.timezone`
- do not remove `bots.<provider>.<botId>.timezone`
- do not remove route, DM, group, or topic `timezone`
- do not remove persisted loop-record `timezone`

Important distinction:

- `app.control.loop.defaultTimezone` is legacy config and can migrate to `app.timezone`.
- default-level bot timezone fields are legacy defaults and migrate to `app.timezone` for `0.1.44` and older configs.
- concrete bot and route timezone fields are explicit overrides and should remain supported.
- persisted `loop.timezone` is execution state for an existing wall-clock loop and must stay stable so old loops do not shift after upgrade.

Example log:

```text
config migration: backed up existing config to /home/user/.clisbot/config.backup.20260426T141500Z.json
config migration: migrated app.control.loop.defaultTimezone=Asia/Ho_Chi_Minh to app.timezone
config migration: removed legacy default-level bot timezone fields after moving timezone default to app.timezone
config migration: validated upgraded config schemaVersion=0.1.45
config migration: applied upgraded config successfully
config migration: existing persisted loops keep their stored timezone snapshots and will not shift
```

## Message-Level Timezone Detection

Current Slack and Telegram inbound messages are not enough for confident automatic timezone detection.

Telegram:

- the current payload used by clisbot includes user id, username, first name, last name, bot flag, and language code
- it does not include a reliable timezone

Slack:

- the current event path uses user id, channel id, thread id, and team id
- normal message events do not carry the sender timezone
- Slack user profile lookup may expose timezone through a separate API call when scopes allow it, but that needs caching, permissions, and fallback design

Decision:

- do not infer timezone silently from message payload
- use config first
- let users mention timezone naturally in the prompt for one-off intent
- later add user profile timezone storage as a separate feature

## Implementation Plan

1. Schema and template:
   add `app.timezone` and `agents.list[].timezone`; remove legacy loop default and default-level bot timezone fields from fresh template; do not add `agents.defaults.timezone`.
2. Migration:
   bump schema version; backup, dry-run, validate, then migrate legacy default timezone fields to `app.timezone`.
3. Resolver:
   add one shared effective timezone resolver and use it for prompt timestamp and new wall-clock loop creation.
4. CLI:
   add `clisbot timezone`; add agent, route, and bot timezone get/set/clear commands using the existing `get-timezone` / `set-timezone` / `clear-timezone` command style; add `clisbot loops create --confirm` for first wall-clock loop confirmation retry.
5. Status/logs:
   show host timezone, app timezone, effective source, and timezone correction guidance in start/status output.
6. Bot guidance:
   update the agent-bound prompt with exactly: `For schedule/loop/reminder requests, inspect \`clisbot loops --help\` and use the loops CLI.`
7. Tests:
   cover old config migration, no-shift persisted loops, resolver precedence, CLI mutations, first wall-clock loop confirmation refusal, confirmed create retry, and UTC host warning output.
8. Docs:
   update user guide, CLI commands, feature docs, release notes, and backlog with the same mental model.

## Future User Profile Direction

Later, add a profile layer for per-user timezone:

```json
{
  "profiles": {
    "telegram:1276408333": {
      "timezone": "Asia/Ho_Chi_Minh"
    },
    "slack:U1234567890": {
      "timezone": "America/Los_Angeles"
    }
  }
}
```

That future work should decide:

- who can set or clear a user's timezone
- whether a user can self-set timezone from chat
- whether Slack profile timezone lookup is enabled
- how long external lookup results are cached
- how app timezone, per-agent timezone, surface timezone, and per-user timezone interact when creating shared loops

## Exit Criteria

- fresh start writes `app.timezone` without forcing timezone input
- start/status output clearly shows detected and configured timezone
- app timezone CLI exists and mutates canonical config safely
- agent timezone CLI exists for agent-specific overrides
- route timezone get/set/clear exists for surface-specific overrides
- loop CLI accepts optional `--timezone` for one-off calendar loops
- first CLI wall-clock loop creation returns a confirmation-required response without creating the loop
- rerunning the same loop create command with `--confirm` creates the first wall-clock loop
- chat `/loop` wall-clock creation returns timezone, local next run, UTC next run, and cancel guidance after creating the loop
- persisted loops keep their stored timezone and do not shift after config migration
- prompt timestamp uses the effective timezone instead of host timezone when available
- docs and CLI help teach app default, agent override, surface override, and one-off loop override in that order
