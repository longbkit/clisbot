# Clisbot T3Claw Fusion — Research Audit

Audit date: 2026-08-23. Subject: the sibling exploration `clisbot-t3claw-fusion` (a fork of T3 Code `main`), audited from its working tree at branch `clisbot-t3claw-fusion`, HEAD `70023dc55`. This doc is reference material for the PaseoClaw Fusion direction (see [../overview/product-vision.md](../overview/product-vision.md)); it carries forward design and experience, not code.

## What T3Claw Fusion is

An exploratory next-generation Clisbot that bridges external work channels (Slack, Telegram) into T3 Code agent threads. The bridge is a three-layer architecture in one process:

- **Origin (vendored):** `packages/clisbot-openclaw-origin/` — a pinned, checksum-locked copy of OpenClaw's Slack/Telegram extensions plus pure markdown/chunking libraries. Never edited by hand; re-synced via `scripts/sync-openclaw-origin.ts` with a CI audit gate.
- **SDK seam:** `packages/clisbot-openclaw-sdk/` — one module per OpenClaw plugin-SDK subpath (~170 of 332 for Slack+Telegram), each either re-exporting pure code, binding to a host service, or throwing a typed `UnsupportedChannelCapability`. `surface-matrix.yml` is the CI-enforced map of what works.
- **Host (Clisbot-owned):** `packages/clisbot-channel-host/` — `ChannelCoordinator` (the only thing that may start a T3 turn), `ChannelPolicy` (single authorization service), `ChannelStore` (Clisbot-owned SQLite: `thread_binding`, `delivery_ledger` — records the outbound op **before** posting, deduped by `sha256(bindingId|idempotencyKey)`, so a crash between record and delivery leaves a `pending` row for recovery instead of a double post (re-verified 2026-08-24, `HostRelay.deliverOnce`); `ingress_queue`, conversation directory), `ChannelOutboundRelay`, and `ChannelToolBroker` (runs agent-invoked channel tools; cannot start turns).
- **T3 glue:** `apps/server/src/clisbotChannels/` — a small guarded mount. Channels reuse T3's own `dispatch`/`enqueueCommand` (send) and `subscribeThreadStream` (receive) instead of opening a new WebSocket surface, so web/mobile clients render the channel conversation with no new frontend code.

The channel-bridge pattern validated here — isolated channel host, two independent feature kill switches, policy-based synchronization, channel-native approval actions — is the reference pattern to re-derive against Paseo's agent sessions and timelines.

## Kill switches and synchronization

Two independent kill switches, both required for the host to run; flag off = byte-equivalent to upstream T3:

- env flag `T3CODE_FEATURE_CLISBOT_CHANNELS` (`apps/server/src/cli/config.ts`, default false)
- `settings.json > channels.enabled` (`packages/contracts/src/settings.ts`)

Synchronization is policy-based per route: `sync.inbound.enabled` and `sync.outbound.{finalAnswers, progress, toolCalls, threadLink}`, with bot-account defaults and route overrides. Defaults (re-verified 2026-08-24 in `clisbot-channel-host/routing.ts`): `finalAnswers: true`, `progress: false`, `toolCalls: false`, `threadLink: "full"` (three-valued `full | final-only | none`). Outbound caps: `MAX_PROGRESS_UPDATES`, `MAX_PROGRESS_TEXT_CHARS`, `MAX_TOOL_DETAIL_CHARS`, `FIRST_PROGRESS_CHARS`, `PROGRESS_STEP_CHARS` (`relay.ts`), plus a bounded relay queue. Config is file-watched, so edits apply live.

## Approval model

Provider tool requests pause as `approval-required`; the relay renders a Slack Block Kit card or Telegram inline keyboard. The click routes to `ChannelPolicy.canApprove` before `thread.approval.respond` is dispatched. An arg "tap" on `ProviderService.streamEvents` classifies exact commands/paths (e.g. `rm -rf` → `approval.command.destructive`). Authorization is enforced twice: at coordinator entry (`authorizeInteract`/`authorizeAction`) and at reactor exit (`canApprove`).

## Current state

Delivery steps 2–10 have landed (git log): OpenClaw vendoring tooling, SDK facade + `ClisbotPluginRuntime`, wiring center + e2e fake channel, SQLite store + unified native-session authorization, MCP channel toolkit, Slack Socket Mode vertical, Telegram polling vertical, native approval rule enforcement, operations workflow. Landing record (re-verified 2026-08-24): both channel verticals landed 2026-08-22 (Slack Socket Mode `345b43274` 10:09, Telegram polling `da67049f5` 11:02) after ~1–2 weeks on the plan/bridge mechanism; the ~950-file source-mode compatibility sweep (`a345b3323` "fix(sdk): complete source-mode channel compatibility") landed the same evening, and phase-1 acceptance closed 2026-08-23. Implemented and test-backed: Slack + Telegram bridge, RBAC via `ChannelPolicy`, native approval actions, restart/resume idempotency via the delivery ledger, `Settings → Channels` panel, `clisbot` CLI surface.

