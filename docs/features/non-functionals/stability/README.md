# Stability

## Summary

Stability is a core non-functional area in `clisbot`.

It owns cross-cutting work that keeps routed conversations, sessions, runners, and operator-visible state truthful under real load and real failure conditions.

## State

Active

## Why This Exists

This product is early-phase and stability is a core requirement, not a later polish pass.

Stability work should not be buried inside one feature such as channels or runners when the actual risk crosses multiple layers.

Examples:

- channel event duplication
- queue correctness under concurrent messages
- session drift between chat surfaces and tmux panes
- delayed or stuck settlement
- restart and resume truthfulness
- live state that disagrees across control, channel, and runner layers

## Scope

- cross-cutting runtime stability invariants
- failure-mode handling and recovery rules
- drift detection between routed conversation state and execution state
- queue and follow-up truthfulness under concurrency
- startup, restart, and resume stability
- operator-visible signals when runtime state becomes unsafe or ambiguous
- stability-focused audits and regression tracking

## Non-Goals

- feature-specific product behavior that belongs only to one surface
- performance benchmarking as a separate comparative discipline
- broad architecture governance that belongs to architecture conformance

## Related Task Folder

- [docs/tasks/features/stability](../../../tasks/features/stability)

## Related Research

- [Slack Latency And Stability Audit](../../../research/channels/2026-04-10-slack-latency-and-stability-audit.md)

## Dependencies

- [Channels](../../channels/README.md)
- [Agents](../../agents/README.md)
- [Runners](../../runners/README.md)
- [Control](../../control/README.md)
- [Configuration](../../configuration/README.md)

## Current Focus

Make delay and stability explicit product metrics, then drive backlog and validation around the highest-risk runtime truthfulness gaps first.

Current priority themes:

- reduce end-to-end channel-to-runner delay
- keep busy or idle state truthful across channel and runner layers
- prevent silent session drift when tmux state is changed outside clisbot’s routed path
- keep follow-up, queue, and final-settlement behavior deterministic under concurrent human messages
- keep channel delivery failures contained so Slack or Telegram transport outages degrade one observer instead of terminating run supervision
