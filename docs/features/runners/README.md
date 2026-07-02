# Runners

## Summary

Runners are the execution backends behind the agents layer.

They standardize how the system talks to a concrete backend and how backend output becomes one consistent internal contract.

Short boundary rule:

- `SessionService` owns conversation continuity and the active
  `sessionKey -> sessionId` mapping
- runners do not own that mapping
- runners only know how to launch, capture, resume, and normalize one concrete backend

Code-level shape:

- `src/runners/contract/` defines the `RunnerBackend` interface, the
  normalized `RunEvent` model, and the declared capability matrix
- `src/agents/runtime/runner-service.ts` is the thin dispatcher that selects
  the configured backend per agent target and delegates
- `src/runners/tmux/*` implements the contract for tmux-backed interactive
  CLIs (pane mechanics, prompt handshakes, snapshot-diff monitoring)
- `src/runners/acp/*` implements the contract for ACP agents (one adapter
  process per session, structured `session/update` events, `session/load`
  resume, first-class cancel, policy-resolved permission requests)
- none of those decide whether the active mapping is set, cleared, or
  rotated; they record runner-provided ids through the session-owned mapping

Backend selection is per agent in config (`runner.backend: tmux | acp`),
defaulting to tmux. Capabilities that a backend cannot express (mid-turn
steering, pane attach, shell panes, Enter-nudges on ACP) degrade with
truthful guidance instead of pretending.

## State

Active

## Why It Exists

The project runs tmux-backed interactive CLI sessions and ACP-backed agent
sessions behind one code-level runner contract.

tmux stays the universal fallback and the subscription-cost path for Claude;
ACP is the structured path for the growing set of ACP-capable agents
(Codex-first via the official adapter). Future SDK or CLI-JSON backends join
by implementing the same contract.

That only stays coherent if backend-specific behavior is isolated behind the
standard runner contract in `src/runners/contract/`.

## Scope

- tmux runner behavior
- ACP runner behavior (adapter process per session, structured events)
- future SDK and CLI-JSON runners
- standardized input, output, snapshot, and streaming contract
- backend capability declaration and truthful degradation
- backend-specific lifecycle hooks and quirks
- runner onboarding checklist for new interactive CLIs and ACP agents

## Non-Goals

- channel-specific transcript rendering
- canonical agent, memory, or tool ownership
- operator workflows
- continuity mutation semantics such as bind, clear, or rotate of the active `sessionId`

## Related Task Folder

- [docs/tasks/features/runners](../../tasks/features/runners)

## Related Test Docs

- [docs/tests/features/runners](../../tests/features/runners/README.md)

## Related Design Docs

- [tmux Runner](tmux-runner.md)
- [Transcript Presentation And Streaming](../../architecture/transcript-presentation-and-streaming.md)

## Related Research

- [ACP Operational Effort And Codex Decision Inputs](../../research/runners/2026-07-02-acp-operational-effort-and-codex-decision.md)
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
  - allow one bounded runner restart with the stored native session id preserved when paste never landed and `Enter` was never sent
- the goal is higher cold-start stability without forcing every healthy startup to wait longer up front

## Related CLI Doc

- [Gemini CLI Runner Support](gemini-cli.md)
