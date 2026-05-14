# Session Identity

## Purpose

This document defines the current session model used by `clisbot`.

It stays close to OpenClaw's `agentId` plus `sessionKey` mental model, but adapts it to subscription-backed AI CLIs such as Codex, Claude Code, and Gemini CLI where the tool already has its own native conversation id.

## Simple Mental Model

- by default, one routed chat surface maps to one `sessionKey`
- that `sessionKey` is the clisbot-side conversation the user is talking to
- routing policy may intentionally let multiple surfaces continue the same `sessionKey`
  - examples:
    - one personal assistant conversation shared across Slack DM and Telegram DM
    - a Slack channel and Slack thread intentionally collapsed into one conversation
- at one moment, one `sessionKey` maps to one active `sessionId`
- over time, that same `sessionKey` may rotate to a different `sessionId`
  - examples:
    - chat `/new`
    - later explicit session resume or rebind
    - backend-driven reset or expiry
- users usually do not need to care about this mapping directly
  - normal chat keeps using the current conversation automatically

Common reader questions:

- Who owns the active `sessionKey -> sessionId` mapping?
  - `SessionService`
- Where does `sessionId` come from?
  - either the native tool creates it, or `SessionService` chooses one before
    launch
- Who only uses that `sessionId`?
  - `RunnerService` and the lower-level code under `src/runners/tmux/*`
- Can multiple chat surfaces share one conversation?
  - yes, if routing intentionally maps them to the same `sessionKey`

## Current Contract

`clisbot` currently owns three different identities:

- `agentId`
  - durable agent owner
  - selects workspace, defaults, tools, skills, and policy
- `sessionKey`
  - durable logical conversation key
  - isolates queueing, routing, and continuity for one clisbot conversation
  - by default this means one DM, group, channel, topic, or thread
  - routing policy may intentionally let multiple surfaces continue the same conversation key
- `sessionId`
  - current active AI CLI conversation id attached to that `sessionKey` at this time
  - may change later while the same `sessionKey` continues
  - persisted in `~/.clisbot/state/sessions.json`

The runner owns the live execution handle:

- tmux session name
  - current tmux host for that conversation
  - replaceable if tmux dies

The important rule is:

- tmux session name is not the canonical conversation identity

Current tmux naming rule:

- tmux session name starts with a tmux-safe readable prefix derived from the rendered template value
- clisbot appends a stable short hash from the logical `sessionKey`
- this keeps names readable for operators while preserving one unique tmux runner name per logical session
- raw `sessionKey` is not used directly because tmux rewrites characters such as `:` during target parsing

## Current Store

The agents layer persists one session entry per `sessionKey` in `session.storePath`.

Current default path:

- `~/.clisbot/state/sessions.json`

Current stored fields:

- `agentId`
- `sessionKey`
- `sessionId`
- `workspacePath`
- `runnerCommand`
- `lastAdmittedPromptAt`
- `followUp.overrideMode`
- `followUp.lastBotReplyAt`
- `runtime`
- `loops`
- `queues`
- `recentConversation`
- `updatedAt`

Current meaning:

- `lastAdmittedPromptAt`
  - the timestamp of the most recent prompt admitted into active execution for that logical session
  - used by operator runner debugging commands such as `clisbot runner watch --latest` and `clisbot runner watch --next`
- `updatedAt`
  - broad continuity timestamp for session metadata writes
  - not specific enough for operator "latest new turn" selection

The session model also needs room for session-scoped runtime policy.

Examples:

- follow-up continuation mode
- thread participation TTL or expiry state
- temporary mention-only override
- temporary paused-follow-up override

This is the current continuity bridge between routing and runner restart.

## Current Flow

For one routed conversation:

1. channels resolve one `agentId` and one `sessionKey` from the current surface and routing policy
2. `SessionService` resolves workspace, runner config, and the current
   continuity record for that `sessionKey`
3. if that `sessionKey` already has an active stored `sessionId`,
   `SessionService` decides whether to continue through it
4. runner bootstrap performs the backend-specific launch or capture or resume mechanics needed for that tool
5. `SessionService` persists the resulting active mapping for that `sessionKey`
6. tmux hosts the live runner process for that session

## Runner Input Contract

The default runner-facing identity is:

- required: `sessionKey`
- optional: `sessionId`

Current meaning:

- ordinary routed work should only need `sessionKey`
- `SessionService` uses `sessionKey` to find the current active `sessionId`
  mapping and decide whether continuation or resume is possible
- `sessionId` is an optional external mapping or initialization hint, not the
  default input identity for normal routed turns
