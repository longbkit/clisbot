# ACP Operational Effort And Codex Decision Inputs

## Document Information

- **Created**: 2026-07-02
- **Purpose**: Give the go/no-go decision inputs for adopting ACP as a first-class runner backend, with a generic any-CLI effort model and a dedicated Codex deep dive
- **Status**: Research snapshot as of 2026-07-02; verify adapter versions before implementation

## Goal

Answer two operator questions with sources:

1. What is the real operational effort to run ACP-backed agents in clisbot, for any CLI tool in general?
2. For Codex specifically: how does the current ACP path work, what happens when Codex updates, how much maintenance and code-change complexity lands on clisbot, and is now the right time to invest?

This note extends [ACP Codex And Claude Support Mechanics (2026-04-05)](2026-04-05-acp-codex-and-claude-support-mechanics.md). The protocol facts there still hold; this note updates the ecosystem state and adds the effort model.

## What Changed Since The April Research

- The ACP Registry launched (2026-01-28) as a shared agent directory used by Zed and JetBrains IDEs.
- Codex ACP support moved from `zed-industries/codex-acp` (Rust, linked directly against `codex-core` crates) to `agentclientprotocol/codex-acp` (npm `@agentclientprotocol/codex-acp`), rebuilt on the official Codex App Server, with maintenance pooled across teams instead of Zed alone.
- OpenAI published the Codex App Server as the official, backward-compatible integration protocol powering every Codex surface (CLI, VS Code, web, desktop, JetBrains, Xcode).
- The agent side of the ACP ecosystem grew to roughly 35 listed agents, including Codex CLI, Claude Agent, Gemini CLI, Cursor, GitHub Copilot CLI (public preview), Goose, OpenCode, Cline, Augment, Qwen Code, Kimi CLI, Kiro, OpenHands, Factory Droid, Mistral Vibe, OpenClaw, and Hermes Agent.
- The client side grew beyond editors: Zed, JetBrains IDEs, Neovim plugins, Emacs, marimo, and Microsoft Intelligent Terminal (2026-06-02) all speak ACP. clisbot would join as a chat-surface ACP client.
- Anthropic announced, then paused, a billing split that moves programmatic Claude usage (Agent SDK, `claude -p`, third-party apps) off subscription limits onto a separate metered credit pool. This directly affects the Claude-over-ACP path because `claude-agent-acp` is built on the Claude Agent SDK.

## Ecosystem Snapshot (2026-07)

- Protocol: ACP v1, JSON-RPC over stdio. Core methods: `initialize`, `session/new`, `session/load`, `session/prompt`, `session/update`, `session/cancel`, `session/request_permission`, plus optional terminal methods, agent plan updates, and `usage_update` (token and cost reporting).
- Capabilities are negotiated at `initialize`, so a client can detect per-agent support for session loading, images, terminals, and prompt content types instead of guessing.
- Cancellation is first-class: `session/cancel` must settle the turn with a `cancelled` stop reason.
- There is still no mid-turn steering primitive. The only in-protocol steer path is cancel, then send a new `session/prompt`. This remains the biggest behavioral gap versus the tmux runner.
- Distribution is mature: adapters ship as npm packages and prebuilt binaries, and the registry gives one namespace for discovering agents.

## Generic Effort Model: ACP With Any CLI Tool

### Build once (the expensive part)

One ACP client runner inside `src/runners/acp/`, regardless of how many tools it later serves:

- process lifecycle: spawn the agent/adapter binary per session, own stdio JSON-RPC, restart policy, health surfacing
- session mapping: ACP `sessionId` becomes the runner-provided backend session id behind the existing `SessionService`-owned `sessionKey -> sessionId` continuity contract; `session/load` becomes the resume path where the agent advertises it
- event normalization: map `session/update` variants (message chunks, tool calls, plan, usage) into one internal run-event stream the channels layer can render
- permission handling: respond to `session/request_permission` from policy (auto-approve modes per agent auth config, or forward to the chat surface as an interactive approval)
- cancel and error mapping into the existing run supervision model

This is a real but bounded engineering effort: one new backend implementation behind the standard runner contract, using the official TypeScript ACP library. It is comparable in scope to one serious channel integration, and much of the cost is designing the normalized event stream, which also benefits the tmux path.

### Per-tool onboarding (the cheap part, by design)

Once the client exists, each additional ACP tool is mostly configuration plus validation:

- a preset: launch command (`npx @agentclientprotocol/codex-acp`, `gemini --experimental-acp`-style flags, or a registry entry), env vars, auth method
- a capability check at `initialize` (does it support `session/load`? images? terminals?)
- a smoke pass: prompt, streaming, cancel, resume, permission round-trip
- channel-facing polish: which native slash commands to pass through

