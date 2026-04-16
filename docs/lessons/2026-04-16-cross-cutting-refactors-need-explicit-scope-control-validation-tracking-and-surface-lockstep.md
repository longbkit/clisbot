---
title: Cross-Cutting Refactors Need Explicit Scope Control, Validation Tracking, And Surface Lockstep
date: 2026-04-16
area: process, architecture, stability, docs, control
summary: When a refactor crosses runtime behavior, operator surfaces, and documentation, do not let the work run as a loose conversation. Keep design discussion separate from implementation permission, track unresolved findings explicitly, validate one slice at a time against current code and docs, and ship changes only when code, status, logs, user guidance, and tests stay in lockstep.
related:
  - docs/lessons/2026-04-16-system-design-refactors-must-converge-through-explicit-problem-framing-invariants-and-validation-loops.md
  - docs/lessons/2026-04-14-feature-review-should-evaluate-product-contract-not-just-config-syntax.md
  - docs/lessons/2026-04-08-operator-errors-must-be-friendly-and-actionable.md
  - docs/tasks/features/stability/2026-04-15-runtime-crash-containment-and-service-self-healing.md
  - docs/tasks/2026-04-15-session-runner-boundary-simplification-and-validation.md
  - docs/research/agents/2026-04-15-session-runner-boundary-validation.md
  - docs/user-guide/runtime-operations.md
---

## Context

This lesson came from the same April 15-16, 2026 runtime and resilience cycle, but it is about process discipline rather than only architecture shape.

The refactor took too many rounds partly because the work was allowed to sprawl across several modes at once:

- design exploration
- architecture criticism
- implementation
- code review
- doc correction
- operator workflow reasoning
- stability audit follow-ups

Those are all legitimate activities, but they cannot be mixed loosely in a long cross-cutting thread without losing convergence.

The repeated human feedback exposed several process failures clearly:

- some answers treated a design question as permission to build
- some proposals moved to adjacent topics before previous findings were fully validated
- some reasoning focused on one layer while forgetting status, slash-command truthfulness, or operator-visible behavior
- some findings were stated once but not carried forward as a persistent checklist
- some explanations sounded locally reasonable but were still not mapped cleanly enough for long-term ownership

## Lesson

For this repository, large cross-cutting refactors need an explicit working method:

1. separate discussion mode from implementation mode
2. keep a live list of unresolved findings
3. validate one slice at a time against current code and current docs
4. refuse to call a slice done until all operator-facing surfaces are aligned
5. only then move to the next adjacent problem

Without that structure, the work looks busy but does not converge efficiently.

## Important Failures To Prevent

### 1. Treating design discussion as implicit implementation approval

If the human is asking:

- whether a model is correct
- whether another approach is simpler
- what tradeoffs exist
- what external tooling such as `systemd` or `pm2` would imply

that is not automatic permission to implement.

The April 16 `systemd` detour was a concrete process failure. The human asked for commands and operational comparison, but code was added before agreement. That created avoidable cleanup and reduced trust.

Rule: design answers stay design answers until implementation is explicitly requested.

### 2. Letting unresolved findings disappear when the conversation shifts

In a long stability thread, new topics will keep appearing:

- startup containment
- health granularity
- slash-command truthfulness
- session recovery
- ownership naming
- process identity
- monitoring

If unresolved findings are not written into a live checklist, they get re-discovered repeatedly or half-assumed to be solved.

Rule: once a real gap is found, carry it forward in a written checklist with owner boundary, affected files, and validation needed.

### 3. Solving only the code path while leaving surrounding surfaces stale

A runtime change is not done if only the internal path was patched.

Cross-cutting runtime work must be checked together across:

- runtime behavior
- control CLI behavior
- status output
- logs and operator errors
- chat-surface replies and slash-command responses
- docs and task docs
- automated tests

If those surfaces drift apart, the product becomes untruthful even when the core code path is technically fixed.

### 4. Moving to adjacent ideas before the current slice is closed

A common failure pattern is:

1. find one issue
2. propose a fix
3. immediately branch into a broader redesign
4. forget to fully validate the original issue

That creates motion without closure.

Rule: for long refactors, every slice needs:

- the concrete issue
- the desired behavior
- the chosen owner
- the affected code and docs
- the regression risk
- the exact validation step

Only then is it safe to widen scope.

### 5. Accepting “sounds okay” explanations that still hide ambiguity

Some explanations can sound clean in conversation but still be weak because they do not answer:

- who owns the state
- who retries
- who reports exhaustion
- what the operator sees
- what happens on restart
- what happens when two adjacent boundaries both partially fail

Rule: if the explanation is still hard to map into code, status, and docs, it is not sharp enough yet.

## Required Working Method

For any refactor that touches runtime, control, channel surfaces, or stability:

1. Write the concrete finding.
2. Write why it matters operationally.
3. Name the owner boundary.
4. Name the smallest safe fix or redesign slice.
5. List affected code paths.
6. List affected docs or operator surfaces.
7. Define the exact validation needed.
8. Leave the item open until that validation is complete.

This is not optional process overhead. It is how cross-cutting work stays honest.

## Surface Lockstep Rule

Any change in this area should be assumed incomplete unless all relevant surfaces agree:

- runtime state
- `clisbot status`
- control commands such as `start`, `stop`, `whoami`, or slash-command guidance
- chat replies shown to end users
- operator error messages
- docs
- tests

If one surface still speaks old truth, the system is still partially broken.

## Practical Rules

For future work of this kind:

- keep an implementation-ready checklist live during the thread
- mark each finding as validated or not validated, do not rely on memory
- do not jump from one fix to the next without stating what is still open
- do not implement when the conversation is still at tradeoff-evaluation stage
- treat status, logs, and reply wording as part of the feature, not follow-up polish
- when the human says the proposal still feels unclear, assume the mental model is still weak
- if a simplification removes a layer, prove which responsibility absorbs that layer without making ownership fuzzy

## Applied Here

This lesson was applied by the later course-correction in this cycle:

- findings were regrouped into implementation-ready checklists instead of loose thread replies
- resilience work was re-framed around explicit ownership and validation slices
- operator truthfulness was treated as part of the runtime contract, not doc polish
- systemd-specific implementation was backed out once it became clear the conversation had only asked for design and operational comparison
- lessons learned were written down explicitly so future refactors do not repeat the same churn
