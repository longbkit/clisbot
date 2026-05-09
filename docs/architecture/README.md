---
title: Architecture
description: System architecture notes for the clisbot repository.
---

This section is the stable entry point for repository-level architecture rules.

## Current Documents

- [Architecture Overview](architecture-overview.md)
- [Surface Architecture](surface-architecture.md)
- [Runtime Architecture](runtime-architecture.md)
- [Transcript Presentation And Streaming](transcript-presentation-and-streaming.md)
- [Glossary](glossary.md)
- [Model Taxonomy And Boundaries](model-taxonomy-and-boundaries.md)
- [Architecture Design Decisions](decisions/README.md)
- [Session Key And Session Id Continuity Decision](decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)

## What Belongs Here

Use `docs/architecture/` for documents that define system shape and implementation constraints across the repository, including:

- system structure and major boundaries
- channel, auth, agent, runner, control, and configuration boundaries
- routing, state, persistence, and data-flow decisions
- model taxonomy, invariants, and allowed boundary crossings
- cross-cutting engineering rules that should guide many features
- repository-level architecture decision records, including ownership-boundary decisions

## What Does Not Belong Here

Do not use this folder for:

- task tracking
- backlog management
- sprint notes
- feature delivery history
- one-off implementation checklists
- raw human notes or requirements
- project-goal summaries that belong in `docs/overview/`

Those belong in `docs/tasks/` or `docs/features/`.

Feature-local decisions should usually live under `docs/features/<feature>/decisions/`.
