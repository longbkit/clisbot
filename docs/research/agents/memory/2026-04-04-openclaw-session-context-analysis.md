# OpenClaw Session And Context Analysis

## Historical Note

This document captures early OpenClaw-oriented research.

It is useful for understanding why some older `clisbot` docs discussed `channel` versus `group` session buckets, but it is not the current `clisbot` naming contract.

For current `clisbot`, use:

- `README.md`
- `docs/architecture/surface-architecture.md`
- `docs/user-guide/channels.md`

Compatibility note:

- examples such as `agent:<agentId>:<channel>:group:<id>` and `agent:<agentId>:<channel>:channel:<id>` in this doc are OpenClaw research examples
- current `clisbot` operator naming standardizes multi-user surfaces around `group:<id>` and `topic:<chatId>:<topicId>`
- Slack `channel:<id>` remains compatibility input only in current `clisbot`

## Summary

This document captures the initial analysis of how OpenClaw organizes session state, conversation transcripts, workspace context, and durable memory.

It is research first, not a final `clisbot` architecture contract.

## Status

Done

## Why This Exists

`clisbot` is moving toward OpenClaw-compatible session concepts.

Before copying folder layouts or config names, we need to separate:

- what OpenClaw clearly treats as conversation-local state
- what OpenClaw clearly treats as agent-global durable state
- what appears to be shared memory versus per-user memory
- where the docs and code appear to disagree

## Source References

