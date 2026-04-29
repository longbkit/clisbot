# Agent Progress Reply Wrapper And Prompt

## Summary

This feature gives coding agents a stable way to send user-facing progress and final replies back through `clisbot` while they are running inside another workspace.

The feature combines three pieces:

- a stable local `clisbot` wrapper under `~/.clisbot/bin/clisbot`
- agent runner launch behavior that exposes that wrapper consistently
- a channel-owned prompt envelope that tells the agent exactly how to send progress updates back to the current Slack or Telegram surface
- a response-mode policy layer that can disable normal channel auto-settlement while keeping runner observation active
- a streaming policy layer that can still show one live draft preview even when canonical final replies come from `clisbot message send ...`
- an additional-message policy layer that decides whether busy-session follow-up should steer the active run or queue behind it

## Scope

- auto-create a stable local `clisbot` wrapper for dev and local runtime use
- expose the wrapper to agent runner sessions
- inject a short channel context and reply command into the agent-bound prompt
- keep that prompt guidance terse, including a channel-specific message-length hint and `--file` as the generic attachment flag
- keep schedule guidance terse: `For schedule/loop/reminder requests, inspect \`clisbot loops --help\` and use the loops CLI.`
- support `responseMode: "message-tool"` so progress and final replies come from `clisbot message send`, not from pane settlement
- support `streaming` for both response modes, with `message-tool` preview modeled as one disposable draft message
- support channel-owned `surfaceNotifications` so queued work and managed loop ticks can announce when they actually start
- resolve reply delivery in this order: surface override, agent override, provider default
- resolve busy-session follow-up in this order: surface override, agent override, provider default
- support explicit `/queue <message>` to force ordered queued delivery for one extra message
- support explicit steering and queue management commands for active conversations
- keep slash commands unaffected while letting routed auth decide whether protected control guidance must be appended to agent-bound prompts
- make the flow easy to test on a fresh machine with `bun start`

## Invariants

- channels own the prompt-envelope text because the envelope is surface context
- delayed queued work and looped work must reapply current channel delivery policy instead of relying on stale wrapped prompt text
- queue-start and loop-start notifications remain channel-owned surface policy, not agent-owned prompt behavior
- channels still observe runner state even when `responseMode` is `message-tool`
- channels may render one disposable live draft preview while `message-tool` owns canonical replies
- channels still monitor pane state even when additional human messages are handled as steering input
- runners own wrapper availability inside agent processes
- the prompt envelope only affects agent-bound prompts, not channel control commands
- the wrapper must be stable across workspaces on the same machine

## Dependencies

- [Channels](README.md)
- [Runners](../runners/README.md)
- [Configuration](../configuration/README.md)
- [docs/tasks/features/channels](../../tasks/features/channels)
