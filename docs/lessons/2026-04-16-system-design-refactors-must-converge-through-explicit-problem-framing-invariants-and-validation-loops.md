---
title: System-Design Refactors Must Converge Through Explicit Problem Framing, Invariants, And Validation Loops
date: 2026-04-16
area: architecture, stability, control, docs
summary: In architecture or resilience refactors, do not rotate between proposals, layer names, or partial fixes reactively. First frame the real problem, state the invariants, validate each slice against current code and docs, and only then converge on the smallest design that improves truthfulness, resilience, and operator clarity without introducing new ambiguity.
related:
  - docs/lessons/2026-04-16-cross-cutting-refactors-need-explicit-scope-control-validation-tracking-and-surface-lockstep.md
  - docs/tasks/features/stability/2026-04-15-runtime-crash-containment-and-service-self-healing.md
  - docs/tasks/2026-04-15-session-runner-boundary-simplification-and-validation.md
  - docs/research/agents/2026-04-15-session-runner-boundary-validation.md
  - docs/architecture/runtime-architecture.md
  - docs/architecture/architecture-overview.md
  - docs/user-guide/runtime-operations.md
  - src/control/runtime-monitor.ts
  - src/control/runtime-process.ts
  - src/control/runtime-management-cli.ts
---

## Context

This lesson came from the April 15-16, 2026 architecture and stability refactor around runner ownership, tmux-session resilience, detached runtime supervision, and operator-facing control truthfulness.

The work took longer than it should have because the design did not converge early enough. Several rounds of discussion were needed before the real shape of the problem was held steady.

The important signal was not only the final runtime-monitor implementation. The more important signal was why the earlier rounds drifted:

- proposals rotated too quickly between layers, naming, and architecture shapes
- some suggestions sounded plausible locally but were not validated against the whole system
- resilience was sometimes described as fail-soft or retry, instead of being traced to the actual recovery contract
- design discussion sometimes moved before the current code, docs, and operator flow were re-validated carefully
- there was one clear mistake where a systemd-oriented implementation was added even though the human had only asked about commands and tradeoffs, not asked for code

The human feedback repeatedly pushed in a consistent direction:

- use stronger critical thinking and system thinking
- follow KISS, but not naively
- challenge the existing architecture instead of obeying it blindly
- do not rename or split layers unless it solves a real problem cleanly
- do not stop at wording that sounds nice if runtime behavior is still wrong
- define the real resilience goal, not an intermediate fail-soft story
- validate each slice against current code and docs before building on it

## Lesson

For this repository, architecture and resilience refactors must converge through an explicit method:

1. frame the real problem first
2. state the invariants and failure boundaries
3. validate the current system honestly
4. compare a small number of candidate shapes against those invariants
5. choose the smallest design that improves truthfulness and resilience without creating new ambiguity

Do not let the work drift into reactive proposal churn.

If the design keeps changing every round, that is usually a signal that the problem statement or invariants were not made explicit enough.

## Mistakes To Avoid

### 1. Rotating between proposals before the problem is fixed in place

Do not jump between:

- renaming layers
- dropping or adding layers
- moving ownership boundaries
- introducing new concepts

unless the real underlying problem statement is already stable.

If the problem statement is still moving, architecture proposals will look like spinning instead of converging.

### 2. Confusing fail-soft with resilience

Fail-soft is not the goal.

For remote-service stability work, resilience means:

- detect the fault
- recover automatically when the state is still trustworthy
- contain the blast radius to the smallest safe boundary
- surface explicit failure only after bounded recovery is exhausted

A soft error message plus manual retry is not enough if the real requirement is self-recovery.

### 3. Solving a design question by prematurely implementing one option

If the human asks about tradeoffs, commands, or external supervision patterns, do not silently turn that into code unless asked.

The systemd detour in this cycle was a concrete mistake:

- it consumed time
- it introduced cleanup work later
- it weakened trust because the implementation moved ahead of design agreement

### 4. Proposing architecture that sounds clean locally but creates new ambiguity globally

A proposal is not good just because it simplifies one flow.

It must also be checked against:

- startup and reload behavior
- operator status truthfulness
- control CLI semantics
- channel and account isolation
- persistence and restart behavior
- documentation clarity

If a new architecture solves one problem but creates another hidden one, it is not ready.

### 5. Talking in abstractions without mapping to concrete runtime paths

When discussing resilience, process identity, or ownership, always map back to real code and real states.

Examples from this cycle:

- which process owns `clisbot.pid`
- where monitor state is persisted
- what `clisbot status` will show
- what happens if the monitor dies but the worker lives
- what exact boundary owns backoff, alerting, and stop cleanup

Without this mapping, the design may sound coherent while still being operationally vague.

## Required Method For Future Refactors

Before converging on an architecture or resilience change, explicitly answer:

1. What is the concrete problem in current code?
2. What are the non-negotiable invariants?
3. What boundary should own recovery?
4. What should happen on success, transient failure, bounded exhaustion, and operator intervention?
5. What will `status`, logs, and docs say in each state?
6. What new failure modes does the proposal introduce?
7. Is there a smaller design that solves the same problem?

If these answers are not written down yet, the refactor is not ready.

## Practical Rules

For future system-design or runtime-stability work in this repo:

- start with current-state validation, not proposal writing
- force a short invariants section before changing naming or ownership
- test each slice from multiple angles against current code and docs
- do not add implementation for an option that has not been chosen
- prefer one small design with explicit contracts over a bigger “maybe more flexible” design
- if a proposal sounds good but makes operator truth harder, reject it
- if a proposal adds retries, say who owns the retry budget and how exhaustion is surfaced
- if a proposal adds state, say who owns that state file and how stale state is cleaned up
- if user feedback says the explanation is still hard to follow, assume the design is still not sharp enough

## Feedback To Preserve

These points from the human should be treated as operating rules, not one-off comments:

- use methodology in system design work, not improvised iteration
- KISS does not mean delete layers blindly; it means keep only layers that protect real boundaries
- architecture docs are references, not commandments
- naming matters only when it reflects the right mental model
- if a new design creates new unresolved problems, it is not yet a better design
- resilience is the goal; fail-soft is only a bounded intermediate tactic
- remote services need much higher truthfulness and self-recovery discipline than normal local-tool ergonomics

## Applied Here

This lesson was applied by the final convergence toward:

- an app-owned runtime monitor instead of scattered retry semantics
- explicit backoff policy owned in config
- owner alerting tied to real reachable principals
- operator-visible monitor state in `clisbot status`
- stale-worker cleanup rules for the monitor-orphan case
- doc updates that describe the bounded resilience contract honestly instead of implying unbounded self-heal
