# Flexible Runner Backend Architecture: tmux, ACP, And CLI JSON

## Summary

Turn the runner layer into a real multi-backend system so one agent can run through the best available execution path per CLI tool:

- `acp`: structured Agent Client Protocol integration for the dozens of ACP-capable CLI agents on the market
- `tmux`: the universal fallback for non-ACP tools, and the deliberate cost-saving path for Claude, because programmatic Claude usage is slated for separate metered billing while interactive CLI usage stays on subscription
- `cli-json`: optional structured path for tools that expose JSON streaming output but no ACP support

This task covers the architecture review (problems and gaps), the target design, and the phased implementation plan.

## Status

In progress (2026-07-02)

- Phase 0 shipped: code-level `RunnerBackend` contract + `RunEvent` model in
  `src/runners/contract/`; tmux mechanics refactored into
  `src/runners/tmux/` as the first implementation; `RunnerService` is a thin
  dispatcher; `SessionService` no longer imports tmux; oversized
  `runner-service.ts` and `session-handshake.ts` split under the limits.
- Phase 1 shipped (code + regression): `src/runners/acp/` backend on pinned
  `@agentclientprotocol/sdk@1.1.0` with adapter-per-session, structured
  events, `session/load` resume with truthful fresh-start fallback,
  first-class cancel, policy-resolved permissions
  (`runner.acp.permissionPolicy`), ACP `authenticate` support
  (`runner.acp.authMethodId`; codex-acp advertises `chat-gpt` for
  subscription auth and `api-key`), capability-gated steer degradation, and
  runtime-shutdown adapter cleanup. Config: `runner.backend: tmux | acp` per
  agent plus `env`. Regression suite drives a scripted raw-ndjson fake ACP
  agent (`test/fixtures/fake-acp-agent.ts`).
- Remaining before Phase 1 exit: live validation with the real
  `@agentclientprotocol/codex-acp` adapter on the configured shared test
  surfaces (operator-gated, high blast radius).
- Deferred: the SessionService-owned continuity API cleanup (backends still
  record ids via `SessionMapping`), Phase 2 structured UX, Phase 3 operator
  surfaces for pane-less backends, Phase 4 breadth, Phase 5 docs/defaults.

## Related Docs

