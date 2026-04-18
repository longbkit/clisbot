# Transcript Visibility And Verbose Levels

## Summary

Transcript visibility is now controlled by a route-level `verbose` policy instead of `privilegeCommands`.

Current levels:

- `off`
- `minimal`

## Status

Done

## Current Contract

Official config ownership is bot-rooted now.

This feature still describes the same `verbose` behavior, but the live config paths are under `bots`, not `channels`.

## Why

`/transcript` is not the same class of action as `/bash`.

Transcript inspection is mainly a monitoring surface. Requiring privilege approval for it creates unnecessary friction, especially on normal operator-owned routes where users need quick visibility into what the active run is doing.

The cleaner split is:

- `verbose` controls how much `clisbot` exposes for monitoring
- agent auth continues to gate actually privileged actions such as `/bash`

## Product Rule

- `verbose: "off"` disables `/transcript`
- `verbose: "minimal"` enables `/transcript`
- top-level Slack and Telegram defaults are `verbose: "minimal"`
- route overrides may set `verbose: "off"` where monitoring should stay hidden
- `/bash` still requires resolved `shellExecute`

## Config Shape

Supported on:

- `bots.slack.defaults.verbose`
- `bots.slack.<botId>.groups."channel:<channelId>".verbose`
- `bots.slack.<botId>.groups."group:<groupId>".verbose`
- `bots.slack.<botId>.directMessages."*".verbose`
- `bots.telegram.defaults.verbose`
- `bots.telegram.<botId>.groups."<chatId>".verbose`
- `bots.telegram.<botId>.groups."<chatId>".topics."<topicId>".verbose`
- `bots.telegram.<botId>.directMessages."*".verbose`

Example:

```json
{
  "bots": {
    "slack": {
      "defaults": {
        "verbose": "minimal"
      },
      "default": {
        "groups": {
          "channel:C1234567890": {
            "verbose": "off"
          }
        }
      }
    }
  }
}
```

## Operator Truthfulness

Status surfaces should show the active `verbose` value so operators can explain why `/transcript` is available or blocked without guessing.

Detached-run fallback text should also avoid telling users to run `/transcript` unconditionally, because some routes intentionally disable it.

## Exit Criteria

- `/transcript` follows `verbose`, not auth
- `/bash` still follows resolved `shellExecute`
- Slack and Telegram route inheritance support top-level `verbose`
- help, status, and whoami surfaces show the active policy clearly
- regression tests cover `verbose: "off"` and `verbose: "minimal"`
