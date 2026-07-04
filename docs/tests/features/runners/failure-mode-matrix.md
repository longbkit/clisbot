# Runner Failure-Mode Matrix

- **Created**: 2026-07-03
- **Purpose**: one truthful map of every known runner failure scenario: how it is triggered, where clisbot detects it, what handling exists, what the user sees, and whether the case is solved, fails-well, or still open — each row anchored to executable evidence.
- **Simulation surfaces**: every "Evidence" entry runs against a simulator, so failures are reproducible on demand without a real CLI, model, or network.

## Simulation Surfaces

| Surface | Location | How to drive scenarios |
| --- | --- | --- |
| tmux CLI simulator (`FakeTmux`) | `test/agent-service/agent-service-support.ts` | In-memory tmux client driving the real tmux backend: scripted trust/update prompts (`queueStartupPromptScript`), resume rejection panes, startup exit panes with exit records, dropped paste literals, swallowed Enter counts, status-command response modes, long-running output, server loss, duplicate sessions. |
| ACP agent simulator | `test/fixtures/fake-acp-agent.ts` | Raw ndjson JSON-RPC agent driving the real ACP backend over real process stdio. Env knobs: `FAKE_ACP_SUPPORTS_LOAD`, `FAKE_ACP_REQUIRE_AUTH`, `FAKE_ACP_REQUIRE_PERMISSION`, `FAKE_ACP_PROMPT_DELAY_MS`, `FAKE_ACP_EXIT_MID_PROMPT`, `FAKE_ACP_EXIT_AT_INITIALIZE`, `FAKE_ACP_EMIT_PLAN`, `FAKE_ACP_EMIT_COMMANDS`, `FAKE_ACP_EMIT_UNKNOWN_UPDATE`, `FAKE_ACP_CONTEXT_RECALL`. |

Adding a hard case = add a knob/script to the right simulator + one regression test + one row here. Do not fix a reported runner bug without first reproducing it as a simulator scenario.

## Status Legend

- **solved** — automatic handling recovers without user action
- **fails-well** — no automatic recovery exists (or is possible); clisbot fails fast with a truthful message and a concrete next step, without blocking other sessions
- **open** — known gap tracked in the backlog

## tmux Backend: Startup

| Scenario | Detection | Handling | User-facing outcome | Status | Evidence (test) |
| --- | --- | --- | --- | --- | --- |
| Workspace trust prompt (Codex/Claude/Gemini variants, including delayed appearance) | pane text classifiers in `startup-prompts.ts` | auto-accept, re-verify ready | none; startup continues | solved | "waits for a delayed trust prompt on first startup" (+ Claude/Gemini variants) |
| Codex self-update menu, incl. update→exit→relaunch and update-then-trust chains | update-prompt classifier + exit sentinel | auto-confirm, relaunch, re-run handshake | none | solved | "auto-confirms a Codex update prompt and relaunches...", "survives a Codex update prompt followed by a trust prompt..." |
| Gemini OAuth / auth-setup screens | configured `startupBlockers` patterns | fail fast before prompt submission | truthful blocker message with exact operator fix (authenticate directly / headless key) | fails-well | "fails fast when a configured startup blocker appears before Gemini ready state" |
| Ready pattern never appears (hung CLI) | `startupReadyPattern` + `startupDelayMs` deadline | bounded fresh retries, then abort | "did not reach the configured ready state within Nms... resend" + inspect commands | fails-well | "fails truthfully when ready pattern never appears before startup deadline" |
| Slow ready banner | same deadline machinery | bounded startup retries succeed | none (slower start) | solved | "survives a slow ready banner after bounded startup retries" |
| Runner state database locked (multi-agent CODEX_HOME contention) | post-exit pane classifier (`runner-state-failures.ts`) | preserved-session-id retries with backoff | retries silently; if still locked: truthful contention error naming the root cause | solved / fails-well at exhaustion | "retries with the preserved session id when the runner state database is locked...", "stops with a preserved-session contention error..." |
| Runner state database corrupted | post-exit pane classifier | no retry (permanent) | operator repair guidance | fails-well | "fails fast with operator guidance when the runner state database is corrupted" |
| Resume rejected (stale stored session id) | resume-rejection pane classifier during bootstrap | kill dead pane, clear mapping, fresh conversation | note explaining the stored session could not be resumed; prompt still runs | solved | "opens a fresh conversation immediately when the runner reports the resumed session id no longer exists", "falls back to a fresh conversation... when stale resume keeps dying" |
| Resume launch keeps dying (nonzero exits) | wrapper exit records + retry exhaustion | preserved-id retries, then fresh fallback with note | note + prompt runs fresh | solved | "preserves stored session id when resume startup dies immediately" |
| tmux window/pane vanishes mid-creation; server socket dead; duplicate session race | tmux error patterns (`errors.ts`) | classified retryable → fresh retry; duplicate → adopt existing | none | solved | "retries a fresh startup when the tmux window disappears...", "recovers when the tmux socket exists but the server is not running", "recovers when tmux reports duplicate session during concurrent startup" |
| tmux dies while dismissing a trust prompt | bootstrap-gone classification | recreate session | none | solved | "recreates the runner session when tmux dies while dismissing a trust prompt" |

## tmux Backend: Prompt Delivery And Mid-Run

