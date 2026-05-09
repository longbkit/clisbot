---
title: Runtime Alerts And Debug Watch Paths Must Point To The Real Failing Boundary
date: 2026-04-20
area: runtime, control, stability, debugging
summary: When a session stalls or disappears, alerts and operator guidance must identify the failing boundary precisely. Debug watch paths must stay observational and must not distort ready-state or delivery behavior.
related:
  - docs/lessons/2026-04-15-runtime-startup-and-health-truth-must-follow-the-smallest-safe-owner-boundary.md
  - docs/audits/architecture-conformance/2026-05-01-runtime-boundary-and-routing-audit.md
  - docs/features/control/runner-debug-cli.md
  - docs/tasks/features/control/2026-04-18-runner-debug-watch-cli.md
  - docs/tasks/features/stability/2026-04-27-session-runner-state-machine-review.md
  - docs/lessons/2026-04-16-cross-cutting-refactors-need-explicit-scope-control-validation-tracking-and-surface-lockstep.md
---

## Context

Several April 20-30 stability passes exposed the same pattern in different forms:

- a user-facing failure was reported as "runner died" even when the more accurate fault was elsewhere
- watch/debug tooling leaked into reasoning about the normal runtime path
- startup, ready-state, ingress, and delivery symptoms were sometimes discussed as if they were one boundary

That makes debugging slower and operator trust worse, because the system names the wrong owner when something breaks.

## Lesson

`clisbot` needs boundary-truthful failure reporting.

Do not collapse these into one bucket:

- channel ingress did not receive the message
- route or auth rejected the message
- runner session failed to start
- startup never reached ready
- debug/watch observer lost visibility
- renderer or delivery failed after the runner already produced output

Those are different failures with different owners.

## Practical Rule

Whenever an alert, status line, or recovery path mentions runtime failure:

1. name the narrowest failing boundary that current evidence supports
2. avoid blaming the runner unless the runner is the proven failure
3. keep watch/debug code observational unless the product explicitly says otherwise
4. verify that ready-state logic still works when watch mode is absent

If a debug path can change product behavior, it is no longer a debug path. It has become part of the runtime contract and must be designed and tested that way.

## Operator-Facing Rule

Status and alerts should help the operator decide which layer to inspect next:

- channel or service
- route or auth
- runtime session
- startup blocker
- output delivery

Generic "runner disappeared" language is acceptable only when the product genuinely cannot localize further.