- [OpenClaw Session Management](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/session.md)
- [OpenClaw Memory](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/memory.md)
- [OpenClaw Agent Runtime](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/agent.md)
- [OpenClaw Agent Workspace](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/agent-workspace.md)
- [OpenClaw workspace bootstrap loader](https://github.com/openclaw/openclaw/blob/develop/src/agents/workspace.ts)
- [OpenClaw bootstrap context resolver](https://github.com/openclaw/openclaw/blob/develop/src/agents/bootstrap-files.ts)
- [OpenClaw system prompt builder](https://github.com/openclaw/openclaw/blob/develop/src/agents/system-prompt.ts)
- [OpenClaw memory search config resolver](https://github.com/openclaw/openclaw/blob/develop/src/agents/memory-search.ts)
- [OpenClaw memory search tool](https://github.com/openclaw/openclaw/blob/develop/src/agents/tools/memory-tool.ts)
- [OpenClaw builtin memory index manager](https://github.com/openclaw/openclaw/blob/develop/src/memory/manager.ts)
- [OpenClaw builtin session transcript sync](https://github.com/openclaw/openclaw/blob/develop/src/memory/sync-session-files.ts)
- [OpenClaw session transcript file reader](https://github.com/openclaw/openclaw/blob/develop/src/memory/session-files.ts)
- [OpenClaw QMD backend config](https://github.com/openclaw/openclaw/blob/develop/src/memory/backend-config.ts)
- [OpenClaw QMD memory manager](https://github.com/openclaw/openclaw/blob/develop/src/memory/qmd-manager.ts)
- [OpenClaw session entry type](https://github.com/openclaw/openclaw/blob/develop/src/config/sessions/types.ts)
- [OpenClaw session store paths](https://github.com/openclaw/openclaw/blob/develop/src/config/sessions/paths.ts)

## Core Model

OpenClaw has two different state layers:

1. conversation-local state
2. agent-global durable state

The clean mental split is:

- sessions answer: "what does this conversation remember?"
- workspace memory answers: "what does this agent remember across conversations?"

## Important Overview

Before separating session memory from workspace memory, it helps to lock the core session terms:

- `sessionKey` is the stable logical conversation identity
- `sessionId` is the current concrete transcript instance for that conversation

Short version:

- `sessionKey` answers: "which chat or thread bucket does this message belong to?"
- `sessionId` answers: "which active JSONL transcript is currently backing that bucket?"

The relationship is:

- `sessionKey -> session entry in sessions.json -> current sessionId -> transcript JSONL file`

This distinction matters because:

- isolation is mostly about `sessionKey`
- active conversation continuity is mostly about `sessionId`
- workspace memory is a separate state layer from both

## Conversation-Local State

OpenClaw stores conversation-local state under:

- `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`

What each piece means:

- `sessions.json`
  - session index keyed by `sessionKey`
  - metadata such as `sessionId`, `updatedAt`, `chatType`, `origin`, delivery hints, token accounting, model overrides, and compaction state
- `<sessionId>.jsonl`
  - transcript for one concrete session id
  - the actual turn history used for conversation continuity

In practice, per-user, per-channel, and per-thread context is represented mainly by:

- the `sessionKey`
- the transcript JSONL
- the `origin` and delivery metadata stored in the session entry

## Session Key Semantics

OpenClaw separates `agentId` from `sessionKey`.

Important behavior from the session model:

- direct chats use `session.dmScope`
- groups get isolated `group` keys
- channels get isolated `channel` keys
- threads and topics extend a parent session key

Examples:

- `agent:<agentId>:main`
- `agent:<agentId>:dm:<peerId>`
- `agent:<agentId>:<channel>:group:<id>`
- `agent:<agentId>:<channel>:channel:<id>`
- thread or topic suffixes for thread-isolated conversations

These examples describe the researched OpenClaw model, not the current `clisbot` operator contract.

This means thread context is not a separate memory file.

It is primarily:

- a session-key boundary
- a transcript boundary

## Agent-Global Durable State

OpenClaw stores durable agent state in the workspace, not in the session store.

Typical workspace files:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `BOOTSTRAP.md`
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

These files are shared by the agent unless a deployment intentionally separates workspaces.

They are not per-user by default.

## Practical Meaning Of Workspace Memory

OpenClaw memory is plain Markdown in the workspace.

Intended usage:

- durable preferences, long-lived facts, and standing decisions go to `MEMORY.md`
- daily notes and short-lived operational context go to `memory/YYYY-MM-DD.md`

This is agent memory, not automatically user memory.

So if one agent serves many people, workspace memory is a shared memory surface unless explicitly segmented by deployment design.

## Relationship Between Session And Workspace

Short version:

- session transcripts provide local continuity
- workspace files provide durable cross-session continuity

Examples:

- "what were we discussing in this thread?"
  - mainly session transcript territory
- "the user prefers terse replies"
  - should move into durable memory if that preference should survive session resets
- "today we decided to use runner X"
  - could live in daily memory
- "private user-specific fact"
  - dangerous if written into shared workspace memory for a multi-user agent

## Privacy And Leakage Risks

OpenClaw has two separate leak surfaces:

### 1. Session leak

If `session.dmScope` is too broad, different people can share one DM context.

The default `dmScope: "main"` is continuity-first, not privacy-first.

That is convenient for one-user personal bot setups, where Slack DM, Telegram DM, and similar direct surfaces intentionally feel like one ongoing conversation with the same owner.

It is risky for shared inboxes, multi-user bots, or multi-account DM surfaces.

### 2. Workspace leak

Even if session keys are isolated, durable notes written into workspace memory can still be shared across conversations because the workspace is agent-global.

This is a separate design problem from transcript isolation.

## What Appears Confirmed

The following appears clear from OpenClaw docs and code:

- session files and workspace files are different state systems
- `sessions.json` is metadata indexed by `sessionKey`
- JSONL transcripts hold concrete turn history
- session keys define the isolation boundary for direct, group, channel, and thread-style conversations
- workspace files are loaded as agent context and function as durable shared memory
- memory search tools are designed to retrieve from `MEMORY.md` and `memory/*.md`
- session transcripts can optionally be indexed into memory search as a separate retrieval surface

## Memory Search Scope And Session Recall

OpenClaw's `memory_search` is not automatically "session search."

The search surface depends on backend and config.

### Builtin memory search

Builtin memory search defaults to the `memory` source only.

That means the default search surface is:

- `MEMORY.md`
- `memory/*.md`
- optional extra Markdown paths if configured

Session transcript search is not on by default.

To enable session transcript indexing for the builtin backend, both of these must be true:

- `memorySearch.sources` includes `"sessions"`
- `memorySearch.experimental.sessionMemory` is `true`

Example:

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        sources: ["memory", "sessions"],
        experimental: {
          sessionMemory: true
        }
      }
    }
  }
}
```

### QMD memory search

QMD also defaults to workspace memory, not session transcripts.

Its default search surface is:

- `MEMORY.md`
- `memory/**/*.md`
- optional extra Markdown collections under `memory.qmd.paths`

Session transcript search is opt-in under QMD.

To enable session transcript recall for QMD:

- set `memory.backend = "qmd"`
- set `memory.qmd.sessions.enabled = true`

Example:

```json5
{
  memory: {
    backend: "qmd",
    qmd: {
      sessions: {
        enabled: true
      }
    }
  }
}
```

QMD also has a `scope` gate.

That gate controls whether memory search is allowed for a chat type, channel, or key prefix.

It does not appear to be a per-session-document isolation rule.

#### How QMD scope actually works

QMD `scope` uses the same rule shape as `session.sendPolicy`.

The matching fields are broad routing fields:

- `chatType`
  - broad conversation kind such as direct, group, or channel
- `channel`
  - transport/provider such as Slack, Discord, or Telegram
- `keyPrefix`
  - plain string prefix match against the full `sessionKey`

What this means in practice:

- `chatType: "direct"`
  - allows QMD memory search for all direct chats
- `channel: "slack"`
  - allows QMD memory search for all Slack conversations
- `keyPrefix: "agent:main:slack:"`
  - allows QMD memory search for all session keys under that prefix

What it does not mean:

- it does not select only transcript documents from the exact current `sessionKey`
- it does not appear to tag and filter QMD session documents by exact session ownership at query time

So QMD `scope` should be understood as:

- who may query the QMD memory surface

not:

- which transcript documents inside the QMD memory surface are eligible to match

### Current leakage implication

From the code, once session transcript indexing is enabled, OpenClaw does not appear to limit memory search results to only the current `sessionKey`.

Builtin path:

- indexes all JSONL transcript files for the agent
- accepts `sessionKey` at query time
- does not appear to filter retrieved transcript hits by current `sessionKey`

QMD path:

- exports all retained transcript files for the agent into the QMD session collection
- accepts `sessionKey` at query time
- uses that key for scope gating, not for per-session result filtering

So the current truthful reading is:

- by default, `memory_search` is mainly for workspace memory
- session transcript recall is opt-in
- once enabled, transcript recall appears to be agent-wide within the indexed transcript set, not current-session-only

This is important because "session transcript search enabled" is not the same thing as "safe recall only within this conversation boundary."

## What Appears Ambiguous Or In Tension

There is an important docs-versus-code tension around memory loading:

- docs say `MEMORY.md` should only load in the main private session and not in group contexts
- the workspace bootstrap loader appears to include memory files in the bootstrap file set for normal sessions and only filters subagents explicitly

That means one of these is true:

1. another later stage filters memory files by chat type before prompt injection
2. the docs describe intended behavior, but the current runtime is broader than the docs claim

This should be verified before `clisbot` copies the behavior.

## Implications For clisbot

If `clisbot` wants to align with OpenClaw, it should not copy only the folder names.

It needs explicit design decisions for:

- transcript isolation
- durable memory ownership
- per-user versus per-agent memory
- whether group or channel contexts may read or write durable memory
- whether transcript retrieval should be treated as memory or as session inspection

## Implicit Questions That Must Be On The Table

Before implementation, these questions should be explicit:

- What is the privacy boundary: per agent, per user, per channel, per thread, or mixed?
- Is durable workspace memory shared across all users of one agent?
- Should per-user durable memory exist separately from agent-global memory?
- What should survive a session reset: transcript only, memory only, or both?
- Should group and channel sessions be allowed to load or write long-term memory?
- Should transcript recall be a first-class retrieval source or stay separate from durable memory?
- Should thread context be a child of channel context or a fully isolated conversation bucket?
- Which defaults optimize for continuity, and which optimize for privacy?

## Recommended Follow-Up Work

This analysis suggests the next `clisbot` design work should produce:

1. a `clisbot` session-context contract
2. a durable memory ownership model
3. a privacy model for multi-user agents
4. a decision on whether transcript retrieval and durable memory should stay separate
5. a truthful rule for what bootstrap memory is injected into which chat types

## Current Conclusion

OpenClaw should be understood as:

- session store = conversation state
- workspace memory = durable shared agent state
- session key = transcript isolation boundary
- workspace design = long-term memory sharing boundary

That distinction is the minimum model `clisbot` should carry forward into its own session and context architecture.