| Scenario | Detection | Handling | User-facing outcome | Status | Evidence (test) |
| --- | --- | --- | --- | --- | --- |
| Paste never lands in the composer | paste settlement + snapshot confirmation | bounded re-paste; then one runner restart preserving session id; retry prompt once | none, or truthful unsubmitted error telling the user to resend | solved / fails-well at exhaustion | "retries the first prompt after restarting the runner with the stored session id", `TmuxPasteUnconfirmedError` unit coverage |
| Enter swallowed / lands as newline (submit not truthful) | composer-drain check (`paneShowsPendingComposerText`) | up to 3 Enter retries; never claims submitted falsely | none, or truthful "not submitted — check pane / nudge / resend" | solved / fails-well at exhaustion | "retries in one fresh session when startup status-command submit is not confirmed", latency submit suites |
| Runner process dies mid-run | pane loss patterns during monitoring | monitor-owned recovery: reopen stored context (max 2), else fresh, else truthful failure with exit-code evidence | recovery notes in-thread; final truthful settlement | solved | "reopens the same conversation context and preserves resumed output after mid-prompt loss", "opens a fresh session when mid-prompt loss has no resumable context" |
| Session-id capture misses at startup | status-command capture returns null | deferred re-capture with cooldown; post-run recapture on idle pane | one-time warning that the conversation is not resumable yet; auto-heals | solved | "captures the durable session id after the run completes when startup capture missed", "does not spam status-command recapture immediately..." |
| Long run exceeds `maxRuntime` | monitor deadline | detach observation, keep session running, settle truthfully later | detach note with `/attach`, `/watch`, `/stop` guidance; final result still posted | solved | "detaches long-running prompts instead of timing them out..." |
| Stale idle sessions accumulate | `staleAfterMinutes` cleanup | sunset tmux session; stored session id kept for resume | none | solved | "sunsets stale tmux sessions without discarding the stored session id" |
| Capture-pane settlement stall on switched routes | — | — | typing indicator without a visible reply | **open** | backlog: "Telegram capture-pane settlement stall" (2026-04-12) |
| Direct pane input outside clisbot corrupts a shared session | — | — | undetected drift | **open** | backlog: "tmux session drift detection and guardrails" (2026-04-10) |

## ACP Backend

| Scenario | Detection | Handling | User-facing outcome | Status | Evidence (test, `test/acp-backend.test.ts`) |
| --- | --- | --- | --- | --- | --- |
| Adapter crashes before initialize answers | startup exit-observation window + stderr tail | classified adapter loss | truthful error including adapter stderr evidence | fails-well | "classifies an adapter crash at initialize with stderr evidence" |
| Adapter dies mid-turn | prompt-vs-exit race + 250ms exit observation | monitor-owned recovery via `session/load` (same flow as tmux) | recovery notes; truthful settlement | solved | "classifies a mid-run adapter loss as recoverable" |
| Agent requires authentication | advertised `authMethods` + `authenticate` | configured `runner.acp.authMethodId`; unadvertised ids fail listing what the agent offers | truthful auth error naming available methods | solved / fails-well | "authenticates with the configured auth method...", "fails truthfully when the configured auth method is not advertised" |
| Agent cannot load stored sessions | `loadSession` capability at initialize | fresh conversation + note | truthful fresh-start note | solved | "falls back to a fresh conversation when the agent cannot load sessions" |
| Stored session rejected at `session/load` | load RPC error | clear mapping, fresh conversation + note | truthful fresh-start note | solved | resume-fallback branch (`openAcpSession`) |
| Tool permission request | `session/request_permission` | per-agent policy: auto-allow or deny; interactive approval is Phase 2 | allow: silent; deny: refusal rendered truthfully with failed tool line | solved (policy), open (interactive) | "auto-allows permission requests per policy...", "deny permission policy rejects the tool call..." |
| `/stop` during a turn | first-class `session/cancel` | turn settles `cancelled` | truthful "The run was cancelled." note | solved | "interruptSession cancels the active turn with a truthful stop note" |
| `/steer` during a turn (no steering primitive in ACP — verified 4 layers, 2026-07-03) | capability gate | interrupt-and-redirect: cancel (context retained) + steering message as next prompt | truthful redirect notice; new turn continues the work | solved | "interrupt settles the turn so an immediate follow-up prompt succeeds", "retains conversation context across interrupt", channel test "explicit steer on a non-steer backend interrupts and redirects..." |
| Concurrent prompt into an active turn | `AcpTurnAlreadyActiveError` guard | blocked before the wire (live experiment: unguarded concurrent prompt hangs the adapter indefinitely) | admission message guiding `/queue` | solved | guard + 2026-07-03 live experiment (artifact doc §D4) |
| Unknown update types / new advertisements (protocol drift) | conservative event mapping | ignored; turn continues | none | solved | "ignores unknown update types and command advertisements" |
| Shell command / nudge on ACP | capability flags | declined | truthful guidance (use tmux agent or terminal; nudge n/a) | fails-well by design | "degrades steering truthfully..." + capability matrix doc |
| Runtime shutdown with live adapters | `backend.shutdown()` | adapters killed; stored ids resume via `session/load` next start | conversation continues after restart | solved | "resumes a stored session over session/load" |
| Pane-less operator debugging (`runner inspect/watch` for ACP) | — | — | operators lack an event-log view | **open** | task doc Phase 3 |

## Reading This Matrix

- Every **solved** row is enforced by a regression test against a simulator; a change that breaks the behavior fails `bun test`.
- Every **fails-well** row must keep three properties: fail fast (no hang), tell the truth (real cause + evidence), and name the next step the user or operator should take. That is the deliberate design for cases with no automatic solution.
- Every **open** row links to its backlog owner; do not silently absorb these into unrelated changes.
