---
title: Runtime Startup And Health Truth Must Follow The Smallest Safe Owner Boundary
date: 2026-04-15
area: runtime, stability, isolation, health
summary: A startup or lifecycle failure in one channel service or account should not automatically take down unrelated healthy owners. Runtime startup, recovery, and health reporting should isolate failure at the smallest safe owner boundary the product can actually manage.
related:
  - docs/tasks/features/stability/2026-04-15-runtime-crash-containment-and-service-self-healing.md
  - docs/research/agents/2026-04-15-session-runner-boundary-validation.md
  - docs/audits/architecture-conformance/2026-05-01-runtime-boundary-and-routing-audit.md
  - docs/lessons/2026-04-16-system-design-refactors-must-converge-through-explicit-problem-framing-invariants-and-validation-loops.md
  - docs/lessons/2026-04-20-runtime-alerts-and-debug-watch-paths-must-point-to-the-real-failing-boundary.md
---

## Context

The April 15, 2026 runtime hardening work surfaced a specific resilience gap that was larger than one bug:

- runtime startup was still all-or-nothing across channel services
- one broken Slack or Telegram account could abort the whole runtime
- persisted health was still too coarse and could mark an entire channel unhealthy when only one owned instance had failed

That meant the product's real isolation boundaries and its startup or health behavior were still misaligned.

## Lesson

Failure containment and health truth should match the smallest safe owner boundary the runtime can actually operate.

If the product can isolate ownership per service instance, account, or routeable runtime slice, then startup and health should not collapse back to one coarse channel-wide fate unless there is no safe alternative.

## Practical Rule

When designing startup, restart, or health behavior:

1. identify the real owner boundary
2. contain startup failure at that boundary when safe
3. keep unrelated healthy owners running
4. report health at the same granularity as the failure boundary

If the runtime starts per account but status only reports per channel, operator truth is still incomplete.

## Why It Matters

Coarse blast radius creates two product failures at once:

- resilience is worse because healthy siblings are taken down with the broken owner
- diagnostics are worse because operator status cannot tell which owner actually failed

That combination makes the product look more fragile and less understandable than it needs to be.

## Reusable Heuristic

For remote-service work in `clisbot`, ask this early:

- what is the smallest boundary that can fail independently?
- can startup continue without that owner?
- can health name that owner precisely?

If the answer is yes but the implementation still behaves channel-wide, the design is still too coarse.