Realistic estimate per additional tool: days, not weeks, unless the specific adapter is immature. This is the core ACP payoff: dozens of tools against one integration, versus today's model where each new CLI needs bespoke tmux handshake, prompt-detection, and quirk logic.

### Ongoing operational effort (generic)

- version pinning: pin adapter versions per release; bump on a normal dependency cadence and re-run the smoke matrix
- upstream dependency: adapter bugs and feature gaps are fixed upstream (registry-pooled maintainers), not in clisbot; clisbot files issues instead of writing pane-parsing workarounds
- protocol drift: ACP v1 evolves additively with capability flags; a conservative client that ignores unknown update types stays compatible
- process supervision: one extra child process per active ACP session (adapter), with logs on stderr instead of panes; `runner inspect`-style surfaces need an event-log view because there is no pane to attach to
- quality variance: adapter quality differs by tool; native implementations (Gemini CLI) are typically more truthful than thin community adapters

### What ACP does not remove

- tmux stays required for tools with no ACP support and for cost-sensitive Claude usage (below)
- mid-turn steering and `/nudge`-style control-key intervention have no ACP equivalent; capability-aware degradation is needed (steer becomes cancel-plus-reprompt or queue)
- auth still happens per tool (ChatGPT login, API keys, OAuth) and must be provisioned in the runtime environment exactly like today

## Codex Deep Dive

### How Codex-over-ACP works today

The current recommended stack is:

```text
clisbot (ACP client)
  -> @agentclientprotocol/codex-acp   (stdio ACP agent server, npm)
      -> Codex App Server             (official OpenAI harness protocol, JSON-RPC/JSONL over stdio)
          -> codex binary             (bundled @openai/codex dependency, or CODEX_PATH override)
```

Key facts:

- `@agentclientprotocol/codex-acp` (v1.0.x, actively released) starts the Codex App Server, translates ACP requests into Codex operations, and maps Codex events back to the client.
- The Codex App Server is OpenAI's own integration protocol: conversation primitives are Item, Turn, and Thread; approvals are server-initiated requests; OpenAI explicitly designs it to be backward compatible so older clients can safely talk to newer server versions. It powers all official Codex surfaces, so it is a load-bearing, first-party contract rather than a community reverse-engineering effort.
- The npm package bundles a compatible `@openai/codex` version; `CODEX_PATH` can point at a different installed Codex binary.
- Auth supports ChatGPT subscription login, API key, and custom gateways. Subscription auth means Codex-over-ACP has no cost penalty versus Codex-in-tmux.
- Feature coverage today: approvals and sandbox modes, model and reasoning-effort selection, client MCP servers, images, plan events, token usage, review flows, skills, and slash commands (`/status`, `/mcp`, `/skills`, `/review`, `/review-branch`, `/review-commit`, `/compact`, `/logout`).
- The predecessor (`zed-industries/codex-acp`, Rust) shipped 56 releases in about eight months because it linked Codex crates directly and had to chase every Codex release. That maintenance shape is exactly what the App Server rebuild removed, and maintenance is now pooled across the Zed and JetBrains teams under the `agentclientprotocol` org.

### What happens when Codex updates

Three layers can move, with different blast radii:

1. Codex binary / App Server: backward-compatible by OpenAI policy. An existing adapter keeps working against a newer Codex; brand-new Codex features simply do not surface until the adapter maps them. With the bundled-dependency model, clisbot controls exactly which Codex version runs, so an unexpected Codex release cannot break a pinned clisbot install at all.
2. Adapter (`@agentclientprotocol/codex-acp`): normal npm dependency churn. clisbot bumps a version, runs the smoke matrix, ships. No clisbot code change unless clisbot wants to render a newly exposed event type.
3. ACP contract: stable v1; changes are additive and capability-gated. clisbot code changes only when clisbot opts into new capabilities.

Contrast with the tmux path today, where a Codex release can change TUI text and menus and break prompt submission: the repo currently carries dedicated tasks for the Codex update menu, hooks-review startup gating, trust prompts, model-continuity warnings, and `CODEX_HOME` state contention, plus a 990-line `session-handshake.ts` absorbing those quirks. On the tmux path, clisbot absorbs Codex churn alone, in scrape logic; on the ACP path, OpenAI absorbs it in the App Server contract and pooled maintainers absorb it in the adapter.

### Maintenance effort and code-change complexity for clisbot

What clisbot would own for the Codex ACP preset, steady state:

