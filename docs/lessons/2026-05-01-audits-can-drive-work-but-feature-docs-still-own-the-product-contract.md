---
title: Audits Can Drive Work But Feature Docs Still Own The Product Contract
date: 2026-05-01
area: architecture, docs, workflow, planning
summary: Architecture audits are valid first-class inputs for planning and correction, but they should not replace the canonical feature docs and task docs that define the product contract and implementation scope.
related:
  - docs/audits/architecture-conformance/2026-05-01-runtime-boundary-and-routing-audit.md
  - docs/audits/agents/2026-05-01-session-key-and-runner-session-id-audit.md
  - docs/features/agents/sessions.md
  - docs/tasks/2026-05-02-session-continuity-boundary-and-runner-service-leak-cleanup.md
  - docs/lessons/2026-04-18-final-artifacts-must-not-echo-review-language.md
---

## Context

On May 1, 2026 the repo used architecture audits as direct input for active work. That was useful. The audits surfaced real contract drift around routing, runtime boundaries, session keys, and runner session ids.

The important lesson was about document roles:

- audits are a strong source of findings and follow-up work
- feature docs still define the steady-state contract
- task docs still define the implementation slice

If those roles blur, the repo becomes hard to navigate.

## Lesson

Treat audits as first-class planning inputs, not as a replacement for feature ownership.

An audit should be able to say:

- what is drifting
- why it matters
- which contract appears inconsistent
- what follow-up work should exist

But the lasting product rule should still live in the feature doc or lesson that owns it.

## Practical Rule

When an audit drives product changes:

1. capture the finding in the audit
2. open or update a task for the fix
3. update the feature doc or canonical contract doc if behavior changes
4. write a lesson if the pattern is reusable beyond the single audit

That preserves both discoverability and ownership.
