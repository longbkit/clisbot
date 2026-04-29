# Session Identity

## Purpose

This document defines the current session model used by `clisbot`.

It stays close to OpenClaw's `agentId` plus `sessionKey` mental model, but adapts it to subscription-backed AI CLIs such as Codex, Claude Code, and Gemini CLI where the tool already has its own native conversation id.

## Current Contract

`clisbot` currently owns three different identities:

- `agentId`
  - durable agent owner
  - selects workspace, defaults, tools, skills, and policy
- `sessionKey`
  - durable logical conversation key
  - isolates queueing, routing, and continuity for one DM, group, channel, or thread
- `sessionId`
  - current active AI CLI conversation id for that `sessionKey`
  - persisted in `~/.clisbot/state/sessions.json`

The runner owns the live execution handle:

- tmux session name
  - current tmux host for that conversation
  - replaceable if tmux dies

The important rule is:

- tmux session name is not the canonical conversation identity

Current tmux naming rule:

- tmux session name is the `sessionKey` normalized into a tmux-safe name by replacing every non-alphanumeric character with `-`
- this keeps names readable and practical for operator use
- it is deterministic, but not a strict reversible one-to-one encoding
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

1. channels resolve one `agentId` and one `sessionKey`
2. the agents layer resolves workspace and runner config
3. the agents layer checks whether that `sessionKey` already has a stored `sessionId`
4. runner bootstrap decides whether to start fresh or resume
5. tmux hosts the live runner process for that session

Current recovery rule:

- if tmux still exists, continue using the live process
- if the tmux runner was sunset as stale, keep the stored session entry and logical conversation identity
- if tmux is gone but a stored `sessionId` exists, start a new runner and reuse that `sessionId` when the runner supports it
- if that stored `sessionId` is no longer attachable for this `sessionKey`, preserve the mapping and fail truthfully instead of silently starting a new tool conversation
- if no `sessionId` is available, start a fresh runner session
- `/new` is the explicit operator path for triggering a new runner conversation and storing the new active `sessionId`

Current queue and recovery ordering rule:

- a queued prompt must not start just because an earlier observer was detached
- queued prompts wait until the prior logical run for that `sessionKey` is truly idle
- mid-run recovery callbacks are bound to the current logical run instance, not only the shared `sessionKey`
- this prevents stale recovery work from replaying old prompts or mutating a newer run that already started later on the same surface

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

## Runner-Owned Session Id Behavior

The agents layer does not hardcode how a tool session id is obtained.

That is a runner concern expressed in config.

Current runner session-id modes:

- `runner.sessionId.create.mode: "runner" | "explicit"`
- `runner.sessionId.capture.mode: "off" | "status-command"`
- `runner.sessionId.resume.mode: "off" | "command"`

Current meaning:

- `create.mode: "runner"`
  - the tool creates its own session id
- `capture.mode: "status-command"`
  - clisbot sends a status command such as `/status`
  - runner output is parsed to capture the session id
- `resume.mode: "command"`
  - when a stored `sessionId` exists, the runner starts with a dedicated resume command
- `create.mode: "explicit"`
  - clisbot generates a UUID itself and passes it to the runner
  - this fits tools that accept `--session-id`

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

- clisbot generates the session id
- every restart passes that same session id back to the tool
- a separate resume command is not required

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
- durable transcript ownership
  - `sessions.json` stores continuity metadata only
  - clisbot does not yet persist a full append-only transcript model per `sessionId`
- explicit resume diagnostics
  - if runner-side session-id capture fails, the session can still run, but resumability is not guaranteed

## Rules To Keep

- `agentId` chooses the owner
- `sessionKey` chooses the conversation bucket
- `sessionId` chooses the current tool-native conversation
- runner identity stays backend-specific

Do not collapse these back into one tmux-specific identifier.
