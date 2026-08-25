# Clisbot PaseoClaw Fusion Product Vision

## Status and Source Strategy

Clisbot PaseoClaw Fusion is an exploratory new generation of Clisbot, based on the latest `main` branch of the Paseo repository (`getpaseo/paseo`). This branch was cut directly from Paseo `main` — it intentionally does **not** carry clisbot `main` code. The fusion branch will eventually be published as a branch in the Clisbot repository, but it will remain local during the initial exploration.

Repository wiring:

- `origin` → `git@github.com:longbkit/clisbot.git` (the Clisbot home repository).
- `upstream` → `git@github.com:getpaseo/paseo.git` (the Paseo foundation this branch tracks).
- `clisbot-paseoclaw-fusion` tracks `upstream/main`.

In the near term, the project must be able to merge new changes from Paseo's `main` branch regularly. Early development must therefore preserve Paseo compatibility and keep Clisbot-specific changes as isolated as practical. New capabilities should be protected by feature toggles when appropriate, with clear integration boundaries that minimize upstream merge conflicts. This approach is intended to buy development time while the product and its architecture mature.

The initial product should remain compatible with the Paseo environment model. It should expose a daemon host that can be added to and used by compatible Paseo clients and workflows (desktop app, mobile app, web, CLI).

### Relationship to Clisbot T3Claw Fusion

This exploration is the successor in direction to the sibling Clisbot T3Claw Fusion project, which lives in the `clisbot-t3claw-fusion` folder (reference material in `clisbot-t3claw-fusion/docs`, especially `docs/overview/product-vision.md`, `docs/internals/clisbot-channels.md`, and `docs/operations/clisbot-channels.md`). A state audit of that project is at [audits/2026-08-23-clisbot-t3claw-fusion.md](../audits/2026-08-23-clisbot-t3claw-fusion.md).

The T3Claw Fusion exploration validated the product direction but exposed limits of the T3 Code foundation, and the Paseo codebase now appears the more promising base: a mature client-server agent environment with a first-class multi-provider model (Claude Code, Codex, Copilot, OpenCode, Pi), cross-device clients (iOS, Android, desktop, web, CLI), a stable WebSocket timeline, worktree-based workspace isolation, plugins, and an optional encrypted relay — with an active upstream.

From the T3Claw Fusion work, we carry forward design and experience rather than code:

- The channel-bridge architecture (isolated channel host, two independent feature kill switches, policy-based synchronization, channel-native approval actions) is a strong reference pattern to re-derive against Paseo's agent sessions and timelines.
- The acceptance-test discipline and operations runbooks in `clisbot-t3claw-fusion/docs/operations/` are reusable as-is in shape, not in content.
- T3-specific integrations (T3 thread host, T3 settings and contracts, T3 client compatibility) are out of scope here and should not be ported.

## Product Ambition

The central idea is to explore a product that combines:

- OpenClaw's strongest capabilities in channel integration, native channel features, and plugin architecture;
- Paseo's multi-provider agent support, cross-device clients, and its ability to support real work from web, desktop, and mobile against a local daemon; and
- Clisbot's goal of bringing durable agent workflows into the communication surfaces where teams already work.

The result should be a tool that works well inside a team's day-to-day work chats while also being able to grow into a more professional workspace for coding and broader office or knowledge-work collaboration.

## Problems This Direction Must Address

This new generation of Clisbot is motivated by limitations in the previous architecture and by gaps in the current tools:

- The tmux-based runtime has not been sufficiently stable.
- The previous Clisbot architecture does not make it fast enough to add many channels or support many coding-agent providers.
- Multilingual use is not supported well enough.
- Clisbot does not yet provide an approval workflow. This limits important safety-sensitive workflows, including DevOps workflows that must pause for explicit human authorization.
- When a team is doing coding work, chat alone is insufficient. People also need to review code changes, view and compare documents, inspect files, and collaborate through views such as charts.
- Paseo needs stronger security controls for team environments. A user without the required permissions must not be able to view another agent session, access another project or workspace, or run a terminal on someone else's host.
- Separating the Hub from the daemon is the right call for team management with a separately deployed Hub, but it makes simple use cases harder to promote. Starting the daemon should immediately give you a working agent for a one-person setup, and the product must scale to a professional team-managed Hub without a rewrite.
- The Paseo client interaction is strong, but day-to-day capabilities are missing: pane maximize, file search, diff viewing in markdown display mode, and direct annotation and editing of documents.
- The Paseo Hub trigger model is limited compared to Clisbot and OpenClaw. Triggers must always name explicit allowed users; there is no notion of "all users in this channel may trigger". There is no mapping of a channel thread to an agent session, so a follow-up message cannot continue the same session. The number of channels is limited, and a channel cannot connect multiple accounts (one Slack account, one GitHub, one Discord, not two). There is no granular permission layer — who may start new conversations, who may approve which tool types — of the kind Clisbot already supports and `clisbot-t3claw-fusion` is improving. See [audits/2026-08-23-paseo-hub.md](../audits/2026-08-23-paseo-hub.md).

