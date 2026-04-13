# OpenClaw Session Compaction Analysis

## Summary

This research captures how OpenClaw handles long conversations when compaction is triggered, with emphasis on:

- whether the `sessionId` changes
- whether the transcript file changes
- what compaction persists into JSONL history
- which design techniques matter for `clisbot`

It is research first, not a final `clisbot` architecture contract.

## Important Overview

Before reading the compaction details, the most important OpenClaw session concept is:

- `sessionKey` is the stable logical conversation identity
- `sessionId` is the current concrete transcript instance for that conversation

Short version:

- `sessionKey` answers: "which DM, channel, group, or thread does this message belong to?"
- `sessionId` answers: "which active transcript file and context window is that conversation using right now?"

The practical relationship is:

- `sessionKey -> session entry in sessions.json -> current sessionId -> transcript JSONL file`

Examples:

- a Slack channel can map to a key like `agent:main:slack:channel:c123`
- a Slack thread can map to a key like `agent:main:slack:channel:c123:thread:456`
- the current active transcript behind that key is then identified by `sessionId`

Why this matters for compaction:

- compaction normally preserves the same `sessionKey`
- compaction normally also preserves the same `sessionId`
- reset and expiry may keep the same `sessionKey` but rotate to a new `sessionId`

So `sessionKey` is the routing and isolation boundary, while `sessionId` is the active transcript/runtime continuity boundary.

## Status

Done

## Source References

