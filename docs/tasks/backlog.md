# muxbot Backlog

## Purpose

This file is the project-management index for `docs/tasks/`.

Use it to track:

- status
- priority
- owning feature area
- the main task doc
- the latest note worth seeing at a glance

Do not turn this file into a full spec.

Subtasks, long notes, and detailed decisions belong in the linked task docs.

## Status Legend

- `Planned`
- `Ready`
- `In Progress`
- `Blocked`
- `Done`
- `Dropped`

## Priority Legend

- `P0`
- `P1`
- `P2`
- `P3`

## Active

| Status | Priority | Feature | Task | Main Doc | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| In Progress | P0 | channels | slack channel MVP validation and hardening | [2026-04-04-slack-channel-mvp-validation-and-hardening.md](features/channels/2026-04-04-slack-channel-mvp-validation-and-hardening.md) | 2026-04-05 | `SLACK_TEST_CHANNEL` mention flow, killed-session recovery, stored session-id resume, and natural no-mention continuation in channel threads are now proven after enabling Slack `message.channels`; remaining work is duplicate-event hardening, bot-traffic blocking verification, and response polish. |
| In Progress | P0 | agent-os | agent-os lifecycle and state model hardening | [2026-04-04-agent-os-lifecycle-and-state-model-hardening.md](features/agent-os/2026-04-04-agent-os-lifecycle-and-state-model-hardening.md) | 2026-04-05 | `sessionKey` to `sessionId` continuity, runner-loss recovery, and stale tmux cleanup are now implemented; reset policy and fuller health transitions remain open. |
| In Progress | P0 | agent-os | agent workspace attachments | [2026-04-06-agent-workspace-attachments.md](features/agent-os/2026-04-06-agent-workspace-attachments.md) | 2026-04-06 | Save inbound Slack and Telegram files under workspace `.attachments`, then inject only `@/absolute/path` mentions into the prompt text. |
| In Progress | P0 | runners | runner interface standardization and tmux runner hardening | [2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md](features/runners/2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md) | 2026-04-05 | tmux runner resume by stored session id and stale-session cleanup are working; normalized runner contract, reset policy, and stronger delta or settled-state semantics remain open. |

## Planned

| Status | Priority | Feature | Task | Main Doc | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Planned | P0 | runners | AI CLI structured streaming and interrupt evaluation | [2026-04-05-ai-cli-structured-streaming-and-interrupt-evaluation.md](features/runners/2026-04-05-ai-cli-structured-streaming-and-interrupt-evaluation.md) | 2026-04-05 | Check whether native JSON output or JSON streaming, returned session ids, and ACP can improve UX versus pane scraping without losing tmux-style immediate steering and interrupt control. |
| Planned | P0 | agent-os | conversation follow-up policy and runtime control api | [2026-04-05-conversation-follow-up-policy-and-runtime-control-api.md](features/agent-os/2026-04-05-conversation-follow-up-policy-and-runtime-control-api.md) | 2026-04-05 | Add configurable follow-up TTL, mention-only or paused follow-up modes, and an agent-callable runtime control API so Codex or Claude can change conversation behavior on request. |
| Planned | P1 | agent-os | openclaw session compatibility expansion | [2026-04-04-openclaw-session-compatibility-expansion.md](features/agent-os/2026-04-04-openclaw-session-compatibility-expansion.md) | 2026-04-04 | Add bindings, reset policy, and richer session metadata so OpenClaw users can transfer configuration and mental models with less friction. |
| Planned | P2 | agent-os | multi-surface bash command addressing | [2026-04-04-multi-surface-bash-command-addressing.md](features/agent-os/2026-04-04-multi-surface-bash-command-addressing.md) | 2026-04-04 | Later support explicit shell targeting such as `!1:` or `!bash:` while keeping one reusable default shell per agent session today. |
| Ready | P0 | channels | chat-first streaming and transcript request commands | [2026-04-04-chat-first-streaming-and-transcript-request-commands.md](features/channels/2026-04-04-chat-first-streaming-and-transcript-request-commands.md) | 2026-04-04 | Make meaningful-only streaming the default Slack interaction model and support full session visibility only through explicit transcript request commands. |
| Planned | P1 | control | operator control surface and debuggability | [2026-04-04-operator-control-surface-and-debuggability.md](features/control/2026-04-04-operator-control-surface-and-debuggability.md) | 2026-04-04 | Turn inspect, attach, restart, stop, and health actions into a first-class control system. |
| Planned | P1 | configuration | configuration control-plane expansion | [2026-04-04-configuration-control-plane-expansion.md](features/configuration/2026-04-04-configuration-control-plane-expansion.md) | 2026-04-04 | Expand the local config so it truthfully expresses channels, Agent-OS, runners, control, and policy. |
| Planned | P2 | channels | api channel MVP | [2026-04-04-api-channel-mvp.md](features/channels/2026-04-04-api-channel-mvp.md) | 2026-04-04 | Add the OpenAI-compatible API surface as a channel rather than as a separate product system. |
| Planned | P2 | runtime-benchmarks | bun go rust benchmark harness | [2026-04-04-bun-go-rust-benchmark-harness.md](features/runtime-benchmarks/2026-04-04-bun-go-rust-benchmark-harness.md) | 2026-04-04 | Build the benchmark and soak-test layer for the later multi-language comparison. |

## Blocked

| Status | Priority | Feature | Task | Main Doc | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## Done

| Status | Priority | Feature | Task | Main Doc | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Done | P0 | cross-cutting | OpenClaw session and context analysis | [2026-04-04-openclaw-session-context-analysis.md](2026-04-04-openclaw-session-context-analysis.md) | 2026-04-04 | Captured the initial model for OpenClaw session state, workspace memory, transcript boundaries, and the main privacy questions `muxbot` still needs to answer. |
| Done | P0 | cross-cutting | documentation system bootstrap | [2026-04-04-documentation-system-bootstrap.md](2026-04-04-documentation-system-bootstrap.md) | 2026-04-04 | Added the initial docs, architecture, features, tasks, and lessons scaffold, then refactored them toward the truthful system model. |
| Done | P0 | configuration | privilege command route gating | [2026-04-07-sensitive-command-route-gating.md](features/configuration/2026-04-07-sensitive-command-route-gating.md) | 2026-04-07 | Transcript and bash commands now use `privilegeCommands`, stay disabled by default, and can be limited to explicit route and user-id allowlists. |
| Done | P0 | configuration | OpenClaw-style agent CLI and bootstrap | [2026-04-07-openclaw-style-agent-cli-and-bootstrap.md](features/configuration/2026-04-07-openclaw-style-agent-cli-and-bootstrap.md) | 2026-04-07 | Added OpenClaw-like `agents` control commands, explicit tool-aware agent creation, bootstrap seeding, bindings, and richer `start` or `status` summaries. |
| Done | P0 | configuration | start first-run bootstrap and token gating | [2026-04-07-start-first-run-bootstrap-and-token-gating.md](features/configuration/2026-04-07-start-first-run-bootstrap-and-token-gating.md) | 2026-04-07 | `start` now requires default Slack or Telegram tokens, bootstraps only available channels, and auto-creates the first default agent only when the CLI choice is unambiguous. |

## Update Rules

- Add a task to `Active` only when someone is actually working it.
- If work pauses mid-batch, update the active row note with the real stop state.
- Keep `Planned` prioritized from most important to least important.
- Move blocked work to `Blocked` instead of hiding it in notes.
- Move finished work to `Done`; do not delete it.
- Keep notes to one short sentence.