- [Runtime Architecture](../architecture/runtime-architecture.md)
- [Architecture Overview](../architecture/architecture-overview.md)
- [Runners Feature](../features/runners/README.md)
- [ACP Operational Effort And Codex Decision Inputs (2026-07-02)](../research/runners/2026-07-02-acp-operational-effort-and-codex-decision.md)
- [ACP Codex And Claude Support Mechanics (2026-04-05)](../research/runners/2026-04-05-acp-codex-and-claude-support-mechanics.md)
- Absorbed evaluation scope: [AI CLI Structured Streaming And Interrupt Evaluation](features/runners/2026-04-05-ai-cli-structured-streaming-and-interrupt-evaluation.md)
- Related refactor baseline: [Runner Interface Standardization And tmux Runner Hardening](features/runners/2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
- Related follow-up ranking: [Secondary CLI Expansion Prioritization](features/runners/2026-04-13-secondary-cli-expansion-prioritization.md)

## Why Now

- The ACP ecosystem matured: v1 protocol, a live agent registry, ~35 agents including Codex, Gemini CLI, Cursor, Copilot CLI, Goose, OpenCode, Kimi, and Qwen. One ACP client implementation replaces per-tool tmux quirk engineering for all of them.
- Codex integration moved onto the official Codex App Server via `@agentclientprotocol/codex-acp`, with backward compatibility owned by OpenAI and adapter maintenance pooled upstream. The per-release TUI churn clisbot currently absorbs (update menus, hook review, trust prompts) does not exist on that path.
- Anthropic's paused-but-announced billing split makes the dual-backend shape durable: Claude stays cheapest through the interactive tmux path, so ACP cannot simply replace tmux.

See the 2026-07-02 research doc for the full effort model and sources.

## Current State Review: Problems

- **P1 - The runner contract exists only in docs.** `docs/architecture/runtime-architecture.md` defines start/stop/submit/snapshot/stream/lifecycle/errors, but there is no code-level interface. `RunnerService` (`src/agents/runtime/runner-service.ts`, ~1330 lines, over the 700-line hard limit) is a concrete tmux-coupled orchestrator, not an implementation of a contract a second backend could also implement.
- **P2 - Backend quirks are absorbed by scraping, and scraping is the defect engine.** `src/runners/tmux/session-handshake.ts` (~990 lines, over the hard limit) encodes per-CLI startup menus, trust prompts, paste settlement, and submit-truthfulness heuristics. Multiple open stability tasks (Codex update menu, hooks review gating, submit truthfulness, capture-pane settlement stalls, interactive-command stalls) are all downstream of pane scraping.
- **P3 - CLI-family branching leaks across systems.** `codex`/`claude`/`gemini` string logic appears in ~24 files spanning `config`, `control`, `channels`, and `agents` (presets, schema, transcript normalization, resume rejection, CLI help, plugin prompts). The architecture rule says backend quirks belong inside runners; today they do not.
- **P4 - There is no normalized run-event model.** Channels render from pane snapshots plus transcript normalization. Structured signals that ACP (and CLI JSON modes) provide natively - message chunks, tool calls, permission requests, plans, token usage - have no internal representation to map onto.
- **P5 - Configuration has no backend dimension.** An agent's runner is a command string plus an implied CLI family. There is no `backend: tmux | acp | cli-json` concept, no adapter launch/env/pin config, and no per-backend capability expectations, even though the configuration rule says config must support future runners without changing agents-layer semantics.
- **P6 - Control surfaces are tmux-shaped.** `runner list/inspect/watch`, `/attach`, and pane-based debugging assume a pane exists. ACP sessions have no pane; they need an event-log equivalent, or operators lose debuggability on the new path.
- **P7 - Capability semantics are implicit.** Steering, interrupt, resume, attach, and native slash-command pass-through are assumed universal because tmux supports them. ACP has first-class cancel but no mid-turn steering; per-backend capability declaration and graceful degradation do not exist yet.
- **P8 - Session continuity mechanics are scrape-based.** Session-id capture parses CLI output. ACP provides `sessionId` and `session/load` explicitly; the runner-provided id mechanics (`accept explicit id / capture native id / resume stored id`) need a per-backend implementation rather than the current tmux-only one.
- **P9 - Known mixed-ownership debt compounds the cost.** `RunnerService` still carries some `SessionService`-owned continuity work (documented gap in runtime-architecture.md). Adding a second backend on top of a mixed-owner orchestrator would double the blur instead of forcing the cleanup.

## Gap Analysis

| Target capability | Current state | Gap |
| --- | --- | --- |
| Code-level runner contract with multiple implementations | Doc-only contract, single concrete tmux path | Extract interface; make tmux the first implementation |
| ACP client runtime (sessions, streaming, permissions, cancel) | None | New `src/runners/acp/` backend |
| Normalized run-event stream for channels | Pane snapshot + transcript normalization only | Define internal event model; adapt both backends onto it |
| Per-agent backend selection in config | Command string + family preset | Schema: `backend`, adapter command/env/version pin, capability overrides |
| Capability-aware behavior (steer, attach, interrupt) | Implicit tmux assumptions | Declared capability matrix + degradation rules per backend |
| Operator debugging for non-pane backends | Pane-based `watch`/`inspect` only | Event-log inspection surface for ACP sessions |
| Backend-agnostic session-id mechanics | Scrape-based capture in tmux code | Per-backend id strategy behind `SessionService`-owned mapping |
| Quirk containment inside runners | Family branching in ~24 files | Move family logic behind backend presets in the runners system |

## Target Architecture

The six-system split does not change. Everything lands inside the existing `runners` boundary plus small, explicit seams in `configuration`, `channels`, and `control`.

```text
agents (SessionService owns sessionKey -> sessionId continuity, unchanged)
  -> RunnerService (thin backend-owned orchestrator over one contract)
      -> RunnerBackend contract (code-level):
         start / stop / submitInput / captureSnapshot / streamEvents /
         lifecycle / errors / sessionIdMechanics / capabilities
         |-- tmux backend      (current mechanics, refactored under contract)
         |-- acp backend       (ACP client: adapter process per session)
         `-- cli-json backend  (optional later: spawn CLI in JSON stream mode)
```

Design rules:

- one internal `RunEvent` model (message chunk, tool activity, permission request, plan, usage, lifecycle, error); channels render events, never backend artifacts; the tmux backend emits coarse snapshot-diff events onto the same model
- each backend declares capabilities (`steer`, `interrupt`, `resume`, `attachView`, `permissionRequests`, `structuredEvents`, `nativeSlashCommands`); channel and control features degrade by declared capability instead of by CLI-family string checks
- steering on non-steer backends degrades to explicit alternatives the user already knows: `/queue`, or cancel-plus-reprompt, with truthful messaging
- permission requests from ACP route to the chat surface as interactive approvals under existing auth/role rules, with per-agent auto-approve policy as config
- backend selection is per agent in config; the same agent definition can switch backend without changing routes, sessions, or workspace semantics
- ACP adapter versions are pinned; upgrades follow a bump-plus-smoke ritual documented in the runners feature docs

Cost-shape rule (product-level, documented for operators):

- Codex: ACP recommended (ChatGPT subscription auth supported; no cost penalty)
- Claude: tmux default for subscription-cost users; ACP available for users who accept Agent SDK metering when Anthropic's split takes effect
- Gemini and other native-ACP tools: ACP preferred; tmux fallback
- non-ACP tools: tmux; consider `cli-json` only when a tool has JSON streaming but no ACP

## Implementation Plan

### Phase 0 - Contract extraction and ownership cleanup (no behavior change)

- define the `RunnerBackend` interface and `RunEvent` model in `src/runners/`
- refactor tmux mechanics to implement the contract; split `runner-service.ts` and `session-handshake.ts` below the 500-line target as part of the move
- finish the documented `SessionService`/`RunnerService` continuity-ownership cleanup so continuity decisions live only in `SessionService`
- move CLI-family presets and quirk knowledge behind runner-owned presets; delete family string checks outside `runners`/`config` where feasible
- exit: `bun run check` green; tmux behavior byte-identical on the real-CLI smoke surface; both oversized files split

### Phase 1 - ACP backend MVP (one agent, one channel, flagged)

- implement `src/runners/acp/` with the official TypeScript ACP library: spawn adapter, initialize, `session/new`, `session/prompt`, consume `session/update`, `session/cancel`
- first target: Codex via pinned `@agentclientprotocol/codex-acp` (subscription auth, richest event coverage); keep Gemini CLI native ACP as the second validation target
- map events onto `RunEvent`; permission requests auto-resolved from per-agent policy in this phase
- config: `backend: "acp"` per agent plus adapter command/env/pin; no route or session semantics change
- validate on the configured test surfaces only (`SLACK_TEST_CHANNEL`, Telegram test group/topics per repo guardrails)
- exit: routed chat conversation with streaming, cancel, and stored-session resume (`session/load`) on the test surfaces

### Phase 2 - Chat-native structured UX

- render tool activity, plans, and usage updates through the existing streaming/verbose framework (structured events replace transcript heuristics on ACP routes)
- route `session/request_permission` to the chat surface as an interactive approval gated by auth roles; keep auto-approve policy as config
- capability-aware command behavior: `/stop` maps to `session/cancel`; steer degrades to cancel-plus-reprompt or `/queue` with truthful messaging; native slash-command pass-through uses the adapter's advertised commands
- exit: documented UX parity table for tmux-vs-ACP on the same agent, validated live

### Phase 3 - Operator and control surfaces

- `runner list/inspect` covers ACP sessions (adapter pid, protocol state, last events); add an event-log `watch` equivalent for pane-less backends
- truthful `status`/health for adapter process failures, auth-needed states, and version pins
- `clisbot doctor`-style checks: adapter installed, version matches pin, agent binary auth state
- exit: an operator can debug a stuck ACP session end-to-end without reading source

### Phase 4 - Generalize breadth

- preset catalog for additional ACP agents (Gemini native, Goose, OpenCode, Cursor, Copilot CLI, Kimi, Qwen), each behind the same capability smoke matrix; rank rollout using the secondary-CLI prioritization task
- evaluate `cli-json` backend only if a demanded tool lacks ACP; it reuses the `RunEvent` model, so the marginal cost is one spawn/parse layer
- exit: at least three ACP agents pass the smoke matrix; onboarding checklist documented in the runners feature docs

### Phase 5 - Docs, defaults, and release

- update runners feature docs, feature tables, user guide (per-CLI guides gain a backend-selection section including the Claude cost note), and architecture docs (runner contract becomes code-truthful)
- decide per-CLI default backend and migration/compat behavior for existing configs (default stays tmux; ACP is opt-in until stability evidence supports flipping Codex)
- release notes and update guide entries

## Risks And Open Decisions

- **Steering gap**: ACP cannot match tmux mid-turn steering; decision needed on the default degradation (cancel-plus-reprompt vs queue) per backend. Mitigation: capability flags plus truthful chat messaging.
- **Adapter youth**: `@agentclientprotocol/codex-acp` is 1.0.x; pin exact versions, keep tmux fallback one config change away.
- **Claude billing uncertainty**: the Anthropic split is paused; revisit the Claude default if terms change in either direction.
- **Scope creep**: Phase 0 refactor touches the riskiest file in the repo; keep it strictly behavior-preserving and gated by the real-CLI smoke surface before any ACP code lands.
- **Process footprint**: one adapter process per active ACP session; ties into the existing global runner admission/backpressure task.
- **Decision point for the owner**: green-light Phase 0 + Phase 1 now (recommended), or wait for the Codex adapter to accumulate more releases. Waiting costs little on ACP but the Phase 0 cleanup pays off regardless of the ACP decision.

## Verification Plan

- Phase 0: full `bun run check` plus real-CLI smoke surface parity before/after
- Phases 1-2: live validation only on configured shared test surfaces; regression tests for the ACP session lifecycle (prompt, stream, cancel, resume, permission) with a scripted fake ACP agent in `test/`
- Phase 3: operator-flow validation via `status`/`logs`/`runner inspect` transcripts in the task doc
- Each phase updates this doc's status notes and the backlog row truthfully

## Done Criteria

- runner contract exists in code with tmux and ACP implementations, both under file-size limits
- one agent runs end-to-end over ACP on a real routed chat surface with streaming, cancel, resume, and permission handling
- capability degradation is truthful and documented; no CLI-family string checks outside runner-owned presets
- operator surfaces are truthful for pane-less backends
- docs (architecture, features, user guide) match shipped behavior
