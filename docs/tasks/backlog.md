# clisbot Backlog

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
| In Progress | P0 | agents | agents lifecycle and state model hardening | [2026-04-04-agents-lifecycle-and-state-model-hardening.md](features/agents/2026-04-04-agents-lifecycle-and-state-model-hardening.md) | 2026-04-05 | `sessionKey` to `sessionId` continuity, runner-loss recovery, and stale tmux cleanup are now implemented; reset policy and fuller health transitions remain open. |
| In Progress | P0 | agents | agent workspace attachments | [2026-04-06-agent-workspace-attachments.md](features/agents/2026-04-06-agent-workspace-attachments.md) | 2026-04-06 | Save inbound Slack and Telegram files under workspace `.attachments`, then inject only `@/absolute/path` mentions into the prompt text. |
| In Progress | P0 | runners | runner interface standardization and tmux runner hardening | [2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md](features/runners/2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md) | 2026-04-14 | tmux runner resume by stored session id and stale-session cleanup are working; normalized runner contract, reset policy, stronger delta or settled-state semantics, and nested shell or pager blocking cases like `vi`, `nano`, `less`, or `git diff` remain open. |
| In Progress | P0 | runners | Gemini CLI runner integration and auth gating | [2026-04-13-gemini-cli-runner-integration-and-auth-gating.md](features/runners/2026-04-13-gemini-cli-runner-integration-and-auth-gating.md) | 2026-04-13 | Gemini preset, session-id strategy, readiness gating, trust-folder dismissal, and clearer routed message-tool prompt wording are implemented; authenticated success-path end-to-end validation is still pending. |
| In Progress | P0 | channels | slack telegram message actions and channel accounts | [2026-04-09-slack-telegram-message-actions-and-channel-accounts.md](features/channels/2026-04-09-slack-telegram-message-actions-and-channel-accounts.md) | 2026-04-09 | Add OpenClaw-shaped `message` actions plus first-class Slack and Telegram account maps, default-account selection, and binding-aware runtime routing. |
| In Progress | P0 | channels | agent progress reply wrapper and prompt | [2026-04-09-agent-progress-reply-wrapper-and-prompt.md](features/channels/2026-04-09-agent-progress-reply-wrapper-and-prompt.md) | 2026-04-10 | Stable local reply commands now pair with `responseMode`, `additionalMessageMode`, `\q` or `\s`, and queue inspection or clear controls; remaining work is broader live validation. |
| In Progress | P0 | channels | channel plugin standardization | [2026-04-10-channel-plugin-standardization.md](features/channels/2026-04-10-channel-plugin-standardization.md) | 2026-04-10 | Slack and Telegram now share a first-class `ChannelPlugin` seam for runtime bootstrap, operator message commands, health summaries, and route-policy composition; live Slack validation remains. |
| In Progress | P0 | channels | loop slash command | [2026-04-12-loop-slash-command.md](features/channels/2026-04-12-loop-slash-command.md) | 2026-04-12 | Add `/loop` with managed interval loops, wall-clock schedules, bounded-times parsing, `LOOP.md` maintenance fallback, restart restore, status or cancel controls, and channel test coverage. |
| In Progress | P0 | stability | tmux submit truthfulness and Telegram send reliability | [2026-04-12-tmux-submit-truthfulness-and-telegram-send-reliability.md](features/stability/2026-04-12-tmux-submit-truthfulness-and-telegram-send-reliability.md) | 2026-04-13 | The latest fix reduced traced failures, but submit is still not fully stable; remaining work is deeper Telegram audit plus multiline, long-prompt, and wider pane-confirmation validation. |

## Planned

