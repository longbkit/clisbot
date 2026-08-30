# PaseoClaw Fusion — Gap Analysis and Proposed Improvements

Date: 2026-08-23. Subject: the gaps between the current Paseo foundation (this branch is pure upstream `main`) and the targets named in [../overview/product-vision.md](../overview/product-vision.md). Benchmark: OpenClaw, Hermes Agent, and Clisbot/T3Claw Fusion. All proposals below are unimplemented.

Claims verified in this repo carry file paths. External claims cite the product or its docs. The two prior audits cover the ground this doc does not re-derive:

- Hub trigger-model limits: [2026-08-23-paseo-hub.md](2026-08-23-paseo-hub.md)
- T3Claw Fusion state (the validated channel-host reference): [2026-08-23-clisbot-t3claw-fusion.md](2026-08-23-clisbot-t3claw-fusion.md)

## The two requests this doc answers

1. **Workspace init with agent `.md` templates** — a mechanism to scaffold agent instruction files into a new workspace, the way OpenClaw's `onboard`/`setup` seeds `AGENTS.md`/`SOUL.md`/`USER.md`/`BOOTSTRAP.md`/`MEMORY.md` and Clisbot seeds from `templates/openclaw/` with `personal-assistant`/`team-assistant` variants.
2. **Easy channel integration for the simple same-machine use case** — start the daemon, add one channel, mention the bot in a thread, get a working agent session that persists across follow-ups. No separately deployed Hub.

## Baseline: what the daemon already has

Verified in this branch:

- **Workspace creation is registry-record-only.** `WorkspaceProvisioningService` owns all registry writes — directory opens, worktree creation, agent-create mints — so it is the single seam for init behavior (`packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts:185-242`). No files are written into the `cwd` on creation; the worktree path is the exception that already writes: it copies the repo's `paseo.json` (`seedPaseoConfigFile`, `packages/server/src/utils/worktree.ts:802`) and runs `worktree.setup` commands.
- **`paseo.json`** (repo root) carries `worktree.setup`/`teardown`, `scripts`, and `metadataGeneration` prompts (`packages/protocol/src/paseo-config-schema.ts:74-88`). Users author it; the daemon copies and consumes it.
- **Agent instruction files are left to provider cwd-discovery.** Claude Code runs with `settingSources: ["user", "project", "local"]` (`packages/server/src/server/agent/providers/claude/agent.ts:145`); Codex and the rest resolve their own homes relative to `cwd`. Paseo never seeds, manages, or reads an `AGENTS.md`/`CLAUDE.md` in a workspace.
- **Agent profiles are daemon-global** (`daemon.agentProfiles`, surfaced via the `list_profiles` MCP tool). There is no per-workspace default agent or persona.
- **Automation is schedules only** (`$PASEO_HOME/schedules`, `packages/server/src/server/schedule/`); there is no heartbeat/loop primitive in the daemon.
- **Plugins cannot host channels.** A plugin is a trusted subprocess on an IPC frame transport: it contributes RPCs, surfaces, and panels, but has no inbound listeners, no daemon-event subscription, and no workspace-lifecycle hooks (`docs/plugins.md`, `packages/server/src/server/plugins/runtime.ts`).
- **Hub is the only external-trigger surface today**, and it is remote: `hub.execution.*` only, a fresh workspace per execution, no resume, no thread binding, one connection per provider per instance (audited in [2026-08-23-paseo-hub.md](2026-08-23-paseo-hub.md)).
- **The feature-flag pattern is established**: persisted config field + `PASEO_*_ENABLED` env override + `server_info.features.*` flag with a `COMPAT(name)` tag + app `useHostFeature` gate (`packages/server/src/server/config.ts:291-811`).

## Gap 1: no workspace/agent init templates

OpenClaw seeds a full instruction-file set into the agent workspace at first run and supports per-agent workspaces and a `skipBootstrap` escape hatch (docs.openclaw.ai, "Agent workspace"). Clisbot improves on that model with curated template variants for personal vs team assistants (the base `clisbot/` repo, `docs/research/configuration/2026-04-10-openclaw-template-improvements.md`). Hermes installs a workspace directory plus `config.yaml` through `hermes setup` (hermes-agent.nousresearch.com).

Paseo creates a bare registry record and hands the `cwd` to the provider. Consequences:

- A new workspace starts with zero agent context. The vision's one-person target — "starting the daemon should immediately give you a working agent" — is not true for an agent that knows the repo's conventions, the team's review rules, or the owner's preferences.
- Per-workspace persona is inexpressible: agent profiles are global and carry no system-prompt content, and nothing writes per-repo instruction files.
- The channel flow (Gap 2) makes this worse: a bot that mints a workspace on first mention gives the user a context-free agent.

## Gap 2: no same-machine channel path

