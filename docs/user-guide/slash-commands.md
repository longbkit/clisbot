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
- `/detach`: stop live updates for this thread while still posting the final result here
- `/watch every 30s [for 10m]`: post latest run state on an interval until settle or timeout
- `/stop`: send Escape to interrupt the current conversation session, clear active-run state, and let queued prompts continue
- `/new`: trigger a new runner conversation for the current routed session, then capture and store the new session id
- `/nudge`: send one extra Enter to the current tmux session without resending prompt text

## Conversation Modes

- `/followup status`
- `/followup auto`
- `/followup mention-only` or `/mention`: require explicit mention in the current conversation
- `/followup mention-only channel` or `/mention channel`: persist mention-only as the default for the current channel or group and apply it now
- `/followup mention-only all` or `/mention all`: persist mention-only as the default for all routed conversations on the current bot and apply it now
- `/followup pause` or `/pause`
- `/followup resume` or `/resume`
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

- `/queue <message>` or `\q <message>`: create a durable queued prompt behind the active run in the same session
- `/queue help`: show queue-specific help and examples
- `/steer <message>` or `\s <message>`: inject a steering message into the active run immediately
- `/queue list`: show queued messages that have not started yet
- `/queue clear`: clear queued messages that have not started yet without interrupting a running prompt

## Loops

- `/loop` or `/loop help`: show loop help
- `/loop 5m <prompt>`: create an interval loop
- `/loop 1m --force <prompt>`: create a sub-5-minute interval loop when policy allows it
- `/loop <prompt> every 2h`: create an interval loop with trailing `every ...` syntax
- `/loop every day at 07:00 <prompt>`: create a daily wall-clock loop
- `/loop every weekday at 07:00 <prompt>`: create a weekday wall-clock loop
- `/loop every mon at 09:00 <prompt>`: create a day-of-week wall-clock loop
- `/loop 3 <prompt>`: run the prompt a fixed number of times
- `/loop 5m` or `/loop every day at 07:00`: run maintenance mode using `LOOP.md`
- `/loop status`: show loops visible from the current session
- `/loop cancel <id>`: cancel one loop
- `/loop cancel --all`: cancel all loops visible from the current session
- `/loop cancel --app --all`: cancel all loops across the app

Useful operator note:

- encourage users to try `/queue help` and `/loop help` directly in chat when they need the live syntax summary for the current surface
- queued prompts are stored in the session store, survive runtime restart, and are also inspectable through `clisbot queues list`
- chat `/loop` wall-clock creation is immediate to keep the conversational path low-friction; the creation response shows the resolved timezone, next run in local time plus UTC, and the exact cancel command
- if the timezone is wrong, cancel the loop from that response, set the correct timezone, then create the loop again

## Shell

- `/bash <command>`: run a shell command when the resolved role allows `shellExecute`
- `!<command>`: bash shortcut when the resolved role allows `shellExecute`

## Notes

- follow-up scope defaults to the current conversation
- `channel` scope means the current channel, group, or DM container
- `all` scope means the current bot defaults across routed conversations
- This page is intentionally short and inventory-first
- Native coding-CLI command or skill pass-through is documented in `docs/user-guide/native-cli-commands.md`
- Detailed output wording review lives in `docs/research/channels/2026-04-14-slash-command-output-audit.md`
