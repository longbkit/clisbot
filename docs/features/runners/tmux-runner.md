# tmux Runner

## Summary

The tmux runner is the current concrete runner implementation for `clisbot`.

It uses a dedicated tmux server and one or more sessions to host long-lived coding agents such as Codex CLI.

## Why This Document Exists

tmux is the current backend, but it is not the whole system model.

This document keeps tmux-specific mechanics inside `runners` so that:

- `agents` stays backend-agnostic
- `channels` do not depend on tmux internals
- future ACP or SDK runners can follow the same top-level contract

## Ownership

The tmux runner owns:

- tmux socket strategy
- tmux server bootstrap
- session, window, and pane access strategy
- sending input to the backend process
- capturing pane output
- normalizing tmux-derived output into the runner contract
- tmux-specific failure handling
- backend-specific session-id bootstrap behavior

The tmux runner does not own:

- canonical agent identity
- workspace policy
- channel-visible rendering
- operator control workflows

## Current Backend Shape

The current implementation model is:

- one dedicated tmux server for `clisbot`
- one tmux session per live runner instance for a resolved conversation session key
- one workspace path provided by higher layers for that session
- one CLI agent process running inside that session
- optional secondary windows inside that session for runner-owned execution surfaces such as reusable shell access

The runner should treat the workspace path, agent identity, and session key as inputs, not as tmux-owned concepts.

For AI CLI-backed runners, tmux is the host process boundary, not the canonical conversation boundary.

Current continuity split:

- the agents layer owns `sessionKey`
- the agents layer persists the current `sessionId`
- the tmux runner owns how that `sessionId` is created, captured, and reused for a concrete backend

## tmux Mechanics

## Socket Strategy

The tmux runner should use a dedicated socket path for this project instead of the user's default tmux server.

Current expected path:

- `~/.clisbot/state/clisbot.sock`

This isolation matters so that:

- project sessions do not mix with the user's personal tmux sessions
- operators know exactly which server to inspect
- control workflows can target one predictable backend

## Session Naming

Session naming should be stable and derived from the resolved session key.

That stability is required for:

- operator attach flows
- restart flows
- reliable routing from higher layers

That said, tmux session naming should be treated as runner identity, not as the canonical persisted conversation id.

Current default naming rule:

- `agents.defaults.session.name: "{sessionKey}"`
- the rendered name is normalized into a tmux-safe form by replacing every non-alphanumeric character with `-`

This keeps names readable and tmux-safe, but it is not a strict reversible encoding of `sessionKey`.

The important distinction is:

- `sessionKey`
  - logical conversation bucket
- AI CLI `sessionId`
  - active tool-native conversation id
- tmux session name
  - current live process host used to drive that tool conversation

## Bootstrap Flow

The tmux runner should:

1. ensure the dedicated tmux server exists
2. create the required session if it does not exist
3. start the configured CLI agent process in the provided workspace
4. detect initial trust or setup prompts when relevant
5. reach a ready state before normal prompt submission

When the underlying AI CLI supports session resume, bootstrap should have two modes:

1. fresh start
2. resume existing AI CLI `sessionId`

The runner should not assume that "new tmux session" means "new conversation."

Current implemented bootstrap paths are:

- runner-generated session id
  - start the tool normally
  - issue a status command such as `/status`
  - parse the returned session id
  - persist it for later resume
- explicit session id
  - generate a UUID before launch
  - inject it into runner args such as `--session-id {sessionId}`
  - reuse that same id on later restart

## Input Submission

The tmux runner should accept normalized input from higher layers and translate it into tmux actions safely.

Examples of tmux-specific mechanics include:

- targeting the correct pane
- sending keystrokes or pasted text
- submitting the final enter action

Those mechanics must stay inside the runner boundary.

## Snapshot And Streaming Capture

The tmux runner should capture the current visible state of the session and expose it as:

- a current snapshot
- ordered output updates
- a full current session view when higher layers explicitly request transcript inspection

The runner should not expose raw tmux capture as the only contract.

It should normalize pane-derived output into one backend-neutral runner format that channels and `agents` can consume.

## tmux-Specific Quirks

