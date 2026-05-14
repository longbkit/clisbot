---
title: CLI Trust-Flow Drift Must Update Runner Defaults And Existing Agent Config
date: 2026-04-13
area: runners, configuration, gemini
summary: When a CLI adds or changes a first-start trust flow, clisbot must update both the runner-owned automation path and the persisted agent config that may still override old defaults.
related:
  - docs/architecture/runtime-architecture.md
  - docs/features/runners/gemini-cli.md
  - src/config/runtime/agent-tool-presets.ts
  - src/agents/runtime/runner-service.ts
  - src/runners/tmux/session-handshake.ts
  - test/agent-service/agent-service.test.ts
  - test/tmux-runner-latency/tmux-runner-latency.test.ts
---

## Context

This lesson came from tracing a live Gemini DM failure on April 13, 2026 under `CLISBOT_HOME=~/.clisbot-dev`.

The visible symptom was a first-turn timeout, but the pane truth was different:

- Gemini CLI showed an untrusted-folder screen before the normal ready prompt
- the runner still treated Gemini as a ready-pattern-only startup path
- the stored dev config still carried `trustWorkspace: false` from the older Gemini preset

That combination made the failure look like generic startup slowness when the real problem was stale trust-flow assumptions at both the runner-default and persisted-config layers.

## Lesson

First-start trust flows are backend quirks and belong inside the runner contract.

Preferred rules:

- if a CLI introduces a trust screen before its normal ready banner, handle it inside runner startup polling
- do not rely on a later post-start trust-dismiss step when startup itself is gated by a ready pattern
- when a default runner policy changes, check whether existing persisted agent configs still override the old value
- validate the real pane state from tmux before diagnosing a startup timeout as readiness or auth-only failure
- add regression coverage for the exact prompt shape that was observed live

## Practical Rule

When a routed CLI suddenly starts stopping at a trust or safety screen, check:

1. Does startup polling recognize and dismiss that screen before ready-pattern matching?
2. Is the CLI preset default still aligned with the observed trust behavior?
3. Do existing agent configs still persist an older override such as `trustWorkspace: false`?
4. Has the live tmux pane been inspected directly to confirm the blocker text?

## Applied Here

This lesson was applied by:

- adding Gemini trust-screen detection to tmux session bootstrap polling
- changing the Gemini preset default to `trustWorkspace: true`
- updating the persisted `~/.clisbot-dev/clisbot.json` agent runner override that still forced `trustWorkspace: false`
- adding regression tests for Gemini trust dismissal during startup and for Gemini trust-screen transcript cleanup
- revalidating the live Gemini main session until the first prompt completed successfully
