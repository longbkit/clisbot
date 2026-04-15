# clisbot Feature Tables

## Purpose

This file is the feature-level index for `docs/features/`.

Use it to track:

- current feature state
- the main feature doc
- the related task folder
- the latest short note that matters for navigation

Do not turn this file into a backlog.

Execution detail belongs in `docs/tasks/`.

## State Legend

- `Proposed`
- `Planned`
- `Active`
- `Stable`
- `Paused`
- `Archived`

## Feature Areas

| State | Area | Feature | Main Doc | Tasks Folder | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Active | surface | channels | [channels](channels/README.md) | [channels tasks](../tasks/features/channels) | 2026-04-14 | Channels now share a first-class plugin seam plus an explicit observer-failure boundary, with current follow-up focused on clearer DM-first onboarding guidance from shared surfaces. |
| Active | platform | auth | [auth](auth/README.md) | [auth tasks](../tasks/features/auth) | 2026-04-15 | Auth roles, permissions, prompt protection, pairing bypass, and `clisbot auth ...` are live; automatic first-owner claim is still the main unfinished slice. |
| Active | core | agents | [agents](agents/README.md) | [agents tasks](../tasks/features/agents) | 2026-04-04 | The agents layer owns agents, sessions, workspaces, memory, tools, skills, queueing, and subagents without depending on tmux-specific mechanics. |
| Active | core | runners | [runners](runners/README.md) | [runner tasks](../tasks/features/runners) | 2026-04-08 | Runners now need to keep monitoring long-running sessions after request-level detachment so channels can re-attach and still receive final settlement. |
| Planned | ops | control | [control](control/README.md) | [control tasks](../tasks/features/control) | 2026-04-14 | Operator inspect, attach, restart, stop, health, and other intervention surfaces belong to control, while permission semantics now live in auth. |
| Active | platform | configuration | [configuration](configuration/README.md) | [configuration tasks](../tasks/features/configuration) | 2026-04-14 | Configuration remains the local control plane for channels, agents, runners, and policy storage, with persisted auth policy shape staying here while auth semantics live in the auth feature area. |

## Non-Functional Areas

| State | Area | Feature | Main Doc | Tasks Folder | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Active | non-functional | architecture conformance | [architecture-conformance](non-functionals/architecture-conformance/README.md) | [docs/tasks](../tasks) | 2026-04-04 | Use this area to keep implementation aligned with the architecture documents. |
| Active | non-functional | stability | [stability](non-functionals/stability/README.md) | [stability tasks](../tasks/features/stability) | 2026-04-11 | Stability is a first-class quality area for delay, runtime truthfulness, session drift, cross-layer recovery behavior, and channel-failure containment. |
| Planned | non-functional | runtime benchmarks | [runtime-benchmarks](non-functionals/runtime-benchmarks/README.md) | [runtime-benchmark tasks](../tasks/features/runtime-benchmarks) | 2026-04-04 | Compare Bun, Go, and Rust only after the Bun MVP contract is grounded by shared tests. |

## Update Rules

- Add or update one row per stable feature area.
- Keep states short and clear.
- Link to one front door doc per feature.
- Link to one task folder when implementation work exists.
- Keep notes to one short sentence.
- Move deep scope, rationale, and subtasks into linked docs.
