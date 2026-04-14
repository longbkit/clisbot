# Transcript Visibility And Verbose Levels

## Summary

Transcript visibility is now controlled by a route-level `verbose` policy instead of `privilegeCommands`.

Current levels:

- `off`
- `minimal`

## Status

Done

## Why

`/transcript` is not the same class of action as `/bash`.

Transcript inspection is mainly a monitoring surface. Requiring privilege approval for it creates unnecessary friction, especially on normal operator-owned routes where users need quick visibility into what the active run is doing.

The cleaner split is:

- `verbose` controls how much `clisbot` exposes for monitoring
- `privilegeCommands` continues to gate actually privileged actions such as `/bash`

## Product Rule

- `verbose: "off"` disables `/transcript`
- `verbose: "minimal"` enables `/transcript`
- top-level Slack and Telegram defaults are `verbose: "minimal"`
- route overrides may set `verbose: "off"` where monitoring should stay hidden
- `/bash` still requires `privilegeCommands.enabled: true`

## Config Shape

Supported on:

- `channels.slack.verbose`
- `channels.slack.channels.<channelId>.verbose`
- `channels.slack.groups.<groupId>.verbose`
- `channels.slack.directMessages.verbose`
- `channels.telegram.verbose`
- `channels.telegram.groups.<chatId>.verbose`
- `channels.telegram.groups.<chatId>.topics.<topicId>.verbose`
- `channels.telegram.directMessages.verbose`

Example:

```json
{
  "channels": {
    "slack": {
      "verbose": "minimal",
      "channels": {
        "C1234567890": {
          "verbose": "off"
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

- `/transcript` follows `verbose`, not `privilegeCommands`
- `/bash` still follows `privilegeCommands`
- Slack and Telegram route inheritance support top-level `verbose`
- help, status, and whoami surfaces show the active policy clearly
- regression tests cover `verbose: "off"` and `verbose: "minimal"`
