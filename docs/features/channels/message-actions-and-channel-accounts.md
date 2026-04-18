# Message Actions And Bot Routing

## Summary

This feature slice adds an operator-facing `message` CLI plus bot-aware Slack and Telegram routing.

The goal is OpenClaw-shaped operator behavior without breaking the existing `clisbot` system boundaries:

- channels own provider-facing transport behavior
- configuration owns bot and route selection
- agents stays backend-agnostic

## Scope

- `clisbot message ...` operator CLI
- Slack and Telegram bot config under provider-owned bot maps
- `defaultBotId` selection
- bot-aware route selection
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

- bot config remains provider-owned under `bots.slack` and `bots.telegram`
- route tables remain bot-owned
- route resolution stays separate from agent execution
- provider message actions stay in channel adapters, not in agents

## Dependencies

- [Channels](README.md)
- [Configuration](../configuration/README.md)
- [OpenClaw CLI Command Surfaces And Slack Telegram Send Syntax](../../research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md)
- [docs/tasks/features/channels](../../tasks/features/channels)
