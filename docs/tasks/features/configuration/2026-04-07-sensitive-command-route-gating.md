# Privilege Command Route Gating

## Summary

Require explicit route opt-in before transcript inspection or bash execution is allowed from a chat surface.

## Status

Done

## Why

`/transcript`, `::transcript`, `/bash`, and `!<command>` expose terminal state and workspace execution.

Those capabilities are useful, but they are not safe to leave open by default on shared chat surfaces.

## Scope

- add one explicit config object for sensitive chat-surface commands
- default that flag to disabled
- support route-level enablement for direct messages, channels, groups, and topics
- block sensitive commands when the resolved route does not allow them
- optionally restrict approved routes to specific user ids
- document the rule in configuration, commands, tests, and user guide docs
- patch the live config so the current approved test routes keep working

## Non-Goals

- per-command split policy between transcript and bash
- role-based auth beyond route policy and explicit user-id allowlists
- Telegram scoped command menus

## Implemented Rule

- `privilegeCommands.enabled: false` is the default at the Slack and Telegram channel roots
- `privilegeCommands.allowUsers: []` means any user on an enabled route may use the commands
- route overrides may enable it for:
  - `channels.slack.channels.<id>.privilegeCommands`
  - `channels.slack.groups.<id>.privilegeCommands`
  - `channels.slack.directMessages.privilegeCommands`
  - `channels.telegram.groups.<id>.privilegeCommands`
  - `channels.telegram.groups.<id>.topics.<topicId>.privilegeCommands`
  - `channels.telegram.directMessages.privilegeCommands`
- when disabled, these commands are denied instead of executed:
  - `/transcript`
  - route transcript command pattern such as `::transcript`
  - `/bash <command>`
  - `!<command>`
- when `allowUsers` is non-empty, only listed user ids may run those commands on the route

## Validation

- schema defaults and route overrides covered by config and route tests
- command denial and allow paths covered by interaction-processing tests
- live config patched to use `privilegeCommands` directly with no compatibility fallback

## Related Docs

- [Configuration Feature](../../../features/configuration/README.md)
- [Agent Commands](../../../features/agent-os/commands.md)
- [Channel Tests](../../../tests/features/channels/README.md)
