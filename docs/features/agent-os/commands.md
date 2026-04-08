# Agent Commands

## Purpose

This document defines agent-scoped command dispatch inside a conversation.

It covers slash-prefixed commands and configurable shorthand command forms that are interpreted before a prompt is sent to the runner.

## Boundary Rule

Agent command dispatch belongs to `agent-os`.

Why:

- it decides whether inbound text is treated as agent control or normal agent input
- it is scoped to one conversation session key inside an agent
- it must remain meaningful even if the concrete runner changes

It does not belong to `runners`, because runners should receive already-decided input.

It does not belong to `control`, because these commands are used inside a user conversation rather than an operator-only surface.

## Dispatch Rule

When a message starts with `/`:

1. check whether it matches a reserved control slash command
2. if it matches, execute the control command immediately
3. if it matches an agent-reserved execution command, execute that command
4. otherwise, forward the slash command unchanged to the agent as native runner input

Control slash commands always have higher priority than native agent slash commands.

When a message starts with a configured bash shortcut such as `!`:

1. treat the remaining text as an agent-scoped bash command
2. execute it in the current agent workspace

## Current Control Slash Commands

- `/start`: show onboarding help for the current surface
- `/help`: show the available control slash commands
- `/status`: show the current route status and operator setup hints
- `/whoami`: return the current platform sender and route identity for the active conversation
- `/transcript`: return the current full conversation session transcript
- `/stop`: send `Escape` to interrupt current processing in the current conversation session
- `/followup status`
- `/followup auto`
- `/followup mention-only`
- `/followup pause`
- `/followup resume`

Current meaning:

- `start`: show the current route onboarding or setup guidance
- `status`: show the current conversation follow-up policy and operator guidance for the route
- `auto`: continue naturally after the bot has replied in the thread, subject to policy TTL
- `mention-only`: require explicit mention for every later turn in the thread
- `pause`: stop passive follow-up until explicitly resumed or re-activated
- `resume`: restore the default follow-up policy for that conversation

These commands should stay agent-scoped.

They are not operator-only controls.

## Current Agent Execution Commands

- `/bash <command>`: run a bash command in the current agent workspace
- configured bash shortcuts such as `!<command>`: shorthand for running a bash command in the current agent workspace

## Sensitive Command Gate

Transcript inspection and bash execution are sensitive chat-surface capabilities.

Current rule:

- they are disabled by default
- they run only when the resolved chat route enables `privilegeCommands.enabled`
- this gate applies to:
  - `/transcript`
  - configured slash-style transcript shortcuts such as `::transcript` or `\transcript`
  - `/bash <command>`
  - configured bash shortcuts such as `!<command>`

When the route does not enable them, muxbot must deny the command instead of forwarding or executing it.

## Bash Execution Model

Bash execution should not take over the main agent CLI pane.

Current rule:

- keep one reusable `bash` tmux window inside the same conversation session
- use the same workspace path as the current agent
- serialize bash commands through that one window
- capture the command output

Why this model:

- it keeps the command scoped to the same conversation session and workspace
- it does not disturb the main Codex or CLI pane
- it keeps shell context available for debugging and later reuse
- it avoids creating one extra tmux window per shell command

## Native Slash Commands

If a slash command is not reserved by muxbot control dispatch, it should be forwarded to the agent unchanged.

Examples:

- `/model`
- `/help` for a future native runner, if muxbot does not reserve it
- other agent CLI slash commands

## Current Notes

- current reserved commands are intentionally small
- control slash commands are agent-scoped, not workspace-global
- `/bash` and configured bash shortcuts are agent execution commands, not operator control commands
- current bash routing uses one default reusable shell surface per conversation session
- future addressing such as `!1:` or `!bash:` belongs to later command-surface expansion, not the current default
- later growth may add argument-aware commands, but the dispatch order should not change
- current follow-up policy commands map to the same runtime control API that future agent tools and skills should use