- when a caller supplies `sessionId`, `SessionService` may use it only when
  the backend or CLI supports that path
- if the backend supports caller-supplied ids, `SessionService` may choose and
  pass a `sessionId` through the runner
- if the native tool creates its own id, `SessionService` may ask the runner to
  capture that `sessionId` without disrupting the live run
- if the backend does not support caller-supplied `sessionId`, the runner must
  either:
  - capture the tool-created `sessionId` and return it to `SessionService`
    for persistence
  - or fail truthfully instead of pretending that external `sessionId`
    injection was honored
- once `sessionKey -> sessionId` is stored successfully, later requests should
  need only `sessionKey` again unless an authorized control flow intentionally
  remaps the session

Current recovery rule:

- if tmux still exists, continue using the live process
- tmux existence checks and follow-up pane commands must target the exact
  tmux session name, not a tmux prefix match, so one `sessionKey` can never
  silently attach to a foreign runner whose name merely starts with the same
  prefix
- if the tmux runner was sunset as stale, keep the stored session entry and logical conversation identity
- if tmux is gone but a stored `sessionId` exists, start a new runner and reuse that `sessionId` when the runner supports it
- if that stored `sessionId` is no longer attachable for this `sessionKey`, preserve the mapping and fail truthfully instead of silently starting a new tool conversation
- if no `sessionId` is available, start a fresh runner session
- `/new` is the explicit operator path for triggering a new runner conversation and storing the new active `sessionId`

Current user-facing rule:

- `/whoami`, `/status`, and `clisbot runner list` now show `sessionId` plus
  persistence state when clisbot knows it
- `persisted` means the same value is already saved in session continuity
- `not persisted yet` means clisbot knows the current value but durable state
  has not caught up yet
- if no `sessionId` is shown, clisbot has not saved or confirmed one yet
- that still does not by itself prove the live runner pane lacks a native
  session id

Current queue and recovery ordering rule:

- a queued prompt must not start just because an earlier observer was detached
- queued prompts wait until the prior logical run for that `sessionKey` is truly idle
- mid-run recovery callbacks are bound to the current logical run instance, not only the shared `sessionKey`
- this prevents stale recovery work from replaying old prompts or mutating a newer run that already started later on the same surface
- durable queued prompts live under `StoredSessionEntry.queues`
- stored queue items are the durable queue inventory; the runtime hydrates them
  into the same ordered drain used by chat-created queue items
- `/queue list` and `clisbot queues list` show pending items only
- queue clear removes pending items and does not interrupt a running prompt
- queue create is bounded by `control.queue.maxPendingItemsPerSession`, default
  `20` when omitted

## Current Stale Runner Cleanup

Runner residency is now separate from logical conversation continuity.

Current cleanup contract:

- the agents layer keeps one stored session entry per `sessionKey`
- a background cleanup loop checks stored sessions against the configured stale threshold
- if the backing tmux session is idle past that threshold, clisbot kills only the tmux session
- the stored `sessionId` remains in `session.storePath`
- the next inbound turn for that same `sessionKey` can recreate tmux and resume the prior AI CLI session when supported

Current config points are:

- `agents.defaults.session.staleAfterMinutes`
- `agents.list[].session.staleAfterMinutes`
- `control.sessionCleanup.enabled`
- `control.sessionCleanup.intervalMinutes`

Current meaning:

- `staleAfterMinutes: 0`
  - disable stale tmux cleanup for that agent
- `staleAfterMinutes: N`
  - kill the live tmux runner after `N` idle minutes
- `control.sessionCleanup.intervalMinutes`
  - how often the cleanup loop scans stored sessions

Current idle rule:

- cleanup uses clisbot session activity timestamps such as `updatedAt`
- cleanup skips sessions that are currently busy in the clisbot queue
- cleanup does not inspect tmux CPU usage or try to infer activity from pane output alone
- a long-running active turn is not stale just because the human stopped sending messages

## Backend-Specific Session Id Mechanics

This is the ownership split:

- `SessionService` owns the active `sessionKey -> sessionId` mapping
- `RunnerService` uses that mapping to launch, capture, or resume backend work
- `src/runners/tmux/*` contains tmux-only mechanics used by `RunnerService`

`SessionService` does not hardcode how a tool `sessionId` is obtained.

That backend-specific mechanism is expressed through runner config.

Current implementation note:

- `SessionMapping` now owns explicit-id minting plus continuity reads and
  writes in the agents layer
- `RunnerService` consumes that session-owned seam for startup, capture,
  resume, and `/new` flows instead of minting or clearing mappings directly
- read surfaces now show `sessionId` plus persistence annotation instead of
  treating persisted `storedSessionId` as the only truth surface
