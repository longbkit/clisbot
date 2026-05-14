---
title: User-Facing Config Should Use Human Units
date: 2026-04-08
area: configuration, control, docs
summary: User-facing config and status output should prefer minutes and seconds over milliseconds when operators need to read and edit values directly.
related:
  - docs/features/configuration/README.md
  - docs/user-guide/README.md
  - config/clisbot.json.v0.1.0.template
  - src/config/core/schema.ts
  - src/config/core/load-config.ts
  - src/config/runtime/duration.ts
---

## Context

This lesson comes from recurring Codex feedback in the `clisbot` project around follow-up TTL and runtime timeout configuration.

It was confirmed against local Codex session history captured during project work, where the user repeatedly pushed for minute-based defaults, optional second-based overrides, and removal of millisecond-based config from the public surface.

The repeated issue was not that duration support was missing. The issue was that the exposed config shape was too implementation-oriented for operators:

- `participationTtlMs` was harder to read than `participationTtlMin`
- `maxRuntimeMs` was harder to reason about than `maxRuntimeMin`
- status and docs had to explain raw milliseconds that users did not want to think in

The project is operator-facing, team-facing, and expected to be configured manually. That means the config surface should optimize for legibility first.

## Lesson

When a duration is part of operator-facing config:

- default to minute-based fields when that matches normal human reasoning
- support second-based fields when short test values or tight control are useful
- avoid millisecond fields unless the audience is implementation code rather than config authors
- normalize to milliseconds internally after load if the runtime needs that form

## Practical Rule

For any new user-facing duration field:

1. Ask whether an operator would naturally think about it in minutes, seconds, or milliseconds.
2. Put the human unit in config.
3. Convert once during config load.
4. Keep docs, templates, and status output on the same unit vocabulary.

## Applied Here

This lesson was applied by:

- replacing `participationTtlMs` with `participationTtlMin` and `participationTtlSec`
- replacing `maxRuntimeMs` with `maxRuntimeMin` and `maxRuntimeSec`
- updating docs and templates to describe the new shape instead of keeping compatibility wording
- keeping internal runtime behavior normalized after config load rather than exposing raw millisecond config
