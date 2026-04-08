---
date: 2026-04-04
title: Autonomous mode means dont stop early
area: process
summary: When asked to work autonomously, continue through implementation, verification, and in-scope backlog work until the task is truly done or blocked.
related:
  - AGENTS.md
  - docs/tasks/README.md
  - docs/tasks/backlog.md
---

## Context

Autonomous execution fails when a completed sub-batch is treated like a stop signal even though the requested scope is still open.

## What Went Wrong Or What Was Learned

Reporting progress is not the same as finishing the task.

In autonomous mode, a checkpoint should not become an implicit stop unless the work is actually complete or a real blocker exists.

The normal completion loop should include available verification tools:

- runtime checks
- tests
- build verification
- logs when behavior is unclear

## Rule Going Forward

When the user asks to continue, proceed autonomously, or expects end-to-end execution:

- continue into the next highest-value in-scope task after each verified milestone
- use verification tools as part of the normal completion path
- stop only for true completion, true blockers, or true architecture or intent conflicts

Treat milestone updates as checkpoints, not stop points.
