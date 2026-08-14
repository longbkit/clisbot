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
| Active | surface | channels | [channels](channels/README.md) | [channels tasks](../tasks/features/channels) | 2026-04-18 | Channels now share a first-class plugin seam, and the next Vietnam expansion path is explicitly split into `zalo-bot`, `zalo-oa`, and `zalo-personal` instead of one blurred Zalo provider. |
| Proposed | surface | T3 channel control plane | [T3 unified channel control plane](channels/t3code-unified-channel-control-plane.md) | [channels tasks](../tasks/features/channels) | 2026-08-12 | One-command UI/headless distribution, bidirectional conversation binding, and policy-driven sharing while clisbot remains channel owner. |
| Active | platform | auth | [auth](auth/README.md) | [auth tasks](../tasks/features/auth) | 2026-04-24 | Auth now includes first-owner claim, shared-route audience gating, silent `disabled` surfaces, deny-before-runner shared allowlist enforcement, and explicit owner/admin-vs-allowlist invariants. |
| Active | core | agents | [agents](agents/README.md) | [agents tasks](../tasks/features/agents) | 2026-05-03 | The agents layer now owns session continuity through `SessionMapping`, preserves stored session ids on ambiguous recovery, and annotates persistence truth in diagnostics alongside durable queue state. |
| Active | core | runners | [runners](runners/README.md) | [runner tasks](../tasks/features/runners) | 2026-07-02 | Runners now sit behind a code-level `RunnerBackend` contract with two implementations: the hardened tmux backend and a new ACP backend (adapter per session, structured events, `session/load` resume, first-class cancel, permission policy, capability-aware degradation); backend selection is per agent with tmux as default. |
| Active | ops | control | [control](control/README.md) | [control tasks](../tasks/features/control) | 2026-05-03 | Control now includes operator queue inspection and creation through `clisbot queues`, plus runner debug surfaces that avoid live pane recapture just to infer session identity. |
| Active | platform | configuration | [configuration](configuration/README.md) | [configuration tasks](../tasks/features/configuration) | 2026-04-24 | Configuration now standardizes surface policy on `directMessages` and `groups` with raw ids plus `*`, treats `group:*` as the default multi-user sender policy node, and preserves compatibility from released `0.1.43` route keys. |
| Planned | developer-experience | dx | [dx](dx/README.md) | [dx tasks](../tasks/features/dx) | 2026-04-17 | DX now has a first-class front door for machine-readable operator surfaces, upstream CLI compatibility contracts, and future fake-vs-real compatibility validation. |

## Non-Functional Areas

| State | Area | Feature | Main Doc | Tasks Folder | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Active | non-functional | architecture conformance | [architecture-conformance](non-functionals/architecture-conformance/README.md) | [docs/tasks](../tasks) | 2026-05-01 | Use this area to keep implementation aligned with the architecture documents, with recurring evidence now living under `docs/audits/architecture-conformance/`. |
| Planned | non-functional | security | [security](non-functionals/security/README.md) | [security tasks](../tasks/features/security) | 2026-04-17 | Security now needs a first-class front door for shared-surface trust boundaries, abuse resistance, and bot-to-bot loop containment. |
| Active | non-functional | stability | [stability](non-functionals/stability/README.md) | [stability tasks](../tasks/features/stability) | 2026-05-03 | Stability now includes bounded restart false-failure recovery, delayed trust-prompt handling before prompt submission, and more truthful queue/session recovery without clearing continuity on weak evidence. |
| Planned | non-functional | runtime benchmarks | [runtime-benchmarks](non-functionals/runtime-benchmarks/README.md) | [runtime-benchmark tasks](../tasks/features/runtime-benchmarks) | 2026-04-04 | Compare Bun, Go, and Rust only after the Bun MVP contract is grounded by shared tests. |

## Update Rules

- Add or update one row per stable feature area.
- Keep states short and clear.
- Link to one front door doc per feature.
- Link to one task folder when implementation work exists.
- Keep notes to one short sentence.
- Move deep scope, rationale, and subtasks into linked docs.
