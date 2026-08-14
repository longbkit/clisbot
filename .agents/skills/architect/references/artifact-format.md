# Architecture artifact routing and format

Use plain language before internal terms. Research records investigation;
feature docs own stable feature intent; task docs own execution; decision records
preserve accepted rationale; architecture docs own the implementation contract.
None substitutes for the others.

## Choose the artifact owner

| Need | Location |
| --- | --- |
| Source-driven or exploratory analysis | `docs/research/<feature>/` |
| Architecture conformance snapshot | `docs/audits/architecture-conformance/` |
| Stable feature scope and behavior | `docs/features/<feature>/` |
| Active implementation plan and status | `docs/tasks/` or `docs/tasks/features/<feature>/` |
| Repository-wide accepted architecture decision | `docs/architecture/decisions/` |
| Feature-local accepted decision | `docs/features/<feature>/decisions/` |
| Canonical repository architecture | the relevant `docs/architecture/*.md` file |

Prefer links over repeated context. Update `docs/tasks/backlog.md` for task state
and `docs/features/feature-tables.md` for feature state when applicable.

## Plan or research artifact

Use a dated `yyyy-MM-dd-short-slug.md` filename. Include only applicable
sections:

1. Status and scope.
2. Executive conclusion.
3. Concrete current user or operator flow.
4. Current proof from contracts, code, tests, and runtime evidence.
5. Owner map: identity, lifecycle, authority, process, and persistence.
6. `CURRENT`, `TARGET`, `GAP`, and `HISTORICAL` ledger.
7. Consumer pressure tests.
8. Options, trade-offs, recommendation, and non-goals.
9. Open decisions.
10. Migration, compatibility, verification, rollout, and rollback.
11. Measurable Definition of Done.

A proposal is not accepted architecture and must say so explicitly.

## Decision record

Use a dated `yyyy-MM-dd-short-slug.md` filename and the local folder's index.

```md
---
title: <Decision title>
status: proposed | accepted | superseded
date: YYYY-MM-DD
---

# Context

<Current behavior, user need, and evidence.>

# Problem

<The exact decision required.>

# Considered Options

<Options and concrete trade-offs.>

# Decision

<Chosen owner, contract, lifecycle, persistence, compatibility, and migration.>

# Rationale

<Why this option best fits the evidence and product direction.>

# Consequences

<Benefits, costs, operational effects, tests, rollout, and rollback.>

# Supersession And Conflict Notes

<Prior/later decisions and explicit cross-links, or state that none exist.>

# Links

<Canonical docs, feature docs, research, tasks, and proof.>
```

Accepted is not implemented. Feature/task state and verification evidence must
state whether consumers, migrations, docs, and runtime behavior actually ship.

Never erase an earlier accepted decision. Mark it superseded, link both records,
and update canonical architecture to the new current rule.