Acceptance status: `docs/operations/clisbot-channels-acceptance.md` defines P0/P1/P2 live-E2E cases; sign-off requires **all P0 green**. The most recent commits at HEAD are still closing live-acceptance gaps, so treat P0 completion as in progress, not certified.

Deferred to P2 (verified boundaries): Slack HTTP/webhook receiver, Telegram webhooks, Google Chat/Zalo, native multi-agent chat rooms, presence, loops/queues/tasks, first-class channel agent tools.

## Permission model (what a hub-style trigger system lacks)

- **Channel-level "all users may trigger":** `defaultAccess: "owner-admin" | "all-users"` per bot account (`packages/contracts/src/settings.ts`), plus per-route `policy.assignments` with role union across app/bot/channel scopes, deny-by-default. The fusion model is per-principal RBAC with a privilege catalog (`bot.interact`, `tool.*`, `approval.*`, `channel.tool.<name>`), not sender allowlists.
- **Thread → persistent agent session:** `thread_binding` (external thread key ↔ one T3 thread, `initiator_principal_ref` set once). Follow-ups in the bound thread resume the same thread across restarts (acceptance cases P0-S02/P0-R01).
- **Many channels, multiple accounts:** `accounts[]` supports multiple bot accounts per channel (e.g. two Slack workspaces), each with its own `secretRef`, defaults, and bot-scope assignments; routes fan out per conversation.
- **Granular permissions:** who may create conversations (`bot.interact`; an `approver` role can approve without it); who may approve which tool class (`approval.file` / `approval.config` / `approval.command` / `approval.command.destructive` / `approval.channel`), with first-match rules, resource tags (config-file globs), `initiatorOnly`, and per-route `t3Mode` (strict/hybrid/balanced; default `strict`). The privilege algebra itself: roles are named privilege sets with no rank, `extends` composes roles, `*` and `<family>.*` wildcard, `!x` subtracts within the same role's expansion, unknown role names contribute nothing (fail-closed) — all in `privileges.ts`, recomputed fresh per decision so a config edit takes effect on the next message.

This is the concept the Paseo-based fusion needs to match or exceed: a trigger system that only carries a token-level identity cannot express any of it.

## Gaps — why a Paseo-based fusion supersedes the foundation

1. **Foreign foundation, pinned forever.** The bridge rides a vendored OpenClaw slice (checksums, sync script, audit gate, surface matrix, golden traces) *and* a T3 Code fork. Every T3/OpenClaw bump is a manual re-sync exercise.
2. **T3's coarse primitives force bolt-on layers.** Binary-only approval answers (no param/scope editing), no per-tool modes, no per-resource ACL upstream. The fusion must tap `streamEvents` args in memory and wrap the WS handler layer (`RpcResourceAcl`) to approximate what a first-party foundation could give natively.
3. **Phase 1 is two channels, no webhooks.** Socket Mode + polling only; HTTP receiver, Google Chat/Zalo, and a channel marketplace are P2-deferred.
4. **No native collaboration surface.** Multi-human/multi-agent rooms, presence, and human-to-human messages are explicitly deferred; the conversation-directory module is only a seed.
5. **Ops/config burden.** Everything is hand-edited `settings.json` with a custom schema version/migration path; the web panel was read-only at Phase 1 sign-off (editable config just landed at HEAD). No loops/queues/task management.
6. **Validation not closed.** Acceptance sign-off requires all P0 live-E2E rows green; at HEAD the last commits are still closing live gaps.

A Paseo-based fusion can drop the vendored-origin/SDK/seam machinery, build channel hosting on a first-party runtime with native per-thread approval and resource ACL, and keep the RBAC/bridge concepts validated here without the two-foundation pin-and-rewire cost.

## Reference docs

In `clisbot-t3claw-fusion/`:

- `docs/overview/product-vision.md` — product ambition, principles, nine capability directions.
- `docs/internals/clisbot-channels.md` — the full channel-bridge design: layers, SDK surface, MCP tools, SQLite data model, RBAC/privilege catalog, approval rules, Slack/Telegram UX.
- `docs/operations/clisbot-channels.md` — operating runbook: kill switches, account setup, secrets, state locations, logs, restart/resume, origin-update runbook.
- `docs/operations/clisbot-channels-acceptance.md` — Phase 1 acceptance contract (P0/P1/P2 live-E2E cases, evidence bar, sign-off).
- `docs/internals/clisbot-commands.md` — CLI/agent-facade concepts (route `agentId` → project + provider + model).
- `docs/internals/environment-auth.md` — T3's pre-existing OAuth scopes the privilege catalog reuses.
- `.plans/clisbot-openclaw-channel-bridge.md` — delivery plan (the canonical "why" and step order).

In the base `clisbot/` repo:

- `docs/features/channels/README.md` — channel surface model: DM access modes, allowlist posture, thread/session-key follow-up.
- `docs/features/auth/README.md` — surface admission rules and owner/admin bypass semantics.
- `docs/features/channels/message-actions-and-channel-accounts.md` — multi-bot routing and provider-owned bot maps.
- `docs/research/channels/2026-08-12-t3code-clisbot-unified-product-options.md` — research that motivated a unified T3+Clisbot runtime.
