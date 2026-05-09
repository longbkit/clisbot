---
title: Session Continuity APIs Must Follow Owner Boundaries And One Clear Name Per Thing
date: 2026-05-02
area: agents, sessions, architecture, naming
summary: Continuity features should expose the owner boundaries already present in the runtime. Session keys, runner session ids, and continuity operations need distinct names and APIs instead of blurred verbs that leak one layer into another.
related:
  - docs/audits/agents/2026-05-01-session-key-and-runner-session-id-audit.md
  - docs/audits/architecture-conformance/2026-05-01-runtime-boundary-and-routing-audit.md
  - docs/features/agents/sessions.md
  - docs/tasks/2026-05-02-session-continuity-boundary-and-runner-service-leak-cleanup.md
  - docs/tasks/features/agents/2026-05-02-live-session-id-runtime-truth-and-memory-registry.md
---

## Context

The May 2, 2026 continuity pass kept circling the same confusion:

- what object identifies the chat/session continuity contract
- what object identifies the live runner process
- which service is allowed to create, capture, resume, or report each one

Once those names blur, the API surface starts collecting verbs that sound convenient but hide ownership.

## Lesson

Continuity APIs should not flatten distinct layers into one generic concept of "session."

At minimum, `clisbot` needs separate language for:

- the user-facing continuity key
- the live runner-side session/process identifier
- the service that owns continuity records
- the service that owns runner truth

The product gets simpler when the names get sharper.

## Practical Rule

Before adding or renaming continuity APIs:

1. ask which boundary owns the state
2. use one stable name for that thing everywhere
3. avoid verbs that imply ownership transfer unless the design truly changed
4. make the feature docs and audits agree on the same nouns

If one field can mean both "same chat context" and "same live runner instance," the naming is still wrong.