- ambiguous resume or `/new` capture failures now preserve the stored mapping
  instead of clearing it eagerly on weak evidence
- one notable follow-up still remains:
  - explicit session rebinding is still a planned control surface, not a
    shipped user command yet

Current runner session-id modes:

- `runner.sessionId.create.mode: "runner" | "explicit"`
- `runner.sessionId.capture.mode: "off" | "status-command"`
- `runner.sessionId.resume.mode: "off" | "command"`

The config key name `create.mode` is historical and easy to misread.

Read it as:

- who provides the initial `sessionId`
- not who canonically owns `sessionId`

If this still feels confusing, use this shorter reading rule:

- `create.mode: "runner"` really means:
  - the native tool creates the id and runner code later captures it
- `create.mode: "explicit"` really means:
  - `SessionService` chooses the id first and runner code launches with it

Current meaning:

- `create.mode: "runner"`
  - the native tool creates its own session id
- `capture.mode: "status-command"`
  - `SessionService` asks the runner to send a backend-safe status command
    such as `/status`
  - runner output is parsed to capture the session id without changing conversation identity
- `resume.mode: "command"`
  - when a stored `sessionId` exists, `SessionService` asks the runner to
    start with a dedicated resume command
- `create.mode: "explicit"`
  - `SessionService` generates or chooses the session id itself and passes it
    to the runner
  - this fits tools that accept `--session-id`

This runner seam is intentionally flexible:

- the `sessionId` source is either the native tool or `SessionService`
- runners provide backend-specific pass-through or capture or resume mechanics
- runners may accept a caller-supplied `sessionId` when the backend supports
  client-side session-id initialization or explicit resume
- `SessionService` still owns the durable `sessionKey -> active sessionId`
  mapping
- users and prompt authors should not manage backend compaction or
  conversation-storage details directly when the native CLI already owns them

## Current Codex Mapping

Current default Codex-style behavior is:

- `create.mode: "runner"`
- `create.args: []`
- `capture.mode: "status-command"`
- `capture.statusCommand: "/status"`
- `resume.mode: "command"`
- `resume.args: ["resume", "{sessionId}", ...]`

That means:

- first launch starts Codex normally
- clisbot asks Codex for `/status`
- the returned session id is stored under that `sessionKey`
- if the tmux session later dies, clisbot launches `codex resume <sessionId> ...`

## Future Claude-Style Mapping

The same contract already supports tools that accept explicit session ids.

Example shape:

- `create.mode: "explicit"`
- `create.args: ["--session-id", "{sessionId}"]`
- `capture.mode: "off"`
- `resume.mode: "off"`

That means:

- `SessionService` generates the session id
- every restart or recovery passes that same session id back to the tool
- a separate resume command is not required

## File-Level Reading Guide

If you are tracing implementation, read the files like this:

- `src/agents/session/session-service.ts`
  - session owner
  - decides whether to keep, replace, or clear the active mapping
- `src/agents/runtime/runner-service.ts`
  - runner-facing adapter used by `SessionService`
  - should not own continuity rules, even though current code still leaks some
    of that work here
- `src/runners/tmux/*`
  - tmux backend primitives only
  - no durable continuity ownership

## What Matches OpenClaw Well

- one `agentId` can own many conversations
- one `sessionKey` isolates one routed conversation
- session continuity is not tied to channel implementation details
- live process identity is separate from logical conversation identity

## What Is Still Missing

The session split now exists, but several lifecycle policies are still not implemented.

Current gaps:

- reset policy
  - chat `/new` now provides the first explicit runner conversation rotation path
  - broader automatic rotation policy remains intentionally unimplemented
- explicit cross-surface session loading
  - today a routed surface continues through its resolved `sessionKey`
  - if multiple surfaces already share the same `sessionKey` by routing policy, no extra session rebind is needed
  - a later authorized control path may need to load an existing `sessionId`
    onto a different routed surface when auth and agent policy allow it
- workspace-switch policy
  - a later session-loading path may need to change the active workspace
  - that should stay agent-policy-gated and not become an ambient chat default
- durable transcript ownership
  - `sessions.json` stores continuity metadata only
  - clisbot does not yet persist a full append-only transcript model per `sessionId`
- explicit resume diagnostics
  - if runner-side session-id capture fails, the session can still run, but resumability is not guaranteed

## Rules To Keep

- `agentId` chooses the owner
- `sessionKey` chooses the conversation bucket
- `sessionId` chooses the current tool-native conversation at this moment
- runner identity stays backend-specific

Do not collapse these back into one tmux-specific identifier.
