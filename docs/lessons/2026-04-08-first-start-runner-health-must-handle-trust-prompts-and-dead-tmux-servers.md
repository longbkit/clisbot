---
title: First-Start Runner Health Must Handle Trust Prompts And Dead Tmux Servers
date: 2026-04-08
area: runners, runtime, tmux, codex
summary: First-start reliability depends on treating trust prompts and dead tmux servers as runner-managed lifecycle concerns, with explicit recovery instead of one-shot timing assumptions.
related:
  - docs/architecture/runtime-architecture.md
  - docs/features/runners/README.md
  - src/agents/agent-service.ts
  - src/runners/tmux/client.ts
  - test/agent-service.test.ts
  - test/tmux-client.integration.test.ts
---

## Context

This lesson came from debugging `muxbot` against a real remote Linux runtime on April 8, 2026.

The observed failures looked inconsistent at first:

- local macOS behavior looked fine
- remote Linux behavior sometimes left prompts sitting in the Codex composer
- first-start trust prompts could appear late enough to interrupt session-id capture
- a stale tmux socket could exist even though no tmux server was actually alive

Those symptoms created misleading diagnoses unless the runner lifecycle was tested directly in the real environment.

## Lesson

Trust prompts and tmux server health are runner concerns, not operator mistakes and not generic channel bugs.

Preferred rules:

- do not assume one fixed startup delay is enough for first-start readiness
- do not assume a tmux socket implies a healthy tmux server
- if trust approval interrupts a runner handshake such as `/status`, re-run that handshake after trust is dismissed
- keep prompt submission logic centralized so startup, session-id capture, and normal prompts do not drift apart
- verify remote Linux behavior directly when the product depends on tmux-backed terminal semantics

## Practical Rule

Before calling a tmux-backed runner healthy, check:

1. Can the runner detect and dismiss a delayed first-start trust prompt?
2. If the trust prompt interrupts initial handshake commands, are those commands retried automatically?
3. Does the runtime distinguish "socket exists" from "tmux server is alive"?
4. Has the actual target environment been tested directly instead of inferred from local development behavior?

## Applied Here

This lesson was applied by:

- adding explicit tmux server health detection before session reuse
- polling for delayed Codex trust prompts instead of checking only once after startup
- re-submitting session-id capture commands after trust dismissal
- adding regression tests for delayed trust prompts and dead tmux server states
- validating the live remote Linux tmux-to-Codex submit path directly on `con01`
