# Non-Functional Feature Folders

## Purpose

Use `docs/features/non-functionals/` for quality areas that cut across product features.

This is the right place for:

- performance
- security
- accessibility
- reliability
- tracing
- monitoring
- product analytics
- architecture conformance

## Why This Exists

These topics matter, but they should not be buried inside one feature folder when they affect the whole repository.

Keeping them here makes ownership and navigation clearer.

## Folder Rules

- use stable area names
- keep the tree shallow
- create a folder only when the area has enough material to justify it

## Workflow Rules

- track the area state in `docs/features/feature-tables.md`
- track implementation work in `docs/tasks/`
- keep this folder focused on overview, scope, and cross-cutting guidance