| Status | Priority | Feature | Task | Main Doc | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Ready | P0 | runners | common CLI launch coverage and validation | [2026-04-13-common-cli-launch-coverage-and-validation.md](features/runners/2026-04-13-common-cli-launch-coverage-and-validation.md) | 2026-04-13 | Treat Claude, Codex, and Gemini as the first launch trio, with Gemini now wired through runner readiness and auth gating but still needing authenticated route-level launch evidence. |
| Ready | P0 | channels | chat-first streaming and transcript request commands | [2026-04-04-chat-first-streaming-and-transcript-request-commands.md](features/channels/2026-04-04-chat-first-streaming-and-transcript-request-commands.md) | 2026-04-04 | Make meaningful-only streaming the default Slack interaction model and support full session visibility only through explicit transcript request commands. |
| Planned | P1 | configuration | customer-support bot type and safe surface defaults | [2026-04-14-customer-support-bot-type-and-safe-surface-defaults.md](features/configuration/2026-04-14-customer-support-bot-type-and-safe-surface-defaults.md) | 2026-04-14 | Add a dedicated `customer-support` first-run type with safer surface defaults such as transcript visibility disabled unless the operator opts in. |
| Planned | P1 | channels | shared-surface pairing guidance for unpaired users | [2026-04-14-shared-surface-pairing-guidance-for-unpaired-users.md](features/channels/2026-04-14-shared-surface-pairing-guidance-for-unpaired-users.md) | 2026-04-14 | Reply with DM-first pairing guidance when an unpaired user mentions the bot in a Slack channel or Telegram group instead of failing silently. |
| Planned | P1 | configuration | start raw token warnings and runtime restart UX | [2026-04-14-start-raw-token-warnings-and-runtime-restart-ux.md](features/configuration/2026-04-14-start-raw-token-warnings-and-runtime-restart-ux.md) | 2026-04-14 | Review duplicate Slack literal-token warnings, clarify whether the warning is justified, and reduce restart friction when raw token input is used against a running runtime. |
| Ready | P1 | channels | prompt templates and overrides | [2026-04-13-prompt-templates-and-overrides.md](features/channels/2026-04-13-prompt-templates-and-overrides.md) | 2026-04-14 | Replace hardcoded user-message, steering, and loop prompt text with editable default templates plus per-agent overrides and clear runtime source reporting; include explicit review of queue and loop template wording. |
| Ready | P1 | channels | structured channel rendering and native surface capabilities | [2026-04-14-structured-channel-rendering-and-native-surface-capabilities.md](features/channels/2026-04-14-structured-channel-rendering-and-native-surface-capabilities.md) | 2026-04-14 | Add Slack Block Kit plus fallback text, Telegram safe HTML plus plain-text retry, preview-edit streaming, and explicit channel-native reply capabilities. |
| Planned | P1 | cross-cutting | architecture boundary clarification for surfaces, agents, and runners | [2026-04-13-architecture-boundary-clarification-for-surfaces-agents-and-runners.md](2026-04-13-architecture-boundary-clarification-for-surfaces-agents-and-runners.md) | 2026-04-13 | Clarify command lifecycle, permission ownership across control or channels or configuration, follow-up ownership split, and canonical session continuity state across the five-system architecture. |
| Planned | P1 | configuration | multilingual user guide and app language | [2026-04-13-multilingual-user-guide-and-app-language.md](features/configuration/2026-04-13-multilingual-user-guide-and-app-language.md) | 2026-04-13 | Add `--lang vi|zh|ko|en`, localize clisbot-owned startup or help or status surfaces, and create multilingual user-guide entry points so the product reaches non-English-first users with less friction. |
| Planned | P0 | channels | Telegram capture-pane settlement stall | [2026-04-12-telegram-capture-pane-settlement-stall.md](features/channels/2026-04-12-telegram-capture-pane-settlement-stall.md) | 2026-04-12 | Investigate reports that Telegram topic routes switched to `capture-pane` may only show typing and then never deliver a visible reply. |
| Planned | P0 | channels | thread-scoped active-run isolation | [2026-04-12-thread-scoped-active-run-isolation.md](features/channels/2026-04-12-thread-scoped-active-run-isolation.md) | 2026-04-12 | Investigate reports that one thread can wrongly see `This session already has an active run` while another thread owns the live run. |
| Planned | P0 | runners | AI CLI structured streaming and interrupt evaluation | [2026-04-05-ai-cli-structured-streaming-and-interrupt-evaluation.md](features/runners/2026-04-05-ai-cli-structured-streaming-and-interrupt-evaluation.md) | 2026-04-05 | Check whether native JSON output or JSON streaming, returned session ids, and ACP can improve UX versus pane scraping without losing tmux-style immediate steering and interrupt control. |
| Planned | P0 | agents | conversation follow-up policy and runtime control api | [2026-04-05-conversation-follow-up-policy-and-runtime-control-api.md](features/agents/2026-04-05-conversation-follow-up-policy-and-runtime-control-api.md) | 2026-04-05 | Add configurable follow-up TTL, mention-only or paused follow-up modes, and an agent-callable runtime control API so Codex or Claude can change conversation behavior on request. |
| Planned | P0 | stability | tmux session drift detection and guardrails | [2026-04-10-tmux-session-drift-detection-and-guardrails.md](features/stability/2026-04-10-tmux-session-drift-detection-and-guardrails.md) | 2026-04-10 | Detect and surface when a reused Slack or Telegram session has been altered by direct tmux pane input outside clisbot’s routed channel path. |
| Planned | P1 | stability | tmux submit state model and input path separation | [2026-04-13-tmux-submit-state-model-and-input-path-separation.md](features/stability/2026-04-13-tmux-submit-state-model-and-input-path-separation.md) | 2026-04-13 | Follow the urgent submit-truthfulness fix by separating idle prompt submit, active steering submit, and handshake submits, then define stronger confirmation signals for multiline and longer prompt cases. |
| Planned | P1 | channels | Vietnam channel launch package | [2026-04-13-vietnam-channel-launch-package.md](features/channels/2026-04-13-vietnam-channel-launch-package.md) | 2026-04-13 | Make the Vietnam launch package explicit by adding Zalo Official Account and Zalo Personal on top of the same Claude, Codex, and Gemini launch trio. |
| Planned | P1 | agents | native slash command compatibility and overrides | [2026-04-13-native-slash-command-compatibility-and-overrides.md](features/agents/2026-04-13-native-slash-command-compatibility-and-overrides.md) | 2026-04-13 | Decide whether broader launch needs stronger native CLI slash-command compatibility, conflict handling, override surfaces, and prefix customization beyond the current pass-through fallback. |
| Planned | P1 | agents | separate active-run persistence from session continuity | [2026-04-08-observer-based-session-attach-detach-and-watch.md](2026-04-08-observer-based-session-attach-detach-and-watch.md) | 2026-04-13 | Runtime active-run state still lives in the session continuity record; split it into a dedicated supervision model with explicit restart or crash recovery semantics so tmux continuity and chat-level run ownership cannot drift apart. |
| Planned | P1 | channels | durable observer subscription policy for active runs | [2026-04-08-observer-based-session-attach-detach-and-watch.md](2026-04-08-observer-based-session-attach-detach-and-watch.md) | 2026-04-08 | Decide whether attach or watch observers should survive process restart or stay intentionally ephemeral, then implement and document that rule explicitly. |
| Planned | P1 | channels | DM-first pairing onboarding | [2026-04-10-dm-first-pairing-onboarding.md](features/channels/2026-04-10-dm-first-pairing-onboarding.md) | 2026-04-10 | Onboard new Slack and Telegram users through direct messages first so they see the pairing approval command earlier and reach a first successful conversation faster. |
| Planned | P1 | agents | openclaw session compatibility expansion | [2026-04-04-openclaw-session-compatibility-expansion.md](features/agents/2026-04-04-openclaw-session-compatibility-expansion.md) | 2026-04-04 | Add bindings, reset policy, and richer session metadata so OpenClaw users can transfer configuration and mental models with less friction. |
| Planned | P1 | runners | secondary CLI expansion prioritization | [2026-04-13-secondary-cli-expansion-prioritization.md](features/runners/2026-04-13-secondary-cli-expansion-prioritization.md) | 2026-04-13 | After the launch trio is solid, rank Cursor, Amp, OpenCode, Qwen, Kilo, Minimax, and other follow-up CLIs by real demand plus compatibility cost instead of intuition alone. |
| Planned | P1 | control | operator control surface and debuggability | [2026-04-04-operator-control-surface-and-debuggability.md](features/control/2026-04-04-operator-control-surface-and-debuggability.md) | 2026-04-04 | Turn inspect, attach, restart, stop, and health actions into a first-class control system. |
| Planned | P1 | configuration | configuration control-plane expansion | [2026-04-04-configuration-control-plane-expansion.md](features/configuration/2026-04-04-configuration-control-plane-expansion.md) | 2026-04-04 | Expand the local config so it truthfully expresses channels, Agents, runners, control, and policy. |
| Planned | P1 | channels | post-MVP channel expansion wave | [2026-04-13-post-mvp-channel-expansion-wave.md](features/channels/2026-04-13-post-mvp-channel-expansion-wave.md) | 2026-04-13 | After Slack, Telegram, and the Vietnam Zalo package are settled, rank the next channel wave across Discord, WhatsApp, Google Workspace, and Microsoft Teams. |
| Planned | P2 | agents | multi-surface bash command addressing | [2026-04-04-multi-surface-bash-command-addressing.md](features/agents/2026-04-04-multi-surface-bash-command-addressing.md) | 2026-04-04 | Later support explicit shell targeting such as `!1:` or `!bash:` while keeping one reusable default shell per agent session today. |
| Planned | P2 | channels | api channel MVP | [2026-04-04-api-channel-mvp.md](features/channels/2026-04-04-api-channel-mvp.md) | 2026-04-04 | Add the OpenAI-compatible API surface as a channel rather than as a separate product system. |
| Planned | P2 | runtime-benchmarks | bun go rust benchmark harness | [2026-04-04-bun-go-rust-benchmark-harness.md](features/runtime-benchmarks/2026-04-04-bun-go-rust-benchmark-harness.md) | 2026-04-04 | Build the benchmark and soak-test layer for the later multi-language comparison. |