- an adapter version pin and a bump-plus-smoke ritual per upgrade
- mapping of clisbot approval policy onto Codex approval and sandbox modes
- the pass-through list for Codex-native slash commands
- regression coverage for prompt, stream, cancel, resume, permission, and attachment flows

Expected code-change complexity per Codex release: usually zero; occasionally small mapping additions for new event types. This is structurally cheaper than the current per-release TUI-quirk work, and the historical evidence is that the parser-free path is where the whole ecosystem (OpenAI included) is converging.

### Codex-specific gaps and risks

- Steering: same ACP limitation; today's tmux `Esc`-plus-inject steering has no equivalent. Codex-over-ACP steer must become cancel-plus-reprompt.
- Operator visibility: no pane to `watch`; needs an event-log inspection surface instead.
- Adapter subset risk: if a Codex feature matters to clisbot before the adapter maps it, clisbot waits or contributes upstream (TypeScript, contributable).
- Transition risk: the `agentclientprotocol/codex-acp` package is young (1.0.x); pin exact versions and validate before adopting each bump.

## Claude Cost Note (Why tmux Stays)

- Anthropic announced that starting 2026-06-15, Claude Agent SDK, `claude -p`, and third-party apps authenticating through subscriptions would stop drawing from plan limits and instead draw from a separate monthly Agent SDK credit (Pro $20, Max 5x $100, Max 20x $200, Team $20/$100, Enterprise $20/$200), with overflow at standard API rates via usage credits.
- On June 15 Anthropic paused the change: for now SDK, `claude -p`, and third-party usage still draw from subscription limits, and the credit is not available. The stated direction remains a separate programmatic budget.
- `claude-agent-acp` is built on the Claude Agent SDK, so Claude-over-ACP lands in the programmatic bucket whenever the split takes effect. Interactive Claude Code in a terminal, which is exactly what the tmux runner drives, explicitly stays on subscription limits.
- Conclusion: for Claude, tmux is the subscription-cost path and ACP is the metered path. The dual-backend product direction (ACP for structure and breadth, tmux for cost and compatibility) is not a transitional compromise; it is the durable shape.
- Codex is the opposite: ChatGPT subscription auth works through the adapter, so ACP costs nothing extra for Codex.

## Decision Summary

Reasons to start the ACP runner now:

- one client implementation unlocks ~35 agents, including several (Cursor, Copilot CLI, Kimi, Qwen, Goose, OpenCode) that would each need bespoke tmux quirk work otherwise
- Codex, the repo's primary runner, now has a first-party-backed, backward-compatible integration path with pooled upstream maintenance, at subscription cost
- structured events remove the largest current defect class (pane scraping, prompt-submission truthfulness, TUI menu drift) for backends that support ACP
- permissions, cancellation, plan, and usage events map naturally onto chat-native UX that pane capture can never provide cleanly
- competitive positioning: OpenClaw and Hermes Agent are already ACP agents; clisbot as an ACP *client* keeps its differentiation (chat surfaces + durable sessions) while riding the same ecosystem

Reasons tmux must stay first-class:

- Claude cost: interactive-CLI usage stays on subscription; SDK-backed ACP usage is slated for metered billing
- universal fallback for non-ACP tools and for steering/interrupt UX that ACP cannot express
- existing stability investment and operator tooling (`watch`, `attach`, panes) that users rely on today

Recommended framing for the task doc: adopt ACP as a second runner backend behind a standard runner contract, Codex-first (or Gemini-first as the native-ACP reference), keep tmux as the default and fallback, and treat CLI JSON streaming as a third, optional backend only where a target tool has structured output but no ACP support.

## Sources

- https://agentclientprotocol.com/get-started/agents
- https://agentclientprotocol.com/protocol/prompt-turn
- https://zed.dev/blog/acp-progress-report
- https://zed.dev/blog/acp-registry
- https://github.com/zed-industries/codex-acp
- https://github.com/agentclientprotocol/codex-acp (npm `@agentclientprotocol/codex-acp`)
- https://github.com/agentclientprotocol/claude-agent-acp (npm `@agentclientprotocol/claude-agent-acp`, formerly `@zed-industries/claude-code-acp`)
- https://www.infoq.com/news/2026/02/opanai-codex-app-server/ (OpenAI Codex App Server architecture)
- https://openai.com/index/unlocking-the-codex-harness/
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- https://zed.dev/blog/anthropic-subscription-changes
- https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/
- https://codex.danielvaughan.com/2026/06/10/agent-client-protocol-microsoft-intelligent-terminal-codex-cli-multi-agent-ide-ecosystem/
