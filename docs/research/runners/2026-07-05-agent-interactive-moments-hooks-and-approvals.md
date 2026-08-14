# Agent Interactive Moments: Hooks, Questions, Plans, And Approvals

## Document Information

- **Created**: 2026-07-05
- **Purpose**: Map how CLI coding agents (Claude Code, Codex, Cursor, Gemini CLI, and peers) expose moments that need a human decision, and which mechanisms a chat-surface host like clisbot can use to detect, render, and answer them
- **Status**: Research snapshot as of 2026-07-05 from vendor docs; verify version-sensitive details against the pinned CLI versions before implementation
- **Related**: [ACP support mechanics (2026-04-05)](2026-04-05-acp-codex-and-claude-support-mechanics.md), [ACP operational effort and Codex decision (2026-07-02)](2026-07-02-acp-operational-effort-and-codex-decision.md)

## Goal

Answer, for any supported CLI tool, four operator questions:

1. When the tool shows options for the user to choose (Claude's `AskUserQuestion` and equivalents), how can clisbot see it and answer it from chat?
2. When the tool shows a plan for approval, same question.
3. When the tool asks for permission in an approval mode, same question.
4. What other hook or event mechanisms exist, and what are they good for?

The answers are written generically: the shared model comes first, tool specifics second, so the conclusions survive new tools and new questions.

## The Generic Model

### Interactive moment taxonomy

Every studied CLI produces some subset of these moment types. Naming them once keeps the per-tool sections short:

| Moment | Meaning | Examples |
| --- | --- | --- |
| **question** | Agent asks the user to choose among generated options, optionally with free text | Claude `AskUserQuestion`; Codex `tool/requestUserInput`; Gemini plan-mode `ask_user` |
| **plan approval** | Agent presents a plan and waits for approve / iterate / cancel, usually with a mode switch on approval | Claude plan mode + `ExitPlanMode`; Gemini plan mode; Codex plan/review items |
| **permission approval** | Tool call needs allow/deny before execution | Claude permission dialogs; Codex command/patch approvals; Cursor `ask`; ACP `session/request_permission` |
| **elicitation** | An MCP server (not the agent) requests structured user input | MCP elicitation, surfaced through each client |
| **waiting signal** | Agent is idle, blocked on input, or finished a turn | Claude `Notification`/`Stop`; Codex `notify` agent-turn-complete, approval-requested |
| **lifecycle prompt** | Non-conversational TUI dialogs: trust-this-folder, auth/login, update menus, hook-trust review | Codex trust and update menus; Claude theme/login; Codex hooks trust review |

### The four host levers

For each moment, a host can act at four levels. Every integration decision reduces to picking a lever per moment per tool:

1. **Observe**: get a structured event that the moment happened (hooks, notify, stream events). Enables truthful chat status without pane scraping.
2. **Decide**: return a machine decision from inside the tool's own flow (decision-capable hooks, permission callbacks, protocol approval responses). The tool blocks while the host decides.
3. **Answer as input**: supply the user's choice through the tool's normal input channel (TUI keystrokes via tmux, protocol answer payloads, `updatedInput` answer shapes).
4. **Configure away**: prevent the moment from occurring (bypass/yolo flags, `dontAsk`/`never` policies, allow rules). This is clisbot's current strategy via `--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, and `--approval-mode=yolo`.

### The three integration lanes

Independent of tool, there are three lanes to wire the levers, and they compose:

- **Lane A — TUI + hooks as sensors, tmux as actuator**: keep the interactive TUI in tmux; install hooks that POST moment events to the clisbot runtime; render a chat decision card; answer by injecting keystrokes into the pane. Works with today's runner; fidelity depends on TUI stability.
- **Lane B — hooks as deciders**: for moments the tool routes through a decision-capable hook (notably permission approvals in Claude and Codex), the hook itself blocks while clisbot collects the chat answer and returns allow/deny. No keystrokes needed for those moments.
- **Lane C — structured protocol runner**: run the agent behind ACP, the Codex App Server, or the Claude Agent SDK / `stream-json`, where questions, plans, and approvals are first-class requests with typed answer payloads. The only lane where *question* moments are answerable without keystrokes.

## Claude Code

### Hook system (the sensor and decider substrate)

Hooks are configured in settings files (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, plugins, skill/agent frontmatter), organized as event → matcher → handlers. Handler types: `command`, `http` (POST to a URL — the natural clisbot integration), `mcp_tool`, `prompt`, and `agent`. Handlers support `timeout` (default 600s for command/http), `async`, and `asyncRewake`. `--include-hook-events` mirrors hook lifecycle into the `stream-json` output.

The event list is large (~30 events). The ones that matter for interactive moments:

| Event | Fires | Host can |
| --- | --- | --- |
| `PreToolUse` | before any tool call (matcher = tool name, incl. `AskUserQuestion`, `ExitPlanMode`) | decide: `permissionDecision: allow\|deny\|ask\|defer`, `permissionDecisionReason`, `updatedInput`, `additionalContext` |
| `PermissionRequest` | when a permission dialog appears | decide: `decision: { behavior: allow\|deny, updatedInput }` |
| `PermissionDenied` | after an auto-mode classifier denial | observe; optionally `retry: true` |
| `Notification` | notification emitted; matcher on `notification_type` incl. `permission_prompt`, `idle_prompt` | observe (cannot respond) |
| `Elicitation` / `ElicitationResult` | MCP server requests user input / after answer | decide: `action: accept\|decline\|cancel` + `content` form values |
| `Stop` / `StopFailure` | turn finished / turn failed (matcher on error type incl. `rate_limit`) | observe; `Stop` can block stopping with a reason (forces continuation) |
| `UserPromptSubmit` | before a prompt is processed | observe/block/add context (submission acknowledgment signal) |
| `SessionStart` / `SessionEnd` | session begins/ends (matcher: `startup\|resume\|clear\|compact`) | observe; inject context |
| `PostToolUse`, `PostToolUseFailure`, `PostToolBatch` | after tool calls | observe; feedback; transform output |
| `PreCompact` / `PostCompact`, `SubagentStart` / `SubagentStop`, `TeammateIdle`, `ConfigChange`, `FileChanged` | lifecycle | observe/block |

Key properties: exit code 2 = blocking error; hooks run in interactive *and* `-p` modes; `disableAllHooks` exists; identical handlers are deduplicated; `PreToolUse` supports a `defer` decision that lets a `-p` process exit and resume the pending call later from the persisted session — a native primitive for chat-paced approvals.

### Permission approval

Evaluation order (documented for the SDK; the interactive CLI follows the same model): **hooks → deny rules → ask rules → permission mode → allow rules → prompt/`canUseTool`**. Consequences:

- A `PermissionRequest` hook can fully decide any dialog the user would have seen — in interactive TUI sessions too. This is the strongest Lane B primitive: an `http` hook can hold the dialog (up to its timeout) while clisbot collects allow/deny in chat.
- Deny rules and explicit `ask` rules apply **even in `bypassPermissions`**, as do `rm -rf /`-style circuit breakers and MCP tools marked `_meta["anthropic/requiresUserInteraction"]`. This explains why clisbot still sees occasional prompts despite launching with `--dangerously-skip-permissions`.
- Permission modes: `default` (Manual), `acceptEdits`, `plan`, `auto` (classifier-reviewed; falls back to prompting after repeated blocks; aborts in `-p`), `dontAsk` (deny instead of prompt — the correct headless mode for unattended queue/loop runs), `bypassPermissions`. Modes can change mid-session (Shift+Tab, SDK `setPermissionMode`).
- Headless deciding without hooks: `claude -p --permission-prompt-tool mcp__<server>__<tool>` routes prompts to an MCP tool that returns allow/deny — clisbot could expose such a tool from its own MCP server.

### Question moment: `AskUserQuestion`

- Input schema: `questions[]` (1–4), each `{ question, header (≤12 chars), options: 2–4 × { label, description, preview? }, multiSelect }`. An optional `previewFormat` (`markdown`/`html`) config adds renderable option previews.
- It is classified as a tool that **requires user interaction**: allow rules never auto-approve it; in `dontAsk` it is denied; it is unavailable inside subagents.
- **SDK / stream-json lane (clean answer path)**: the call reaches `canUseTool`; the host answers by returning `{ behavior: "allow", updatedInput: { questions, answers: { "<question text>": "<label or free text>" }, response? } }`. Multi-select joins labels; free text goes in as the value; `response` replaces per-question answers with one freeform reply. Deny with a message is also legal (Claude adjusts).
- **Interactive TUI lane**: renders a picker; the documented answer path is keystrokes. Hooks can observe it (`PreToolUse` matcher `AskUserQuestion`) but there is no documented hook that *answers* it; a `PreToolUse` deny-with-reason ("user chose X") is a workaround that feeds the answer as an error message, and allow-with-`updatedInput` pre-answering is undocumented — both are bench-test candidates, not contracts.

### Plan approval

- Plan mode is a permission mode; the plan-ready dialog offers: approve + auto mode, approve + acceptEdits, approve + review manually, keep planning (plus editor/Ultraplan refinement). Approval **switches the session's permission mode** — a plan answer is also a mode decision, which clisbot must reflect in session state.
- `ExitPlanMode` is a tool call, so `PreToolUse`/`PermissionRequest` hooks see it, and in the SDK it flows through `canUseTool`; approving it programmatically accepts the plan. In headless runs, plan mode plus `dontAsk`/allow rules is the way to make "plan only, never edit" runs deterministic.
- Claude may call `AskUserQuestion` during planning, so plan flows can nest question moments.

### Other Claude surfaces worth knowing

- `stream-json` bidirectional mode (`-p --input-format stream-json --output-format stream-json`) is the raw protocol under the SDK; `--replay-user-messages` gives submission acks; `system/init` carries session metadata; resume via `--resume <id>` / `--fork-session`.
- The SDK lane is what `claude-agent-acp` wraps for ACP; the subscription-vs-metered cost caveat from the 2026-07-02 research applies to any non-TUI Claude lane.
- Anthropic's own "Remote Control" (`claude remote-control`) continues local sessions from other devices with approvals rendered remotely — first-party validation of exactly the clisbot UX shape.

## Codex

### Hooks (GA in 2026)

Codex now ships a hooks system deliberately shaped like Claude's dialect. Config: `~/.codex/hooks.json` or `[hooks]` in `config.toml`, repo `.codex/hooks.json`, plugin and enterprise-managed layers; gated by `[features] hooks = true`.

- Events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`.
- `PreToolUse` covers Bash, `apply_patch`, and MCP calls; returns `permissionDecision: allow|deny` (+ `updatedInput` rewrite).
- `PermissionRequest` fires when Codex is about to ask for approval (shell escalation, managed network) and returns `decision: { behavior: allow|deny, message? }` — allow skips the approval prompt; any deny wins. Same Lane B potential as Claude.
- `Stop` input includes `last_assistant_message` and supports block-with-reason continuation. `UserPromptSubmit` can block.
- **Trust model is an operational constraint**: non-managed hooks require an interactive review/trust step on first run and re-review when the hook hash changes; `--dangerously-bypass-hook-trust` skips it for automation. A clisbot-installed hook must account for this or it will create a new lifecycle prompt (the repo already tracks Codex hooks-review startup gating as a tmux quirk).

### Approval and notification config

- `approval_policy`: `untrusted | on-request | never` (`on-failure` deprecated), plus a granular form `{ granular = { sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval } }` — note elicitation and permission-request classes are individually controllable. `sandbox_mode`: `read-only | workspace-write | danger-full-access`. clisbot currently uses the global bypass flag, which suppresses all of it.
- `notify = ["program"]` invokes an external command with a JSON payload on events such as agent-turn-complete (payload shape not restated in the new reference — verify against the pinned version); `tui.notifications` can filter built-in notifications by type, e.g. `agent-turn-complete`, `approval-requested`. `notify` is the cheapest turn-complete sensor for the tmux lane.

### App Server (the protocol lane)

JSON-RPC 2.0 over stdio/WebSocket/Unix socket; thread → turn → item model; this is what `@agentclientprotocol/codex-acp` wraps.

- **Permission approval**: server-initiated `item/commandExecution/requestApproval` (responses `accept | acceptForSession | decline | cancel`, optionally accept-with-execpolicy-amendment) and `item/fileChange/requestApproval` (same minus amendment). `serverRequest/resolved` confirms; the item then completes.
- **Question moment**: experimental `tool/requestUserInput` — 1–3 short questions, options with `isOther` free-form, and `autoResolutionMs` for auto-answer timeout. This is Codex's `AskUserQuestion` equivalent and only exists on this lane.
- **Plan**: `turn/plan/updated` streams plan entries with per-step status; `plan` items and `enteredReviewMode`/`exitedReviewMode` items exist. Codex plans are progress reporting, not an approval gate like Claude plan mode.
- `codex exec --json` (headless, `codex exec resume <id>`) emits events but is not an approval-interactive lane; `codex mcp-server` exposes Codex as an MCP server where approvals surface as elicitations.

## Cursor

- Hooks: `hooks.json` at enterprise/team/project (`.cursor/hooks.json`)/user (`~/.cursor/hooks.json`). Events include `sessionStart/End`, `preToolUse`/`postToolUse`/`postToolUseFailure`, `beforeShellExecution`/`afterShellExecution`, `beforeMCPExecution`/`afterMCPExecution`, `beforeReadFile`/`afterFileEdit`, `beforeSubmitPrompt`, `subagentStart/Stop`, `preCompact`, `stop`, `afterAgentResponse`/`afterAgentThought`.
- Decision contract: `{ "permission": "allow" | "deny" | "ask", "user_message", "agent_message", "updated_input" }`; exit code 2 = deny; `failClosed` option. Caveat: `ask` is documented as not enforced for some events today.
- `stop` and `subagentStop` may return `followup_message`, which **auto-submits the next user message** — a native loop/queue continuation primitive unique to Cursor.
- No documented question or plan-approval moment of its own; plan/to-do behavior is product UI. `cursor-agent` (CLI) offers `-p` with JSON/stream output, and Cursor is listed as an ACP agent, so the protocol lane exists. Cloud agents run project/team hooks but not user hooks.

## Gemini CLI

- Hooks: `settings.json` (`.gemini/`, `~/.gemini/`, `/etc/gemini-cli/`, extensions). Events: `SessionStart/End`, `BeforeAgent`/`AfterAgent`, `BeforeModel`/`AfterModel`, `BeforeToolSelection`, `BeforeTool`/`AfterTool`, `PreCompress`, `Notification`. `BeforeTool` can block/modify tool calls; `AfterAgent` can retry/halt; `Notification` is advisory. **No hook decides approval dialogs** — Gemini has no `PermissionRequest` equivalent.
- Approval: `--approval-mode default|auto_edit|yolo|plan`; interactive confirmations are TUI dialogs; policy engine + allowed-tools settings shape them.
- Plan mode: research → discussion (via an `ask_user` tool — Gemini's question moment lives inside plan mode) → markdown plan file → approval dialog (auto-accept edits / manually accept / iterate / cancel). In headless runs the policy engine auto-approves plan enter/exit and the CLI switches to YOLO on exit — headless silently deletes the moments rather than exposing them.
- Headless: `-p` with `--output-format json|stream-json` (`init`, `message`, `tool_use`, `tool_result`, `error`, `result` events). ACP is native (`--experimental-acp`), which is the only Gemini lane where permission requests become answerable protocol messages.

## Cross-Tool Standards And Peers

- **ACP**: `session/request_permission` carries a `toolCall` plus `options[]` of `{ optionId, name, kind: allow_once | allow_always | reject_once | reject_always }`; the response outcome is selected-option or cancelled. Plans stream as `PlanEntry { content, status: pending|in_progress|completed, priority }`. Session modes (`session/set_mode`, `current_mode_update`) express ask/architect/code-style mode switches — the natural mapping target for plan-mode transitions. **ACP v1 has no generic question primitive**, so agent question moments must degrade (adapter-dependent) into permission options or plain text; this is a real gap when choosing ACP as the only lane.
- **MCP elicitation**: any MCP server can request structured user input through the client. Claude exposes it to hosts via the `Elicitation` hook (which can auto-answer) and `requiresUserInteraction` metadata; Codex gates it via `approval_policy.granular.mcp_elicitations`. A chat host must expect elicitation moments to arrive from tools it did not launch.
- **OpenCode** (peer reference): its permission config treats `question` as a first-class permission class alongside `edit`/`bash`, with `allow|ask|deny` and once/always answers — independent confirmation that "question" and "approval" converge into one decision-card UX.

## Capability Matrix

"Decide" = a hook/callback can return the decision; "Answer" = structured answer payload exists; "TUI" = keystrokes only.

| Capability | Claude Code | Codex | Cursor | Gemini CLI |
| --- | --- | --- | --- | --- |
| Hook system | Yes (~30 events, 5 handler types incl. HTTP) | Yes (10 events, trust review) | Yes (~20 events) | Yes (11 events) |
| Turn-complete signal | `Stop` hook / stream result | `Stop` hook, `notify`, `tui.notifications` | `stop` hook | `AfterAgent` hook / `result` event |
| Waiting/blocked signal | `Notification` (`permission_prompt`, `idle_prompt`) | `notify` approval-requested | — (infer from hooks) | `Notification` (advisory) |
| Permission moment: decide via hook | `PermissionRequest`, `PreToolUse` (allow/deny/ask/defer) | `PermissionRequest`, `PreToolUse` (allow/deny) | `preToolUse` etc. (allow/deny/ask) | No (block-only `BeforeTool`) |
| Permission moment: protocol answer | SDK `canUseTool`; `--permission-prompt-tool`; ACP | App Server `requestApproval`; ACP | ACP | ACP only |
| Question moment | `AskUserQuestion`: TUI picker; answerable via SDK/stream-json `canUseTool` | `tool/requestUserInput` (App Server, experimental) | None documented | `ask_user` inside plan mode; TUI only |
| Plan approval moment | Plan mode dialog; `ExitPlanMode` tool visible to hooks/SDK | Plan items = progress only; review mode items | Product UI only | Plan mode dialog; auto-approved headless |
| MCP elicitation | `Elicitation` hook can answer | granular approval policy class | via MCP hooks | via MCP support |
| Headless answerable lane | stream-json/SDK (full) | App Server (full) | cursor-agent stream (partial) | none native (ACP) |
| ACP adapter | `claude-agent-acp` (metered-cost caveat) | `codex-acp` (subscription-cost OK) | listed as ACP agent | native |

## Fit Into clisbot Concepts And Chat UX

### One shared concept: the decision card

All moment types collapse into one channel-neutral model the channels layer can render, matching the domain-language ownership split (channels present, agents own run state, runners transport):

- `decision card`: `{ session, run, moment type, title/prompt, body (plan text, command, diff summary, form schema), options[] (id, label, description, kind), allows free text?, multi-select?, default action, expires at, answered by/at }`
- Sources map cleanly: Claude `AskUserQuestion.questions[]` and plan-dialog options; Claude/Codex `PermissionRequest` tool input; Codex `requestApproval` decisions (`accept`, `acceptForSession`, …) and `requestUserInput.questions[]`; ACP `PermissionOption { optionId, name, kind }`; MCP elicitation form schemas.
- Rendering is per-surface affordance: interactive buttons where the channel has them, numbered-reply fallback everywhere (users answer `1`/`2` or free text), consistent with existing chat-native controls like `/nudge`. Answer authorization reuses route policy + auth roles — approving a permission is a sensitive action and should be role-gated like other protected operations.
- Every card and its resolution belongs in the session event feed for audit and for late-attaching operators.

### Strategy ladder (composable, per moment per tool)

- **S0 — configure away (today)**: bypass/yolo launch flags. Residual moments still occur: Claude plan-approval and auto-mode behavior, ask rules, `requiresUserInteraction` MCP tools, root-delete circuit breakers, and every lifecycle prompt (trust, auth, update, hook-trust). Today they surface only through `/streaming`, `/watch`, `/nudge`.
- **S1 — hooks as sensors**: install clisbot-owned hooks (Claude `http` handlers; Codex/Gemini/Cursor `command` handlers hitting a small local CLI or curl) for `Stop`/turn-complete, `Notification` waiting states, and `UserPromptSubmit` acks, posting to the runtime's local endpoint keyed by session. No behavior change; replaces prompt-detection scraping ambiguity with structured truth and makes "agent is stuck at a prompt" a first-class event feed entry. Cheap, works inside the existing tmux runner.
- **S2 — hooks as deciders (permission moments)**: Claude `PermissionRequest`/`PreToolUse` and Codex `PermissionRequest` hooks hold the dialog while clisbot renders a decision card and returns allow/deny (Claude also: `ask`, `updatedInput`, `defer`, and `updatedPermissions`-style remember rules). Requires: per-session single-flight, hook timeout policy (default 600s) with an explicit timeout action, and moving off blanket bypass flags toward mode + rules so moments exist to intercept. Not available for Gemini.
- **S3 — protocol runners (all moments)**: ACP / Codex App Server / Claude SDK-stream lanes make question, plan, permission, and cancellation first-class request/response pairs — the only clean chat answer path for `AskUserQuestion` and `requestUserInput`. This is the same dual-backend direction already recommended in the 2026-07-02 research (structure via protocol, tmux for cost/compatibility/steering), now with the added argument that question moments are effectively protocol-only.
- **Keystroke actuation remains** the fallback for TUI-only moments on the tmux lane (question pickers, plan dialogs, lifecycle prompts): sensor event → decision card → mapped keystroke injection, with the existing prompt-submission truthfulness machinery.

### Policy questions any implementation must answer

- **Who may answer**: same principal model as other protected actions; per-route and per-role gates; a shared-room card should name the requester and accept answers only from allowed senders.
- **Timeout behavior per moment type**: permission → deny-with-reason (safe) or `defer` (Claude `-p`); question → deny with "no answer, proceed with your best judgment" vs. park the run; plan → keep planning. Defaults must be per-agent config, not hardcoded.
- **Unattended lanes**: queue and loop runs should run under `dontAsk`/`never`-style policies so a moment becomes a fast structured failure instead of a silent hang.
- **Mode truth**: plan approval and remember-this-decision answers mutate session permission mode/rules; session state and `/status` must reflect it.
- **Duplicate surfaces**: one card, one resolution; late answers get "already resolved by X".
- **Hook install ownership**: clisbot writes hooks into its managed workspace/home scopes, versioned with the runner preset; must respect Codex hook trust (pre-trust via managed config or the bypass flag) and never fight user-authored hooks.

## Q&A Bank

- **Can a hook answer `AskUserQuestion` in the interactive TUI?** No documented path. Hooks observe it (`PreToolUse`); answering cleanly requires the SDK/stream-json/App-Server lane or keystrokes. Deny-with-reason smuggling and `updatedInput` pre-answers are unverified hacks — bench-test before relying on them.
- **Can a hook approve a plan?** Effectively yes for Claude: `ExitPlanMode` is a tool call, so `PreToolUse`/`PermissionRequest` can allow it; but the interactive dialog's richer options (which mode to continue in) are then bypassed, so clisbot should set the follow-up mode itself.
- **Do hooks run when clisbot launches with bypass flags?** Yes — hooks run in every mode, and deny/ask rules plus hooks still apply under `bypassPermissions`. Sensors (S1) work without changing launch flags; deciders (S2) only matter once bypass stops suppressing the moments.
- **Does a decision hook block the agent?** Yes, until the handler returns or times out (Claude default 600s, configurable per hook). That is what makes chat-paced approval possible — and what makes timeout policy mandatory.
- **How does clisbot learn "agent is waiting"?** Claude: `Notification` hook (`permission_prompt`, `idle_prompt`). Codex: `notify` / `tui.notifications` (`approval-requested`). Others: infer from decision-hook in-flight state or pane state.
- **How does clisbot learn "turn finished" without scraping?** Claude `Stop` hook (or stream result), Codex `Stop` hook / `notify` agent-turn-complete, Cursor `stop`, Gemini `AfterAgent`.
- **Can hooks push content into chat?** Hooks emit events and decisions to clisbot; rendering is clisbot's job. Claude `http` hooks make this a plain local HTTP POST; other tools need a tiny command shim.
- **Can clisbot ask its own questions through the agent?** No — question moments are agent-generated. Host-initiated questions are ordinary chat messages, or (SDK lane) custom tools.
- **What about MCP-server-initiated questions (elicitation)?** Treat as another decision-card source: Claude `Elicitation` hook can forward or auto-answer; Codex gates them via granular approval policy.
- **Is there one hook dialect to abstract over?** Nearly: Codex intentionally mirrors Claude's event names and JSON shapes (`hookSpecificOutput`, `permissionDecision`, `decision.behavior`); Cursor and Gemini differ but map onto the same observe/decide semantics. One internal hook-event model with per-tool encoders is realistic.
- **What breaks on tool updates?** Hooks and protocols are versioned contracts and drift additively; TUI dialogs are not (existing lesson). Prefer contracts for detection/decision even while tmux stays the executor. Codex hook trust hashes add a re-trust step on any clisbot hook change.
- **Security blast radius?** A decision endpoint is remote approval of shell execution. It must be loopback-only/authenticated, role-gated in chat, rate-limited, audited in the event feed, and default-deny on timeout. This belongs in `docs/research/security/` before S2 ships.
- **Does any of this change Claude billing?** Hooks and TUI keystrokes don't; the SDK/stream-json/ACP lanes fall into the programmatic bucket per the 2026-07-02 cost note.

## Verification Matrix (before implementation)

| # | Question | How to test |
| --- | --- | --- |
| 1 | Does `PreToolUse` fire for `AskUserQuestion` and `ExitPlanMode` in the interactive TUI, and can allow+`updatedInput` pre-answer a question? | tmux session + logging hook; then attempt `updatedInput` with `answers` |
| 2 | Does `PermissionRequest` (Claude) cover the plan-approval dialog and mode-switch options, or only tool permission dialogs? | plan-mode session with logging hook |
| 3 | Exact `Notification` payloads for `permission_prompt` vs `idle_prompt`, and firing latency | logging hook, both states |
| 4 | Claude hook `http` handler behavior on slow responses: keep-alive, timeout action, UI state while held | local endpoint with induced delay |
| 5 | `defer` decision semantics in interactive (non `-p`) sessions | attempt in TUI |
| 6 | Codex hook trust flow under clisbot-managed `hooks.json`: does first run block startup, and does `--dangerously-bypass-hook-trust` fully unblock? | fresh CODEX_HOME |
| 7 | Codex `notify` payload fields per event on the pinned version | notify script dumping JSON |
| 8 | Codex `tool/requestUserInput` availability and shape via `codex-acp` (does the adapter surface it, degrade it, or auto-resolve?) | ACP client harness |
| 9 | How `claude-agent-acp` and `codex-acp` map question + plan moments into ACP (given no ACP question primitive) | ACP client harness |
| 10 | Gemini headless: confirm plan/approval moments are truly absent (auto-approve + YOLO switch) across `--approval-mode` values | headless matrix run |
| 11 | Keystroke answer maps for each TUI dialog variant (question picker incl. free-text "Other", plan dialog, permission dialog) per pinned CLI versions | tmux actuation tests |
| 12 | Hook event ordering/duplication when multiple hooks fire in one turn (dedupe key design for the event feed) | logging hooks, busy turn |

## Sources

- Claude Code hooks reference and guide: https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/hooks-guide
- Claude Code permission modes and plan approval: https://code.claude.com/docs/en/permission-modes
- Claude Agent SDK permissions and evaluation order: https://code.claude.com/docs/en/agent-sdk/permissions
- Claude Agent SDK approvals, `canUseTool`, `AskUserQuestion` contract: https://code.claude.com/docs/en/agent-sdk/user-input
- Claude Code headless mode and CLI flags: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/cli-reference
- Codex hooks: https://developers.openai.com/codex/hooks
- Codex configuration reference (approval_policy, notify, tui.notifications, hooks): https://developers.openai.com/codex/config-reference
- Codex CLI reference (`--ask-for-approval`, `exec`, `app-server`, `mcp-server`): https://developers.openai.com/codex/cli/reference
- Codex App Server protocol (approvals, `tool/requestUserInput`, plan/review items): https://developers.openai.com/codex/app-server
- Cursor hooks: https://cursor.com/docs/agent/hooks
- Gemini CLI hooks, headless, plan mode: https://geminicli.com/docs/hooks/, https://geminicli.com/docs/cli/headless/, https://geminicli.com/docs/cli/plan-mode/
- ACP schema (`session/request_permission`, plan entries, session modes): https://agentclientprotocol.com/protocol/schema
- OpenCode permissions (peer reference): https://opencode.ai/docs/permissions/
- Repo research this extends: [2026-04-05 ACP mechanics](2026-04-05-acp-codex-and-claude-support-mechanics.md), [2026-07-02 ACP effort and Codex decision](2026-07-02-acp-operational-effort-and-codex-decision.md)
