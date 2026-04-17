# Slash Commands

## Status

Current runtime command inventory.

This page is the canonical overview for chat-surface commands and a quick reference for auth planning.

## Source Of Truth

- Parser and help text: `src/agents/commands.ts`
- Canonical help renderer: `renderAgentControlSlashHelp()`

If this page and runtime ever disagree, runtime wins.

## Entry Rules

- Standard slash commands use `/...`
- Extra slash prefixes also exist: `::...` and `\...`
- Bash shortcut prefix is `!...`
- Any slash command not recognized here is forwarded to the agent unchanged

## Basics

- `/start`: show onboarding help for the current surface
- `/status`: show route status and suggested operator next steps
- `/help`: show available control slash commands
- `/whoami`: show current platform, route, and sender identity details
- `/transcript`: show the current session transcript when route `verbose` policy allows it

## Run Control

- `/attach`: attach this thread to the active run and resume live updates
- `/detach`: stop live updates for this thread, switch to sparse progress updates, and still allow final settlement here
- `/watch every 30s [for 10m]`: post latest run state on an interval until settle or timeout
- `/stop`: send Escape to interrupt the current conversation session
- `/nudge`: send one extra Enter to the current tmux session without resending prompt text

## Conversation Modes

- `/followup status`
- `/followup auto`
- `/followup mention-only`
- `/followup pause`
- `/followup resume`
- `/streaming status`
- `/streaming on`
- `/streaming off`
- `/streaming latest`
- `/streaming all`
- `/responsemode status`
- `/responsemode capture-pane`
- `/responsemode message-tool`
- `/additionalmessagemode status`
- `/additionalmessagemode steer`
- `/additionalmessagemode queue`

## Queue And Steering

- `/queue <message>` or `\q <message>`: enqueue a later message behind the active run
- `/steer <message>` or `\s <message>`: inject a steering message into the active run immediately
- `/queue list`: show queued messages that have not started yet
- `/queue clear`: clear queued messages that have not started yet

## Loops

- `/loop`: show loop help
- `/loop every <duration> <prompt>`: create an interval loop
- `/loop every <duration> for <duration> <prompt>`: create an interval loop with a bounded window
- `/loop at <time> <prompt>`: create a calendar loop
- `/loop status`: show loops visible from the current session
- `/loop cancel <id>`: cancel one loop
- `/loop cancel --all`: cancel all loops visible from the current session
- `/loop cancel --app --all`: cancel all loops across the app

## Shell

- `/bash <command>`: run a shell command when the resolved role allows `shellExecute`
- `!<command>`: bash shortcut when the resolved role allows `shellExecute`

## Notes

- This page is intentionally short and inventory-first
- Native coding-CLI command or skill pass-through is documented in `docs/user-guide/native-cli-commands.md`
- Detailed output wording review lives in `docs/research/channels/2026-04-14-slash-command-output-audit.md`
