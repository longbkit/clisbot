# CLI Compatibility

## Summary

CLI compatibility defines the normalized capability contract between `clisbot` and upstream interactive CLIs such as Codex, Claude, and Gemini.

## State

Planned

## Why It Exists

The repo currently proves compatibility mainly through implementation slices inside runners plus scattered notes about specific CLIs.

That is not enough for long-term stability because upstream CLIs keep changing:

- startup banners drift
- ready-state prompts drift
- session id capture timing drifts
- running indicators drift
- interrupt semantics drift

The system needs one front door that says what `clisbot` expects from a CLI and how that expectation is exposed to operators and automation.

## Scope

- normalized capability definitions
- input and output contracts for compatibility operations
- shared state vocabulary such as `ready`, `running`, `waiting_input`, `blocked`, and `lost`
- CLI-specific capability profiles
- compatibility harness strategy for fake and real CLIs

## Naming Rules

Use these names consistently in this feature area:

- `CLI`: the upstream interactive tool such as Codex, Claude, or Gemini
- `CLI profile`: the per-CLI capability and drift summary
- `workspace mode`: the environment mode used to reproduce or validate behavior, such as `current` or `fresh-copy`
- `risk slice`: one operator painpoint or instability boundary that should be reproduced and measured directly
- `test`: the operator-facing validation unit built on top of lower-level probe, watch, and send surfaces
- `suite`: a grouped set of tests
- `session id`: prose form in narrative text
- `sessionId`: schema field form in JSON examples

Current exception:

- early docs still use `runner smoke`, `smoke command`, and `scenario` in some places because that was the first documented shape
- if a later batch renames the surface, prefer `runner test` and treat the older `smoke` wording as transitional

## Non-Goals

- channel rendering rules
- tmux-specific implementation details
- agent memory or conversation semantics
- one-off validation notes that belong in task docs

## Related Docs

- [DX](../README.md)
- [Human Checklist](./human-checklist.md)
- [Operator Validation Map](./operator-validation-map.md)
- [Bootstrap Trust And Readiness Report](./bootstrap-trust-and-readiness-report.md)
- [Capability Contract](./capability-contract.md)
- [CLI Profiles](./backend-profiles.md)
- [Real-CLI Smoke Surface](./real-cli-smoke-surface.md)
- [Smoke Command Contract](./smoke-command-contract.md)
- [Runners](../../runners/README.md)
- [Agents Sessions](../../agents/sessions.md)

## Current Focus

The v0 contract and launch-trio CLI profiles are now in place.

The human input checklist is now captured separately so operator painpoints stay visible even while machine-readable contracts are being normalized.

The operator validation map now turns those painpoints into reproducible risk slices with explicit workspace modes, metrics, artifacts, and operator surfaces.

The bootstrap trust and readiness report now standardizes one especially important validation unit for first-launch behavior and same-workspace reinvoke proof across Codex, Claude, Gemini, and future CLIs.

The next batch should use that published contract to drive:

- `runner probe --json`
- `runner send --json`
- `runner attach --json`
- `runner smoke`

without letting those operator surfaces drift back into CLI-specific pane heuristics.