## Product and Architecture Principles

### Upstream-Friendly Evolution

Keep the Paseo foundation recognizable and mergeable for as long as this remains valuable. Prefer feature toggles, adapters, plugins, and isolated modules over invasive cross-cutting changes. Clisbot-specific behavior should be disabled cleanly so that the base Paseo experience remains available during the early stages. Where possible, reuse Paseo's own extension points (plugins, `paseo.json` workspace configuration, MCP tooling) instead of adding parallel systems.

### Paseo-Compatible Hosts

Preserve the ability to participate in the Paseo ecosystem. A Clisbot host should remain compatible with Paseo's host, project, workspace, agent session, timeline, provider, and relay concepts wherever those concepts still fit. External work channels should attach to Paseo agent sessions rather than replacing or wrapping the timeline.

### Safe Team Operation

Treat authorization and approval as core workflow capabilities rather than optional UI details. Team deployments need explicit access boundaries for agent sessions, projects, workspaces, files, and terminals, plus approval gates for sensitive agent actions — on top of Paseo's existing pairing and E2EE relay model.

### Native Work-Channel Experience

Integrations should use the native capabilities of each channel instead of reducing every channel to a generic text transport. Threads, identities, permissions, message types, progress, and interactive actions should remain meaningful across the integration boundary.

### Transparent Agent Workspaces

Users should have substantially more visibility into the agent workspace than in the previous Clisbot implementation. Conversations should connect naturally to agent activity, approvals, files, changes, documents, and automation state — building on the transparency Paseo already provides through timelines, side panels, and workspace status.

### Clear Configuration and Operations

Channel, skill, plugin, and automation management should be understandable without requiring users to master a fragmented configuration system. Installation and upgrades should be predictable, fast, and suited specifically to coding and professional work environments.

## Core Capability Directions

### 1. Configurable Two-Way Channel Synchronization

Support a configurable two-way bridge between external work channels and Paseo agent sessions. Slack is the first concrete example:

- A message in a Slack thread can be synchronized into the corresponding Paseo agent session.
- A message, progress event, or activity in a Paseo agent session can be synchronized back into the corresponding Slack thread.
- Each direction can be enabled or disabled independently.
- Access to synchronization can be configured by user.
- Synchronization policies can select which message or activity types cross the boundary. Examples include final assistant answers, progress updates, and tool calls.

The bridge should preserve useful thread context and channel-native behavior rather than acting as an uncontrolled mirror of every timeline event. The T3Claw Fusion channel bridge (see `clisbot-t3claw-fusion/docs/internals/clisbot-channels.md`) is the design reference for this capability, re-derived against Paseo's timeline model.

### 2. A Work-Chat Model for Humans and Agents

Over time, the product should evolve toward a Slack-like collaboration concept built specifically for work with agents.

The product should support both a Lite edition and a more professional Premium edition:

- Lite should remain simple enough for one-person teams and small teams.
- Even Lite should expose a Slack-like API when another system or agent needs to interact with the workspace.
- A channel should be able to contain multiple agents, mirroring Paseo's model of multiple agent sessions in one workspace.
- Many humans and many agents should be able to interact together in the same channel and its threads — humans to humans, humans to agents, agents to agents — not just one person driving one agent.
- Premium should extend this foundation for more demanding professional team and workspace needs.

### 3. Portable Queue, Loop, and Goal Workflows

Provide queue, loop, and goal capabilities for coding-agent providers that do not support them natively. Paseo already models some of this ground (steering into running turns, schedules, and heartbeats); the goal is to make the remaining gaps consistent at the product level while respecting provider-specific behavior through adapters.