- [OpenClaw Compaction Concept](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/compaction.md)
- [OpenClaw Session Management And Compaction Deep Dive](https://github.com/openclaw/openclaw/blob/develop/docs/reference/session-management-compaction.md)
- [OpenClaw session initialization](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/session.ts)
- [OpenClaw embedded compaction runtime](https://github.com/openclaw/openclaw/blob/develop/src/agents/pi-embedded-runner/compact.ts)
- [OpenClaw compaction count store update](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/session-updates.ts)
- [OpenClaw manual compact command](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/commands-compact.ts)
- [OpenClaw session entry type](https://github.com/openclaw/openclaw/blob/develop/src/config/sessions/types.ts)
- [OpenClaw session transcript path resolver](https://github.com/openclaw/openclaw/blob/develop/src/config/sessions/paths.ts)
- [OpenClaw compaction failure reset test](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/agent-runner.heartbeat-typing.runreplyagent-typing-heartbeat.retries-after-compaction-failure-by-resetting-session.test.ts)
- [OpenClaw overflow compaction retry test](https://github.com/openclaw/openclaw/blob/develop/src/agents/pi-embedded-runner/run.overflow-compaction.test.ts)

## Core Finding

Successful compaction in OpenClaw appears to keep the same conversation bucket and the same active transcript file.

The normal model is:

- same `sessionKey`
- same `sessionId`
- same `sessionFile`
- same JSONL transcript file
- new persisted compaction state inside that transcript

The main exception is compaction failure recovery.

If compaction itself fails because the session is too large or otherwise broken, OpenClaw may reset the session and mint a new `sessionId`.

## What Changes And What Does Not

### Conversation bucket

The conversation bucket is still keyed by `sessionKey`.

Compaction does not represent a new routed conversation.

Reset and expiry logic create a new `sessionId`, but ordinary compaction does not.

### Session id

OpenClaw reuses the existing `sessionId` when the session is still fresh in [session.ts](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/session.ts#L225).

It only generates a new `sessionId` when:

- the session is new
- a reset is triggered
- the old session is no longer fresh

That is visible in [session.ts](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/session.ts#L235).

Compaction itself runs against the passed-in `sessionId` and `sessionFile` in [compact.ts](https://github.com/openclaw/openclaw/blob/develop/src/agents/pi-embedded-runner/compact.ts#L361).

### Session file

The transcript path is derived from `sessionId` in [paths.ts](https://github.com/openclaw/openclaw/blob/develop/src/config/sessions/paths.ts#L33).

The standard path is:

- `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`

Compaction opens the existing `sessionFile` with `SessionManager.open(params.sessionFile)` in [compact.ts](https://github.com/openclaw/openclaw/blob/develop/src/agents/pi-embedded-runner/compact.ts#L375).

Manual `/compact` also passes the current session file into the same compaction runtime in [commands-compact.ts](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/commands-compact.ts#L67).

That means manual and automatic compaction use the same in-place transcript.

## What Persists In The Transcript

OpenClaw documents transcripts as append-only JSONL with a tree structure in [session-management-compaction.md](https://github.com/openclaw/openclaw/blob/develop/docs/reference/session-management-compaction.md).

The same doc says a transcript can contain a persisted `compaction` entry with:

- `summary`
- `firstKeptEntryId`
- `tokensBefore`

The higher-level compaction doc also states that compaction:

- summarizes older conversation
- stores the summary in session history
- keeps recent messages intact
- persists in the session JSONL history

See [compaction.md](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/compaction.md).

## Important Interpretation

From the docs and the append-only transcript description, OpenClaw compaction appears to be primarily a logical compaction, not a file-rotation or transcript-splitting scheme.

That means:

- the JSONL file stays the same
- old entries are not described as being physically moved into a second transcript
- future context reconstruction uses the compaction summary plus messages after `firstKeptEntryId`

This is an inference from the documented transcript model and the way OpenClaw reopens the same session file for compaction.

It should not be overstated beyond that.

## Store-Level Effects

After successful compaction, OpenClaw increments `compactionCount` in the session store in [session-updates.ts](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/session-updates.ts#L265).

It may also update cached token counts with post-compaction estimates.

Relevant session-store fields include:

- `compactionCount`
- `memoryFlushAt`
- `memoryFlushCompactionCount`

Those are present in [types.ts](https://github.com/openclaw/openclaw/blob/develop/src/config/sessions/types.ts#L63).

So compaction is visible both:

- inside the transcript
- inside `sessions.json`

## Auto-Compaction Triggers

The docs describe two main paths:

1. overflow recovery
2. threshold maintenance near the context window

OpenClaw also supports a pre-compaction memory flush turn before the actual compaction happens.

That memory flush is a separate technique from compaction itself.

## Failure Path

The main exception to "same session id, same file" is compaction failure recovery.

If context overflow happens and compaction cannot recover the session, OpenClaw may reset the conversation to a fresh session.

The failure-reset tests explicitly assert that the new store entry gets a different `sessionId` and the old transcript path is removed in [agent-runner.heartbeat-typing.runreplyagent-typing-heartbeat.retries-after-compaction-failure-by-resetting-session.test.ts](https://github.com/openclaw/openclaw/blob/develop/src/auto-reply/reply/agent-runner.heartbeat-typing.runreplyagent-typing-heartbeat.retries-after-compaction-failure-by-resetting-session.test.ts).

So the truthful split is:

- successful compaction
  - same `sessionId`
  - same transcript file
  - new compaction state persisted in the same session history
- compaction failure recovery
  - reset to a new `sessionId`
  - old transcript may be deleted
  - user sees a reset-style recovery message

## Techniques Worth Bringing To The Table

These are the main design ideas OpenClaw uses that matter for `clisbot`.

### 1. Logical compaction instead of transcript rotation

OpenClaw appears to preserve one active transcript file per session and encode compaction as transcript state, instead of splitting one long conversation into many files.

This preserves:

- continuity
- stable inspection path
- a single source of truth for one session's history

Questions for `clisbot`:

- Do we want one stable transcript per session, or transcript segments after each compaction?
- Do operators prefer one file for debugging, or explicit segments for archival clarity?

### 2. Summary plus cut-point model

Compaction is not just "drop the old stuff."

The important persisted state is:

- compaction summary
- `firstKeptEntryId`

That means the runtime can reconstruct a compacted conversation boundary without pretending the older branch never existed.

Questions for `clisbot`:

- If we compact tmux transcript state, what is the equivalent of `firstKeptEntryId`?
- Do we need a structured cut-point marker in our own transcript model?

### 3. Separate routing identity from transcript identity

OpenClaw separates:

- `sessionKey`
- `sessionId`

That makes it possible to keep one conversation bucket while occasionally rotating to a new transcript on reset or expiry.

Questions for `clisbot`:

- Should one Slack thread map to one stable `sessionKey` but sometimes rotate transcript ids under it?
- Should transcript ids exist independently from runner instance ids or tmux pane ids?

### 4. Compaction success and compaction failure are different lifecycle events

OpenClaw treats:

- successful compaction
- compaction-triggered reset

as different outcomes.

That is operationally important.

Questions for `clisbot`:

- What should users see when compaction succeeds?
- What should users see when compaction fails and the system must reset?
- Should transcript continuity be preserved after failed compaction, or should we intentionally cut over to a new session?

### 5. Pre-compaction housekeeping

OpenClaw tries to do durable-memory writes before compaction.

That means the real model is not just "compact when too big."

It is:

1. detect approaching threshold
2. optionally flush durable memory
3. compact if needed
4. retry the run

Questions for `clisbot`:

- Do we need a pre-compaction hook for agent memory, transcript snapshots, or operator markers?
- Which backends can support that reliably?

### 6. Compaction is different from pruning

OpenClaw distinguishes:

- compaction
  - persistent
- pruning
  - in-memory only

That separation is useful and should stay explicit in design discussions.

Questions for `clisbot`:

- Do we need both a persistent compaction model and a lighter transient pruning model?
- Which layer should own each one: runner, session model, or channel delivery pipeline?

## Current Conclusion

The most truthful current reading is:

- OpenClaw compaction normally keeps the same `sessionId`
- it uses the same active JSONL transcript file
- it persists compaction state inside that transcript rather than splitting the conversation into a new transcript file
- the main exception is compaction failure recovery, where OpenClaw may reset the session and create a new `sessionId`

That distinction should be explicit in any `clisbot` discussion about long-session handling.
