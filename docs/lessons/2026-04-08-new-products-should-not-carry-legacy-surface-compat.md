---
title: New Products Should Not Carry Legacy Surface Compatibility By Default
date: 2026-04-08
area: naming, configuration, release
summary: When the product is still new, prefer one clean naming and config surface over compatibility shims, stale aliases, and half-finished renames.
related:
  - docs/features/configuration/README.md
  - docs/architecture/architecture-overview.md
  - src/config/core/schema.ts
  - src/config/core/template.ts
  - README.md
---

## Context

This lesson comes from recurring Codex feedback in the `clisbot` project on April 7-8, 2026.

It was confirmed against local Codex session history captured during project work, where the user repeatedly pushed on:

- removing stale `tmux-talk` naming completely
- not keeping legacy config fields such as millisecond-only duration keys
- not preserving old command/config shapes just because they existed briefly during iteration
- keeping OpenClaw compatibility only where it was intentional and useful, not as a reason to keep internal drift or duplicate surfaces

## Lesson

For a new product, compatibility should be earned, not inherited automatically from earlier iterations.

Preferred rules:

- finish renames completely
- use one public name per concept
- remove temporary aliases once the intended shape is decided
- do not keep fallback behavior unless it is a deliberate product requirement
- if compatibility is wanted, document exactly what is compatible and what is intentionally different

## Practical Rule

Before keeping a legacy field, alias, or old name, ask:

1. Is there already external usage that truly depends on it?
2. Does keeping it make the public surface easier or harder to understand?
3. Would a new operator reasonably expect this product to support both names?
4. Is this compatibility part of the product strategy, or just leftover implementation inertia?

If the answer is mostly "no", remove it.

## Applied Here

This lesson was applied by:

- removing stale `tmux-talk` references instead of documenting both names
- preferring the new duration-field shape instead of keeping legacy millisecond config keys
- tightening README and user-guide wording to one clean public narrative
- keeping OpenClaw compatibility explicit and selective instead of broad and fuzzy