### 4. Centralized Automation Management

Add a dedicated area for configuring, monitoring, and understanding automation. Loops, queues, goals, and Paseo schedules and heartbeats should be visible in one place, with their state and relationship to agents, workspaces, and work made clear.

### 5. Clear Channel Configuration

Add a dedicated channel-management area that makes channel setup and behavior easy to understand. Hermes Agent is a useful reference for configuration clarity. OpenClaw's configuration experience appears more fragmented and should not be reproduced.

Channel configuration should make routing, identities, permissions, synchronization behavior, and native channel capabilities explicit.

### 6. Skills and Plugins for Coding and Work

Support installing and managing skills and plugins while solving the operational problems seen in OpenClaw:

- configuration should be simpler;
- installation and upgrades should be less complex;
- installation and upgrades should be faster; and
- the system should be designed specifically for coding and professional work rather than as a generic agent environment.

Paseo's plugin system is the starting point; the direction is to make it a first-class, easy-to-operate extension surface for channel and work integrations.

### 7. Better Workspace Transparency

Improve on the previous Clisbot implementation by exposing agent workspace state and activity more clearly. Users should be able to understand what the agent is doing, where it is working, what changed, and which actions or approvals remain outstanding — across devices, not just on the machine running the daemon.

### 8. Native File, Document, Diff, and Data Views

Build more capable native work views than the current Paseo experience, including:

- richer document viewing;
- native document diff viewing, including diff in markdown display mode;
- stronger file viewing, with file search;
- direct annotation and editing of documents;
- pane maximize for focused, single-pane work;
- code-change review (extending Paseo's existing side-panel and forge change-request support); and
- collaborative visual views such as charts.

These views should make it possible to perform meaningful work without forcing every artifact back into plain chat messages.

### 9. Task Management

Add task-management capabilities in both Lite and Premium forms. The goal is to connect agent collaboration to one of the most important structures in professional work.

Task management may be provided natively in the application or connected to external task-management systems. The product should support both directions as it evolves.

### 10. Flexible Deployment Shapes

Support both ends of the deployment spectrum without a rewrite. A one-person setup starts the daemon and immediately has a working agent, with no separate Hub to run or enroll. A team adds a separately deployed, professionally managed Hub for centralized control, approval boundaries, and multi-user access. The daemon-to-Hub relationship is the only difference between the two; the agent, workspace, and channel model stay the same.

## Initial Delivery Posture

The first stage is not a wholesale rewrite of every Paseo surface. It is a careful exploration of the fusion architecture while maintaining an operable Paseo-compatible base.

The dated gap analysis [audits/2026-08-23-paseoclaw-fusion-gaps.md](../audits/2026-08-23-paseoclaw-fusion-gaps.md) turns this posture into sequenced proposals — workspace init templates, a same-machine channel path, and the Hub trigger-model fixes that follow them — each with its code seam, isolation flags, and verification criteria. The channel proposal it spawned is owned by the [channel-reuse plan](../audits/2026-08-23-openclaw-channel-reuse-plan.md): the channel control plane lives in the Hub, every Hub form drives the daemon as an ordinary client through the existing trusted-client RPCs with a zero P0 daemon diff (embedded over loopback, team/remote over the relay; the upstream scoped channel is frozen legacy-compat — plan §14.7), and the build/publish/onboarding details are in the [hub-integration implementation doc](../audits/2026-08-24-hub-integration-implementation.md).

Initial changes should prioritize:

1. preserving a clean path for regularly merging the latest Paseo changes (the branch tracks `upstream/main`);
2. defining isolated extension boundaries and feature toggles, following the dual kill-switch pattern proven in T3Claw Fusion;
3. improving the runtime foundation beyond unstable tmux-dependent behavior, leaning on Paseo's daemon-owned agent processes;
4. establishing secure team authorization and approval foundations on top of Paseo's pairing and relay model;
5. proving configurable two-way synchronization between a work-channel thread and a Paseo agent session; and
6. making progress, tool activity, workspace changes, and approvals transparent enough for professional use.

This foundation should allow Clisbot PaseoClaw Fusion to mature gradually from an agent-enabled work-chat tool into a professional collaborative workspace for software development and wider office work.
