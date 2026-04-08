# muxbot Feature Tables

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
| Active | surface | channels | [channels](channels/README.md) | [channels tasks](../tasks/features/channels) | 2026-04-04 | Slack is the first active channel, and API-compatible access is treated as another channel rather than a separate product. |
| Active | core | agent-os | [agent-os](agent-os/README.md) | [agent-os tasks](../tasks/features/agent-os) | 2026-04-04 | Agent-OS owns agents, sessions, workspaces, memory, tools, skills, queueing, and subagents without depending on tmux-specific mechanics. |
| Active | core | runners | [runners](runners/README.md) | [runner tasks](../tasks/features/runners) | 2026-04-04 | Runners standardize backend input, output, snapshots, and streaming across tmux today and ACP or SDK integrations later. |
| Planned | ops | control | [control](control/README.md) | [control tasks](../tasks/features/control) | 2026-04-04 | Operator inspect, attach, restart, stop, and health flows belong to control rather than user-facing channels. |
| Active | platform | configuration | [configuration](configuration/README.md) | [configuration tasks](../tasks/features/configuration) | 2026-04-04 | Configuration is the local control plane for channels, agent-os, runners, and policy. |

## Non-Functional Areas

| State | Area | Feature | Main Doc | Tasks Folder | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Active | non-functional | architecture conformance | [architecture-conformance](non-functionals/architecture-conformance/README.md) | [docs/tasks](../tasks) | 2026-04-04 | Use this area to keep implementation aligned with the architecture documents. |
| Planned | non-functional | runtime benchmarks | [runtime-benchmarks](non-functionals/runtime-benchmarks/README.md) | [runtime-benchmark tasks](../tasks/features/runtime-benchmarks) | 2026-04-04 | Compare Bun, Go, and Rust only after the Bun MVP contract is grounded by shared tests. |

## Update Rules

- Add or update one row per stable feature area.
- Keep states short and clear.
- Link to one front door doc per feature.
- Link to one task folder when implementation work exists.
- Keep notes to one short sentence.
- Move deep scope, rationale, and subtasks into linked docs.
