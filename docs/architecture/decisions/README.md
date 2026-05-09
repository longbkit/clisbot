---
title: Architecture Design Decisions
description: Architecture design decision records for repository-level clisbot architecture.
---

This folder contains the architecture design decision records for `clisbot`.

Use this folder for stable decisions that shape repository-level architecture, including:

- system-wide design choices
- ownership-boundary decisions
- routing, state, persistence, and data-flow tradeoffs
- decisions that affect multiple features or surfaces

## File Naming

Use `yyyy-MM-dd-short-slug.md`.

## What Does Not Belong Here

Do not use this folder for:

- feature-local end-user experience decisions
- feature-local implementation detail
- one-off delivery notes or task history

Those should live under `docs/features/<feature>/decisions/` or `docs/tasks/`, depending on whether the content is a stable feature decision or active execution work.
