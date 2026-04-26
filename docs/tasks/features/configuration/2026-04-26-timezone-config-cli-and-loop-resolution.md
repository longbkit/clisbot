# Timezone Config CLI And Loop Resolution

## Summary

Add explicit timezone configuration surfaces for app, agents, and routed surfaces so wall-clock loops and prompt timestamps do not depend on host timezone unless no operator intent exists.

## Status

Planned

## Decision

Do not try to infer the user's timezone from every Slack or Telegram message in the first implementation.

Instead, make timezone a clear operator-configured setting, then use that setting consistently across prompt context and loop scheduling.

Reason:

- most early team groups use one practical shared timezone
- explicit config is more reliable than weak message-level inference
- multi-country groups and customer-support bots remain important, but they need a later user-profile model rather than a hidden guess
- users can still mention the desired timezone in natural language when creating a one-off loop
- a future user profile store can persist per-user timezone without changing the basic app or agent fallback model

## Current Truth

### Host timezone fallback

The code currently uses JavaScript host timezone discovery in some defaults:

```ts
Intl.DateTimeFormat().resolvedOptions().timeZone
```

That returns the timezone of the process environment, not the human sender.

On a UTC server, this often returns `UTC` even when the operator is in Vietnam.

### Existing config levels

Current schema and template already expose several timezone fields:

- `app.control.loop.defaultTimezone`
- `bots.defaults.timezone`
- `bots.slack.defaults.timezone`
- `bots.telegram.defaults.timezone`
- `bots.slack.<botId>.timezone`
- `bots.telegram.<botId>.timezone`
- `directMessages["<id>"].timezone`
- `groups["<id>"].timezone`
- Telegram `groups["<chatId>"].topics["<topicId>"].timezone`

Current effective route resolution uses:

- route or topic timezone when present
- otherwise resolved provider default or bot timezone through the channel config
- otherwise loop-specific fallback to `app.control.loop.defaultTimezone`
- otherwise host timezone

Important current gap:

- `app.timezone` does not exist yet
- `agents.defaults.timezone` does not exist yet
- `agents.list[].timezone` does not exist yet
- `bots.defaults.timezone` exists in schema/template, but current channel route resolution does not clearly use it as a global cross-provider timezone fallback
- prompt timestamp currently uses host timezone, not the resolved route, bot, agent, or app timezone

## Target Shape

Use `app.timezone` as the canonical app-level timezone.

Keep provider, bot, and route timezone because they are already useful and match real operational needs.

Add agent-level timezone because an agent can represent a workspace or role with a different regional context than the app default.

```json
{
  "app": {
    "timezone": "Asia/Ho_Chi_Minh",
    "control": {
      "loop": {
        "maxRunsPerLoop": 20,
        "maxActiveLoops": 10,
        "defaultTimezone": "Asia/Ho_Chi_Minh"
      }
    }
  },
  "agents": {
    "defaults": {
      "timezone": "Asia/Ho_Chi_Minh"
    },
    "list": [
      {
        "id": "default",
        "timezone": "Asia/Ho_Chi_Minh"
      }
    ]
  },
  "bots": {
    "telegram": {
      "defaults": {
        "timezone": "Asia/Ho_Chi_Minh"
      },
      "default": {
        "timezone": "Asia/Ho_Chi_Minh",
        "groups": {
          "-1001234567890": {
            "timezone": "Asia/Ho_Chi_Minh",
            "topics": {
              "4": {
                "timezone": "America/Los_Angeles"
              }
            }
          }
        }
      }
    }
  }
}
```

Compatibility:

- keep reading `app.control.loop.defaultTimezone`
- when the app timezone CLI sets `app.timezone`, also sync `app.control.loop.defaultTimezone` for current loop compatibility
- do not silently remove existing provider, bot, or route timezone fields
- do not make existing wall-clock loops shift when config timezone changes; persisted loop timezone remains authoritative for existing loops

## Effective Timezone Rule

Use one resolver for prompt timestamp and new wall-clock loop creation:

1. explicit one-off timezone, for example a future `clisbot loops ... --timezone <iana>`
2. route or topic timezone
3. bot timezone
4. provider defaults timezone
5. agent timezone
6. `agents.defaults.timezone`
7. `app.timezone`
8. legacy `app.control.loop.defaultTimezone`
9. host timezone

Notes:

- route wins because the conversation is happening in that surface
- agent wins over app when the assistant workspace has a different regional context
- app is the normal low-friction default for teams in one timezone
- host timezone is the last fallback only

## CLI Surface Proposal

### App timezone

```bash
clisbot timezone get [--json]
clisbot timezone set --timezone Asia/Ho_Chi_Minh
clisbot timezone clear
```

### Agent timezone

```bash
clisbot agents get-default-timezone
clisbot agents set-default-timezone --timezone Asia/Ho_Chi_Minh
clisbot agents clear-default-timezone

clisbot agents get-timezone --agent default
clisbot agents set-timezone --agent default --timezone America/Los_Angeles
clisbot agents clear-timezone --agent default
```

### Route timezone

The config field already exists, but route CLI needs a first-class mutation surface:

```bash
clisbot routes get-timezone --channel telegram group:-1001234567890 --bot alerts
clisbot routes set-timezone --channel slack group:C1234567890 --bot default --timezone Asia/Ho_Chi_Minh
clisbot routes clear-timezone --channel telegram topic:-1001234567890:4 --bot default
```

### Loop timezone

Keep loop creation low-friction.

Default behavior:

- if no timezone is passed, new calendar loops use the effective timezone resolver
- interval and times loops do not need timezone
- calendar loops persist the resolved timezone on the loop record at creation time

Optional one-off override:

```bash
clisbot loops create --channel slack --target group:C123 --timezone Asia/Ho_Chi_Minh every day at 07:00 check CI
```

Do not add slash `/loop --timezone ...` in the first pass unless the CLI flag proves insufficient.

Reason:

- slash loop syntax is already dense
- most loop creation can use app, agent, bot, or route defaults
- AI agents can use the operator CLI when a one-off explicit timezone is needed

## Bootstrap Rule

Bootstrap should ask for timezone or accept a timezone flag so fresh installs do not inherit a misleading server timezone.

Proposed flags:

```bash
clisbot start --cli codex --bot-type personal --timezone Asia/Ho_Chi_Minh ...
clisbot init --cli codex --bot-type team --timezone Asia/Ho_Chi_Minh ...
```

Behavior:

- set `app.timezone`
- sync `app.control.loop.defaultTimezone`
- seed `agents.defaults.timezone`
- seed provider defaults timezone for enabled channels

This keeps the first-run path friendly while avoiding hidden host timezone assumptions.

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
- how group-level default and per-user timezone interact when creating shared loops

## Exit Criteria

- app timezone CLI exists and mutates canonical config safely
- agent default and agent-specific timezone CLI exists
- route timezone get/set/clear exists
- loop CLI accepts optional `--timezone` for calendar loops
- calendar loop creation and status show the resolved timezone clearly
- prompt timestamp uses the effective timezone instead of host timezone when available
- first-run bootstrap can seed timezone without forcing manual config edits
- docs and CLI help explain host timezone is only a fallback
