# DX

## Summary

DX is the developer and operator experience area for machine-readable control surfaces, compatibility contracts, and validation workflows that keep `clisbot` understandable while upstream tools keep changing.

## State

Planned

## Why It Exists

Some important product truths are not end-user chat features:

- what a CLI actually supports
- how operators and automation inspect that support
- which machine-readable contracts are safe to build on
- how compatibility drift is detected before it becomes production confusion

Those concerns should not be scattered across `agents`, `runners`, `stability`, and ad hoc notes.

## Scope

- operator and developer-facing machine-readable control surfaces
- compatibility contracts for upstream interactive CLIs
- capability normalization and CLI profile docs
- fake CLI regression harness design
- real CLI canary strategy and artifact conventions
- capability matrices and drift classification docs

## Non-Goals

- end-user channel UX
- owning agent product semantics
- owning runner implementation details
- cross-cutting incident tracking

## Related Task Folder

- [docs/tasks/features/dx](../../tasks/features/dx)

## Related Feature Docs

- [CLI Compatibility](./cli-compatibility/README.md)
- [CLI Compatibility Human Checklist](./cli-compatibility/human-checklist.md)
- [CLI Compatibility Operator Validation Map](./cli-compatibility/operator-validation-map.md)
- [Bootstrap Trust And Readiness Report](./cli-compatibility/bootstrap-trust-and-readiness-report.md)

## Dependencies

- [Agents](../agents/README.md)
- [Runners](../runners/README.md)
- [Control](../control/README.md)
- [Stability](../non-functionals/stability/README.md)

## Current Focus

The v0 DX contract is now documented.

The next implementation batch should:

- map `runner ... --json` surfaces onto the published compatibility contract
- ship the first real-CLI smoke surface against Codex, Claude, and Gemini
- keep fake CLI regression work aligned to the same capability vocabulary instead of inventing a second model
