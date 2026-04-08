# Configuration Control-Plane Expansion

## Summary

Expand the muxbot config so it can truthfully express channels, Agent-OS, runners, control, and policy.

## Status

Planned

## Why

The current config is enough for the first Slack MVP, but the system model already requires more:

- channel routing
- agent definitions
- runner selection
- control defaults
- policy, default chat rendering, and transcript request command selection
- default follow-up behavior and participation TTL
- Slack feedback defaults and overrides
- session-scoped runtime policy override support

## Scope

- support richer per-channel route and policy settings
- support clearer agent and runner configuration
- support control, default chat rendering, and transcript request command configuration
- support configurable default follow-up mode and follow-up TTL
- support Slack feedback configuration for accepted and in-progress work
- support configuration hooks for runtime policy override storage and resolution
- document config invariants and examples
- keep `~/.muxbot/muxbot.json` easy to initialize and inspect

## Non-Goals

- implementing channel behavior itself
- implementing runner logic itself

## Subtasks

- [ ] expand channel route and policy options
- [ ] support explicit agent and runner selection
- [ ] support control, default chat rendering, and transcript request command configuration
- [ ] support configurable follow-up mode and follow-up participation TTL
- [ ] support Slack reaction feedback defaults and overrides
- [ ] define how config defaults interact with runtime session-scoped overrides
- [ ] align examples and schema docs with implemented behavior
- [ ] add configuration ground-truth test specs for manual and automated validation

## Dependencies Or Blockers

- settled channel and runner contracts

## Related Docs

- [Configuration Feature](../../../features/configuration/README.md)
- [Configuration Tests](../../../tests/features/configuration/README.md)
- [OpenClaw Agent And Workspace Config Shape](../../../research/configuration/2026-04-06-openclaw-agent-workspace-config-shape.md)
- [Overview](../../../overview/README.md)