Known or expected tmux-backed CLI quirks include:

- trust prompts on first use
- partial redraws
- repeated terminal banners
- output that reflows as the pane changes
- visible prompts that remain on screen after the answer is complete

These quirks belong in runner normalization logic, not in channel code.

## Trust Prompt Handling

For CLI agents such as Codex, first-run trust prompts may block the first real user request.

The tmux runner should own the backend-specific handling needed to:

- detect the prompt
- submit the configured trust action when allowed
- continue into the real prompt flow cleanly

## Failure Modes

The tmux runner should surface clear backend failures such as:

- socket creation failure
- session creation failure
- missing tmux binary
- pane capture failure
- backend CLI crash or exit
- stuck trust or bootstrap state

These should surface as runner failures, not as silent channel timeouts.

One especially important failure mode is sudden tmux-session loss while the underlying conversation should still be resumable.

For runners backed by AI CLIs with resumable session ids, the preferred recovery path is:

1. detect missing tmux runner
2. create a new tmux runner instance
3. resume the previous AI CLI `sessionId`
4. continue the conversation on the same `sessionKey`

If that resume path fails, the system should surface that truthfully rather than silently pretending continuity still exists.

Current clisbot behavior is narrower than the full ideal:

- if a stored `sessionId` exists and `resume.mode` is configured, the runner uses that resume command
- if `create.mode` is `explicit`, the runner relaunches with the same explicit session id
- if a stored `sessionId` cannot be brought back for the current `sessionKey`, clisbot clears that continuity entry and starts a fresh tool session
- if session-id capture never completes, the session can still run, but restart falls back to a fresh tool conversation

## Runner Sunsetting

tmux session lifetime should be managed separately from conversation lifetime.

Recommended behavior:

- keep the tmux session alive while the conversation is active
- sunset or evict the tmux session after an inactivity window
- preserve enough session metadata so the next inbound message can recreate the tmux runner and resume the same AI CLI `sessionId` when supported

This avoids both bad extremes:

- keeping every old tmux session forever
- resetting the conversation just to reclaim tmux resources

Current implementation:

- the cleanup loop is scheduled by Agents
- each session resolves the stale threshold from:
  - `agents.defaults.session.staleAfterMinutes`
  - or `agents.list[].session.staleAfterMinutes`
- the global scan cadence comes from:
  - `control.sessionCleanup.enabled`
  - `control.sessionCleanup.intervalMinutes`
- when a session is stale, clisbot kills the tmux session only
- the stored `sessionKey -> sessionId` continuity entry remains
- the next inbound message can recreate tmux and resume the prior AI CLI session when the runner supports resume
- stale detection is based on clisbot session activity timestamps for ordinary idle sessions
- when a turn exceeds the configured `maxRuntimeMin` or `maxRuntimeSec`, clisbot detaches observation, leaves the tmux session running, and marks that session as exempt from stale cleanup until a later interactive turn or stop action clears that exemption
- sessions that are currently busy in the clisbot queue are skipped by cleanup

Current disable rule:

- `staleAfterMinutes: 0` disables stale cleanup for that agent

## Relationship To Presentation

The tmux runner is the source of normalized transcript data for tmux-backed sessions.

Current completion rule:

- pane-state observation is the source of truth
- if a live runner timer is still visible in the pane, the turn is still active
- if the pane stays unchanged for `idleTimeoutMs` and no active timer remains, the turn is treated as completed
- this includes very fast turns where no timer ever had time to appear before the pane became idle again

It does not decide how normal interaction is rendered to users.

Default interaction should be rendered as chat-first output by `channels`.

Full session visibility should be returned only when a channel or control command explicitly requests transcript inspection.

That rendering decision belongs to `channels` and `control` and is defined by [transcript presentation and streaming](../../architecture/transcript-presentation-and-streaming.md).

## Related Docs

- [Runners Feature](README.md)
- [Runtime Architecture](../../architecture/runtime-architecture.md)
- [Transcript Presentation And Streaming](../../architecture/transcript-presentation-and-streaming.md)
- [Runner Tests](../../tests/features/runners/README.md)
