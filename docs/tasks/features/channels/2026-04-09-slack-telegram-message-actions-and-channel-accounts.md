# Slack Telegram Message Actions And Channel Accounts

## Summary

Add OpenClaw-shaped operator message actions plus first-class Slack and Telegram channel accounts.

## Status

In Progress

## Why

Current `clisbot` bindings already carry `accountId`, but Slack and Telegram config and runtime still mostly behave like single-account channels.

At the same time, `clisbot` has no operator-facing `message` CLI surface for direct provider actions such as `send`, `react`, `read`, or `delete`.

## Scope

- add `clisbot message ...`
- add Slack and Telegram account maps plus `defaultAccount`
- route bindings through `channel[:accountId]`
- make runtime startup account-aware for Slack and Telegram
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
- [x] update config bootstrap and validation for account maps
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
- Slack and Telegram can resolve configured accounts by `defaultAccount` or explicit `--account`
- account-specific bindings affect route resolution and session identity
- Slack live validation covers the configured test channel and the configured allowed DM surface
- tests cover config loading, account selection, route selection, and message-action execution paths
