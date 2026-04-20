# Runners

## Summary

Runners are the execution backends behind the agents layer.

They standardize how the system talks to a concrete backend and how backend output becomes one consistent internal contract.

## State

Active

## Why It Exists

Today the project uses tmux-backed Codex sessions.

Later it may support ACP, Codex SDK, Claude SDK, or other execution backends.

That only stays coherent if backend-specific behavior is isolated behind a standard runner interface.

## Scope

- tmux runner behavior today
- future ACP runners
- future SDK runners
- standardized input, output, snapshot, and streaming contract
- backend-specific lifecycle hooks and quirks
- runner onboarding checklist for new interactive CLIs

## Non-Goals

- channel-specific transcript rendering
- canonical agent, memory, or tool ownership
- operator workflows

## Related Task Folder

- [docs/tasks/features/runners](../../tasks/features/runners)

## Related Test Docs

- [docs/tests/features/runners](../../tests/features/runners/README.md)

## Related Design Docs

- [tmux Runner](tmux-runner.md)
- [Transcript Presentation And Streaming](../../architecture/transcript-presentation-and-streaming.md)

## Related Research

- [ACP Codex And Claude Support Mechanics](../../research/runners/2026-04-05-acp-codex-and-claude-support-mechanics.md)
- [Codex Vs Claude CLI Integration Checklist](../../research/runners/2026-04-05-codex-vs-claude-cli-integration-checklist.md)

## Dependencies

- [Agents](../agents/README.md)
- [Configuration](../configuration/README.md)

## Current Focus

Stabilize the tmux runner, keep Codex, Claude, and Gemini channel-safe through one truthful normalization contract, and define the onboarding checklist that future ACP, SDK, or CLI runners must satisfy.

Current rule for normal chat experience:

- runners normalize backend-specific terminal behavior
- channels render from the latest normalized runner view
- normal chat mode does not accumulate streaming deltas as history
- long replies still use the same rule by reconciling an ordered edited chunk set on the channel side

Current lifecycle rule:

- runners may be sunset as stale tmux sessions
- stale cleanup must not imply logical conversation reset
- tmux completion truth comes from pane-state observation first:
  - if an active runner timer is still visible, the turn is still running
  - if the pane stops changing and no active timer remains, the turn is treated as completed
- if a turn exceeds the configured `maxRuntimeMin` or `maxRuntimeSec`, the runner detaches observation instead of treating the turn as failed
- that detached settlement must leave the tmux session running while monitoring continues until real completion
- channels must be able to attach new observers to that still-running session and receive truthful final settlement later
- new CLI onboarding must include explicit ready-state detection and startup-blocker truthfulness, especially for auth-gated CLIs such as Gemini
- fresh runner startup now has bounded retry knobs:
  - `runner.startupRetryCount`
  - `runner.startupRetryDelayMs`
- status-command continuity capture now requires a truthful handoff back into the first user-prompt path:
  - settle the pane after `/status`
  - confirm paste before `Enter`
  - allow one bounded fresh-session retry only when paste never landed and `Enter` was never sent
- the goal is higher cold-start stability without forcing every healthy startup to wait longer up front

## Related CLI Doc

- [Gemini CLI Runner Support](gemini-cli.md)