## Blocked

| Status | Priority | Feature | Task | Main Doc | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## Done

| Status | Priority | Feature | Task | Main Doc | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Done | P0 | cross-cutting | OpenClaw session and context analysis | [2026-04-04-openclaw-session-context-analysis.md](2026-04-04-openclaw-session-context-analysis.md) | 2026-04-04 | Captured the initial model for OpenClaw session state, workspace memory, transcript boundaries, and the main privacy questions `clisbot` still needs to answer. |
| Done | P0 | stability | detached runtime stop zombie truthfulness | [2026-04-13-detached-runtime-stop-zombie-truthfulness.md](features/stability/2026-04-13-detached-runtime-stop-zombie-truthfulness.md) | 2026-04-13 | `clisbot stop` now treats zombie or defunct detached runtime pids as exited, so stop or status no longer time out or misreport a runtime that is already down. |
| Done | P0 | stability | graceful stop clears active run state | [2026-04-13-graceful-stop-clears-active-run-state.md](features/stability/2026-04-13-graceful-stop-clears-active-run-state.md) | 2026-04-13 | Graceful runtime shutdown now marks persisted active runs back to `idle`, so `clisbot status` no longer shows stale active work after a normal stop. |
| Done | P0 | channels | processing indicator lifecycle and active-run truthfulness | [2026-04-14-processing-indicator-lifecycle-and-active-run-truthfulness.md](features/channels/2026-04-14-processing-indicator-lifecycle-and-active-run-truthfulness.md) | 2026-04-14 | Slack and Telegram indicators now wait on real active-run settlement or detach, so steer paths no longer clear typing or processing feedback too early. |
| Done | P1 | channels | transcript visibility and verbose levels | [2026-04-14-transcript-visibility-and-verbose-levels.md](features/channels/2026-04-14-transcript-visibility-and-verbose-levels.md) | 2026-04-14 | `/transcript` now follows route `verbose` with `minimal` as the default, while `/bash` stays behind `privilegeCommands`. |
| Done | P0 | stability | Claude tmux submit readiness and paste settlement | [2026-04-13-claude-tmux-submit-readiness-and-paste-settlement.md](features/stability/2026-04-13-claude-tmux-submit-readiness-and-paste-settlement.md) | 2026-04-13 | Fixed the traced Claude first-turn failures by recognizing the current trust prompt shape, waiting for multiline paste settlement before `Enter`, and revalidating on live Slack. |
| Done | P0 | cross-cutting | documentation system bootstrap | [2026-04-04-documentation-system-bootstrap.md](2026-04-04-documentation-system-bootstrap.md) | 2026-04-04 | Added the initial docs, architecture, features, tasks, and lessons scaffold, then refactored them toward the truthful system model. |
| Done | P0 | cross-cutting | clisbot product rename | [2026-04-10-clisbot-product-rename.md](2026-04-10-clisbot-product-rename.md) | 2026-04-10 | Directly renamed the product, CLI, package, runtime paths, config filename, env vars, docs, and GitHub repo from `muxbot` to `clisbot`, with `clis` as the short alias. |
| Done | P0 | cross-cutting | observer-based session attach, detach, and watch | [2026-04-08-observer-based-session-attach-detach-and-watch.md](2026-04-08-observer-based-session-attach-detach-and-watch.md) | 2026-04-11 | Active-run observers now support live, passive-final, and poll delivery with transport-failure containment so Slack or Telegram delivery faults do not terminate runner supervision. |
| Done | P0 | configuration | privilege command route gating | [2026-04-07-sensitive-command-route-gating.md](features/configuration/2026-04-07-sensitive-command-route-gating.md) | 2026-04-07 | Transcript and bash commands now use `privilegeCommands`, stay disabled by default, and can be limited to explicit route and user-id allowlists. |
| Done | P0 | configuration | OpenClaw-style agent CLI and bootstrap | [2026-04-07-openclaw-style-agent-cli-and-bootstrap.md](features/configuration/2026-04-07-openclaw-style-agent-cli-and-bootstrap.md) | 2026-04-07 | Added OpenClaw-like `agents` control commands, explicit tool-aware agent creation, bootstrap seeding, bindings, and richer `start` or `status` summaries. |
| Done | P0 | configuration | start first-run bootstrap and token gating | [2026-04-07-start-first-run-bootstrap-and-token-gating.md](features/configuration/2026-04-07-start-first-run-bootstrap-and-token-gating.md) | 2026-04-07 | `start` now requires default Slack or Telegram tokens, bootstraps only available channels, and auto-creates the first default agent only when the CLI choice is unambiguous. |
| Done | P0 | configuration | channel fast start and credential persistence | [2026-04-13-telegram-fast-start-and-credential-persistence.md](features/configuration/2026-04-13-telegram-fast-start-and-credential-persistence.md) | 2026-04-13 | Explicit Slack and Telegram bootstrap now support inline or env-backed input, canonical credential files, mem or tokenFile source states, and persistence flows without storing raw secrets in config. |
| Done | P1 | configuration | bot type first-run flag and quick-start refresh | [2026-04-13-bot-type-first-run-flag-and-quick-start-refresh.md](features/configuration/2026-04-13-bot-type-first-run-flag-and-quick-start-refresh.md) | 2026-04-13 | Public first-run docs and help now use `--bot-type personal|team`, keep `--bootstrap` as a compatibility alias, and lead onboarding with Telegram-first quick start plus `--persist`. |

## Update Rules

- Add a task to `Active` only when someone is actually working it.
- If work pauses mid-batch, update the active row note with the real stop state.
- Keep `Planned` prioritized from most important to least important.
- Move blocked work to `Blocked` instead of hiding it in notes.
- Move finished work to `Done`; do not delete it.
- Keep notes to one short sentence.
