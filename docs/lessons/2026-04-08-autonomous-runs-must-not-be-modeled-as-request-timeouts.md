---
title: Autonomous Runs Must Not Be Modeled As Request Timeouts
date: 2026-04-08
area: runtime, channels, control, runners
summary: Long-running agentic sessions need a run lifecycle separate from the inbound request lifecycle, plus explicit status visibility, or detached autonomous work becomes incorrectly treated as stale, timed out, or invisible.
related:
  - docs/architecture/transcript-presentation-and-streaming.md
  - docs/features/channels/README.md
  - docs/features/runners/README.md
  - docs/user-guide/README.md
  - docs/tasks/2026-04-08-observer-based-session-attach-detach-and-watch.md
  - src/agents/agent-service.ts
  - src/channels/interaction-processing.ts
  - src/control/runtime-summary.ts
  - src/runners/tmux/run-monitor.ts
---

## Context

This lesson comes from implementing long-running autonomous session behavior in `muxbot` on April 8, 2026.

The earlier shape was still too request-centric:

- once a configured observation window was exceeded, the system was still conceptually close to "timeout"
- stale cleanup risked treating a still-running autonomous tmux session as disposable just because chat surfaces had gone quiet
- detached work was hard to see unless the user explicitly asked for transcript output or re-attached to the thread

That model is wrong for agentic AI. A run can outlive the request that first exposed it to the user.

## Lesson

For autonomous agents, request lifecycle and run lifecycle are different things and must be modeled separately.

Preferred rules:

- the request-level observation window should only end the initial waiting behavior, not declare the run failed
- when a run exceeds the initial observation window, the system should detach observation and keep monitoring until real completion
- stale cleanup must key off true active-run state, not whether recent chat updates were emitted
- channels need observer controls such as attach, detach, or interval watch instead of forcing transcript-first inspection
- final settlement should still be delivered after detachment so a detached run does not silently disappear
- operator and routed status surfaces must expose active runs directly so detached autonomous work remains visible

## Practical Rule

Before shipping long-running agent behavior, check:

1. Does exceeding the request window leave the underlying run alive and monitored?
2. Can the user see active detached work from normal status surfaces without transcript-first debugging?
3. Can stale cleanup distinguish "quiet but active" from truly stale?
4. Is a second prompt blocked while the same session still has an active run?

## Applied Here

This lesson was applied by:

- separating active run state from one inbound request wait cycle
- adding attach, detach, and interval watch commands for routed threads
- keeping tmux-backed runs monitored after observation-window detachment
- preventing stale cleanup from killing detached but still-active sessions
- surfacing active runs in both routed `/status` and operator `muxbot status`
