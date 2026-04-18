# Slack Telegram Message Actions And Bot Routing

## Summary

Add operator message actions plus bot-aware Slack and Telegram routing and credential handling.

## Status

Done

## Why

This task started before the official `bots` mental model settled.

The shipped result now lives under bot-aware routing and credentials, together with the `clisbot message ...` operator surface.

## Scope

- add `clisbot message ...`
- add Slack and Telegram bot maps plus per-provider default bot selection
- make runtime startup bot-aware for Slack and Telegram
- implement provider message-action adapters with OpenClaw-shaped syntax where practical
- add tests for config, routing, and message actions

## Non-Goals

- adding new product channels beyond Slack and Telegram
- changing agent session ownership rules
- moving route tables out of provider-owned config

## Research

- [OpenClaw CLI Command Surfaces And Slack Telegram Send Syntax](../../../research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md)

## Subtasks

- [x] add feature doc and backlog entry
- [x] add account-aware Slack and Telegram config helpers
- [x] update config bootstrap and validation for bot maps
- [x] start one Slack runtime service per configured account
- [x] start one Telegram runtime service per configured account
- [x] add `clisbot message` CLI parsing and help
- [x] implement Slack message actions
- [x] implement Telegram message actions where the Bot API supports them
- [x] return explicit unsupported errors where provider capability is absent
- [x] update docs and test env guidance for allowed Slack live-validation surfaces
- [x] add targeted unit tests and CLI tests
- [x] run targeted Slack live validation against the configured test surfaces

## Validation Notes

- Slack channel validation on `C07U0LDK6ER` succeeded for:
  - `send`
  - threaded `send`
  - media `send`
  - `poll`
  - `react`
  - `reactions`
  - `read`
  - `search`
  - `edit`
  - `delete`
- Slack pin APIs are implemented but the installed Slack app currently returns `missing_scope` for:
  - `pin`
  - `pins`
  - `unpin`
- Slack DM validation against `SLACK_TEST_DM_CHANNEL` was attempted and currently returns `channel_not_found` for the configured DM surface.

## Exit Criteria

- `clisbot message` exists as a documented operator CLI surface
- Slack and Telegram can resolve configured bots by provider defaults or explicit bot selection
- bot-specific routing affects route resolution and session identity
- Slack live validation covers the configured test channel and the configured allowed DM surface
- tests cover config loading, account selection, route selection, and message-action execution paths
