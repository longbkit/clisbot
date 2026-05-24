---
title: Architecture
description: System architecture notes for the clisbot repository.
---

This section is the stable entry point for repository-level architecture rules.

Historical or exploratory material may still exist under subfolders such as `v0.2/`, but those are not part of the current architecture contract unless a current entry doc links to them explicitly.

## Current Documents

- [Architecture Overview](architecture-overview.md)
- [Surface Architecture](surface-architecture.md)
- [Runtime Architecture](runtime-architecture.md)
- [Transcript Presentation And Streaming](transcript-presentation-and-streaming.md)
- [Domain Language](domain-language.md)
- [Architecture Design Decisions](decisions/README.md)
- [Session Key And Session Id Continuity Decision](decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)
- [Canonical Surface Concepts And Provider Capabilities](decisions/2026-05-10-canonical-surface-concepts-and-provider-capabilities.md)
- [Shared Message Surface And Channel-Owned Custom Subtrees](decisions/2026-05-10-shared-message-surface-and-channel-owned-custom-subtrees.md)
- [Channel-Native Replaces Message Custom](decisions/2026-05-24-channel-native-replaces-message-custom.md)
- [Static Built-In Channel Installation Inventory](decisions/2026-05-13-static-built-in-channel-installation-inventory.md)
- [Owned Helper Boundaries And Infra Primitives](decisions/2026-05-13-owned-helper-boundaries-and-infra-primitives.md)

## What Belongs Here

Use `docs/architecture/` for documents that define system shape and implementation constraints across the repository, including:

- system structure and major boundaries
- channel, auth, agent, runner, control, and configuration boundaries
- routing, state, persistence, and data-flow decisions
- canonical domain language, model families, invariants, and allowed boundary crossings
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
