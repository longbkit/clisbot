# Runner Interface Standardization And tmux Runner Hardening

## Summary

Standardize the runner interface and harden the current tmux runner implementation.

## Status

In Progress

## Why

The project will only scale to ACP and SDK integrations if the current tmux path is treated as one runner implementation behind a standard contract.

## Scope

- define the standard runner interface
- normalize input submission, output capture, snapshots, and streaming
- keep backend-specific quirks inside runner implementations
- harden the tmux runner as the first implementation
- expose enough normalized transcript structure for default Slack interaction rendering
- define runner lifecycle hooks needed for session resume and runner sunsetting

## Current Truth

- session continuity is no longer tied to live tmux-session survival
- the tmux runner can persist and later reuse an AI CLI `sessionId` when the backend supports it
- if a tmux session is killed, a later prompt for the same `sessionKey` can recreate the tmux runner and resume the prior tool session
- idle tmux sunset is implemented through a stale-session cleanup loop
- reset policy is not implemented yet

## Non-Goals

- channel-visible presentation rules
- agent ownership model

## Immediate Execution Slice

The next runner slice should support default Slack interaction rendering without forcing Slack code to parse raw tmux output directly.

That means the tmux runner must expose a normalized view of session progress that makes these cases possible:

- detect unchanged full-screen redraws
- separate repeated Codex chrome from meaningful new content
- expose ordered updates for in-progress streaming
- expose a stable final state that channels can settle on
- expose the full current session view when an explicit transcript request command asks for it

## Subtasks

- [ ] define the standard runner contract for snapshot, delta, lifecycle, and error reporting
- [x] define how runners expose support for native AI CLI session resume when available
- [ ] define the minimum normalized transcript fields needed by default Slack interaction rendering
- [ ] map current tmux pane behavior into that contract
- [ ] isolate Codex-specific quirks such as trust prompts, banners, and redraws inside the tmux runner
- [x] define tmux bootstrap for fresh start versus resume-existing-session flows
- [x] define tmux runner idle-sunset and eviction behavior without resetting the logical conversation
- [ ] define explicit session reset policy separate from runner recreation
- [ ] revise capture normalization so transcript stability does not require mutating the live pane before prompt submission
- [ ] define how the runner marks unchanged versus meaningful output updates
- [ ] define how the runner exposes a final settled transcript state
- [ ] document future ACP and SDK compatibility expectations
- [ ] add runner ground-truth tests for normalization and delta behavior

## Exit Criteria

- channel code can render default Slack interaction output without directly parsing tmux pane dumps
- repeated tmux redraws do not force duplicate user-visible Slack updates
- Codex-specific terminal chrome is recognized within the runner boundary
- full session visibility is retrievable without changing default interaction streaming behavior
- killing a tmux session does not by itself force a logical conversation reset when a stored resumable `sessionId` exists
- idle sunset and reset policy are defined separately instead of being implied by runner recreation
- the same contract remains implementable by future non-tmux runners

## Dependencies Or Blockers

- stable Agents ownership boundaries

## Related Docs

- [Runners Feature](../../../features/runners/README.md)
- [tmux Runner](../../../features/runners/tmux-runner.md)
- [Transcript Presentation And Streaming](../../../architecture/transcript-presentation-and-streaming.md)
- [Observer-Based Session Attach, Detach, And Watch](../../2026-04-08-observer-based-session-attach-detach-and-watch.md)
- [Runners Tests](../../../tests/features/runners/README.md)
