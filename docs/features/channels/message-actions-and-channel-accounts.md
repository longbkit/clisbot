# Message Actions And Channel Accounts

## Summary

This feature slice adds an operator-facing `message` CLI plus first-class Slack and Telegram channel accounts.

The goal is OpenClaw-shaped operator behavior without breaking the existing `clisbot` system boundaries:

- channels own provider-facing transport behavior
- configuration owns account and route selection
- agents stays backend-agnostic

## Scope

- `clisbot message ...` operator CLI
- Slack and Telegram account config under provider-owned account maps
- `defaultAccount` selection
- account-aware bindings in `channel[:accountId]` form
- Slack and Telegram message actions routed through provider adapters

## In Scope Message Actions

- `send`
- `poll`
- `react`
- `reactions`
- `read`
- `edit`
- `delete`
- `pin`
- `unpin`
- `pins`
- `search`

## Architecture Notes

- account config remains provider-owned under `channels.slack` and `channels.telegram`
- route tables remain provider-owned
- bindings remain the top-level cross-feature routing map
- provider message actions stay in channel adapters, not in agents

## Dependencies

- [Channels](README.md)
- [Configuration](../configuration/README.md)
- [OpenClaw CLI Command Surfaces And Slack Telegram Send Syntax](../../research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md)
- [docs/tasks/features/channels](../../tasks/features/channels)
