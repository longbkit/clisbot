# OpenClaw-Style Agent CLI And Bootstrap

## Summary

Add an OpenClaw-like operator CLI for agent creation and binding, then make `start` and `status` expose agent, channel, and bootstrap state clearly enough for first-run setup.

## Status

Done

## Why

`clisbot` already uses OpenClaw-like concepts in config and routing, but the operator CLI is still too thin:

- no agent-oriented add or inspect flow
- no explicit bootstrap personality state
- `start` does not help the operator finish first-time setup
- `status` does not explain agent, channel, and bootstrap health at a glance

The goal is to improve OpenClaw familiarity without breaking the current clisbot architecture:

- agent definitions stay in configuration
- channels stay channel-owned
- control commands surface operator state without becoming a user channel

## Scope

- add agent-related CLI commands similar to OpenClaw
- require a CLI tool selection when adding an agent
- support optional startup options with tool-specific defaults
- support bootstrap mode selection for `personal-assistant` and `team-assistant`
- make `start` print brief agent and channel summaries plus next-step guidance
- make `status` print runtime plus agent, channel, activity, and bootstrap summaries
- update config schema, template, tests, and user docs

## Non-Goals

- implementing full OpenClaw parity for every CLI subcommand
- adding new user-facing channel behavior
- changing runner ownership boundaries

## Subtasks

- [x] add research-backed command and config notes for agent CLI and bootstrap state
- [x] extend config schema for agent tool identity, startup options, and bootstrap metadata
- [x] implement `agents` command parsing and config mutation helpers
- [x] surface first-run guidance in `start`
- [x] surface runtime, activity, channel, and bootstrap summaries in `status`
- [x] add automated CLI, config, and summary tests
- [x] update README and user guide command docs

## Related Docs

- [Configuration Feature](../../../features/configuration/README.md)
- [Agents Feature](../../../features/agents/README.md)
- [User Guide](../../../user-guide/README.md)
- [OpenClaw Agent, Binding, Account, And Channel CLI Research](../../../research/channels/2026-04-07-openclaw-agent-binding-account-channel-cli.md)
- [OpenClaw Agent And Workspace Config Shape](../../../research/configuration/2026-04-06-openclaw-agent-workspace-config-shape.md)