OpenClaw's Gateway hosts every channel in one process with deterministic routing, per-channel account instances, and session keys that isolate threads and forum topics (docs.openclaw.ai, "Channels & routing"). Hermes reaches the same shape with lower ceremony: `hermes gateway setup` writes `config.yaml`, each chat maps to a session, and cron jobs deliver to a home channel. Clisbot's "Channels" surface and the T3Claw Fusion host both prove the bridge pattern: isolated host module, two kill switches, policy-based sync, thread→session binding, channel-native approvals (audited in [2026-08-23-clisbot-t3claw-fusion.md](2026-08-23-clisbot-t3claw-fusion.md)).

Paseo has no channel code at all (verified: zero Slack/Telegram/Discord/inbound/webhook implementation in `packages/`), and its two extension points cannot carry one: plugins have no inbound surface, and Hub is a remote, team-shaped trigger layer with a fresh workspace per event. The vision's capability direction 1 (configurable two-way channel synchronization) therefore has no foundation to build on.

## Proposed improvements

Ordered by dependency. Each item states the seam, the isolation, and the verification; all follow the Upstream-Friendly Evolution principle — a Clisbot-owned module behind a kill switch, flag off byte-equivalent to upstream.

### 1. Workspace templates (P0)

A **workspace template** is a named set of agent instruction files (markdown) plus an optional manifest, seeded into a workspace at creation time.

- **Catalog**: built-in templates ship in a Clisbot-owned package; user templates live in a daemon-config path (default `$PASEO_HOME/templates/<id>/`). Built-ins to start: `coding` (a minimal `AGENTS.md` for coding work), `assistant` (the OpenClaw-style `AGENTS.md`/`SOUL.md`/`USER.md`/`MEMORY.md` set), and a `team-assistant` variant.
- **Seeding**: at workspace creation, write each template file that does not exist yet; never overwrite. One template can serve all providers because every provider already discovers `.md` files by name in `cwd` — the template declares which files it carries, the seeder writes them, providers pick up what they know.
- **Opt-in**: a `template` input on workspace creation (CLI flag, app form field, optional `create_workspace` MCP parameter). No template is the default, which keeps the upstream behavior. A per-repo default belongs in the repo: an optional additive `paseo.json` field (absent = no seeding). That field touches an upstream-owned schema, so it is the one part of this feature that should be offered upstream rather than kept Clisbot-side.
- **Seam**: `WorkspaceProvisioningService`, next to `seedPaseoConfigFile` on the worktree path and at the end of `createWorkspaceForDirectory`. One owner, so every entry point (app, CLI, MCP, `open_project`, agent-create mints) gets it without separate wiring.
- **Isolation**: `daemon.workspaceTemplates.enabled` + `PASEO_WORKSPACE_TEMPLATES_ENABLED` + `server_info.features.workspaceTemplates` with a `COMPAT` tag.
- **Verification**: flag off → no file writes on any create path (golden test); flag on → seeded files present, re-create idempotent, existing files untouched; `npm run typecheck` / `lint` green.

### 2. Channel host, same-machine (P0)

> **Superseded on placement (2026-08-24).** The [channel-reuse plan](2026-08-23-openclaw-channel-reuse-plan.md) dissolved the daemon `ChannelHost`: the channel control plane lives in the Hub, not a daemon module (plan §4-S2), and the P0 pivot makes the daemon diff zero — the Hub drives agents through the existing trusted-client RPCs, and the P1 grant engine is the daemon's only channel-related addition (plan §4-S3/§14.6). Refined 2026-08-25 (plan §14.7): both Hub forms ride the ordinary client wire (embedded over loopback, team/remote over the relay); the P1 grant engine narrows the full-trust pairing rather than unlocking a scoped channel. Read this item as the record of the daemon-host proposal that preceded that decision.

A **channel host** is the daemon module that owns external channel connections for this machine. The three new terms — channel, channel host, thread binding — and the rejected alternatives are recorded in the [naming record](#naming-record) below. How the channel code itself is supplied — reusing OpenClaw's published channel packages instead of writing channel adapters — is planned in [2026-08-23-openclaw-channel-reuse-plan.md](2026-08-23-openclaw-channel-reuse-plan.md). **Supply revised again by the 2026-08-26 pull:** Slack and Telegram no longer reuse the published packages at runtime — they are in-repo first-party packages (`packages/channels/*`, ported from OpenClaw's TS source), with the pinned dists kept as upstream sync references only ([2026-08-26-in-repo-channel-verticals.md](2026-08-26-in-repo-channel-verticals.md)). The shapes below assume that plan's original supply model and a P0 of one vertical; both precede the pull.

Scope of P0: one channel vertical, thread-based only, same machine.

- **First vertical: Slack Socket Mode**, because the vision names Slack the first concrete example for two-way sync. The host is channel-agnostic by construction: each channel's transport and native rendering come from OpenClaw's published channel packages (planned in [2026-08-23-openclaw-channel-reuse-plan.md](2026-08-23-openclaw-channel-reuse-plan.md)), so the second channel — Telegram polling, a single bot token, no app setup — is a pin + conformance run, not an adapter.
- **Shape** (re-derived against Paseo, not ported from T3Claw):
  - `ChannelHost` — start/stop, owns adapters, the only component that may start or address an agent session from a channel.
  - `ChannelPolicy` — who may trigger, per account and per route; deny by default; P0 is owner-plus-allowlist. The surface is designed so the team-phase RBAC from the T3Claw audit (role catalog, `approval.*` grants) slots in without a rewrite.
  - `ThreadBindings` store — file-based JSON under `$PASEO_HOME/channels/`, matching the Paseo data model; T3Claw's SQLite choice was a T3-foundation decision, and P0 has no delivery ledger or ingress queue yet that would force it.
  - Inbound: a mention in a bound thread sends into the bound agent session; an unbound thread mints a workspace + agent (optionally applying a workspace template from item 1) and records the binding.
  - Outbound: policy-filtered timeline events — final answers and progress by default; tool-call detail off — rendered into the thread. The channel host is a daemon-internal consumer of the timeline; no new wire surface.
- **Simple flow**: `paseo channels add slack` (wizard: app token, allowed users, default workspace/template) → first mention → working agent in that thread → follow-ups resume the same session across restarts.
- **Isolation**: two kill switches, both required, following the T3Claw pattern: `PASEO_CHANNELS_ENABLED` env and persisted `channels.enabled`. Config is file-watched for live reload, which T3Claw validated as the operator workflow.
- **Out of P0**: DMs, multi-account, channel-native approval cards (2026-08-27: the Slack/Telegram native card is pulled into P0 — implementation doc §4.3.3 decision), RBAC roles, Hub integration, non-Slack adapters.
- **Verification**: both switches off → the module does not load and the daemon is byte-equivalent to upstream; on → P0 live cases from the T3Claw acceptance contract re-expressed against Paseo sessions (bind, follow-up resume, restart/resume, policy denial).

### 3. Hub trigger-model fixes (P1, team)

The audited limits that block team deployments: allowlist-only `from_users` (no "all members of this channel"), no thread→session continuation, one connection per provider per instance, no approval forwarding to a channel. The channel host and Hub are complementary layers — local trigger surface vs remote trigger surface — and both should converge on the same thread-binding record when Hub learns to resume instead of mint. Two of the five limits (thread resume, approval forwarding) need new wire capabilities: gated, `COMPAT`-tagged, additive. The contribute-upstream vs Clisbot-side pre-processor decision needs your input before Hub-side changes are proposed: it changes where the work lives.

> **Updated by the 2026-08-24 pivot (plan §14.6), refined 2026-08-25 (plan §14.7):** thread resume and approval forwarding no longer need new wire at P0 — **both** Hub forms ride the existing trusted-client RPCs (`send_agent_message_request` steer, `agent_permission_response`; embedded over loopback, team/remote over the relay as an ordinary paired client). New wire survives only as the P1 grant engine's additive, capability-gated principal binding (plan §4-S3); the `hub.execution.*` scoped channel is frozen legacy-compat, expected to sunset (§14.7).

### 4. Per-workspace default agent (P1)

A workspace template carries an optional default agent profile (provider, model, mode). The first agent in the workspace picks it up; `list_profiles` and the new-workspace form surface workspace-scoped profiles alongside the daemon-global ones. It gives the channel-minted session from item 2 a defined provider and model.

## Naming record

Proposed, not yet canonical; glossary entries land when the modules do.

| Concept                                | Name                                    | Rejected alternatives                                                                                                                                                                                                                           |
| -------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instruction-file seed set              | **workspace template**                  | "workspace bootstrap" — "bootstrap" is already the daemon-startup family in this repo; "agent workspace" — OpenClaw's AgentId concept, provider-biased; "paseo init" — a CLI verb, and `init` is already overloaded (`plugin init`, `hub init`) |
| External conversation surface domain   | **channel**                             | "platform" (Hermes) — a platform is a vendor, a channel is the surface; "integration" — Hub already owns that word for provider connections                                                                                                     |
| Daemon module owning channels          | **channel host**                        | "gateway" — Hermes' word, blurs with the Hub relationship                                                                                                                                                                                       |
| External thread ↔ agent session record | **thread binding**                      | "route" — poisoned by Expo Router in this repo                                                                                                                                                                                                  |
| Config root / env switch               | `channels.*` / `PASEO_CHANNELS_ENABLED` | follows the existing `PASEO_*_ENABLED` pattern                                                                                                                                                                                                  |

No new RPCs at P0 (plan §14.6/§14.7 — the channel capability rides the existing trusted-client RPCs; config is managed through the persisted `channels` root + CLI). If a future RPC is ever added (the P1 grant engine is the only candidate), it uses dotted namespaces per [../rpc-namespacing.md](../rpc-namespacing.md) (e.g. `grant.session.bind.request`).

## Sequencing

Item 1 before item 2: the channel flow wants a templated workspace on first mention. Items 1 and 2 are independent flags and can land in separate merges. Item 4 rides on item 1. Item 3 waits on the upstream-vs-local decision.
