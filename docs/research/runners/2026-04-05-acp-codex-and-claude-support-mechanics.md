# ACP Codex And Claude Support Mechanics

## Goal

Capture what technically powers the features exposed by `codex-acp` and `claude-agent-acp`.

This note exists to separate protocol facts from product assumptions before `muxbot` chooses between tmux capture, CLI JSON streaming, ACP, or SDK-backed runners.

## Repos Reviewed

- `https://github.com/zed-industries/codex-acp`
- `https://github.com/agentclientprotocol/claude-agent-acp`
- `https://agentclientprotocol.com/protocol/overview`
- `https://agentclientprotocol.com/protocol/prompt-turn`
- `https://agentclientprotocol.com/protocol/schema`

## Main Finding

Both projects get their capabilities from structured backend integrations, not from tmux scraping.

ACP provides the common control protocol:

- session creation and loading
- prompt submission
- streaming updates
- cancellation
- permission requests
- tool calls
- optional terminal lifecycle and terminal output methods

That means feature support is mostly a result of how each adapter maps its native backend into ACP messages.

## ACP Capability Layer

ACP appears to be the shared transport and lifecycle contract that makes these features portable across agent backends:

- `session/new`
- `session/load`
- `session/prompt`
- `session/update`
- `session/cancel`
- `session/request_permission`
- terminal methods such as create, output, and kill when the backend exposes them

This is the main reason ACP-backed integrations can expose structured streaming, permissions, and cancellation without terminal parsing.

## codex-acp Mechanics

`codex-acp` is a Rust adapter built on native Codex crates.

The reviewed crate dependencies show that it uses:

- `agent-client-protocol`
- `codex-core`
- `codex-protocol`
- `codex-login`
- `codex-exec-server`

The implementation appears to map ACP sessions onto native Codex thread management rather than onto a terminal session.

Observed mechanics from the source:

- ACP `SessionId` is mapped from Codex `ThreadId`
- session creation and loading are handled through Codex thread management
- client MCP servers can be merged into Codex config before session startup
- streaming is driven by native Codex protocol events rather than pane diffs
- cancellation is explicitly implemented in the adapter thread flow
- permission handling is wired through explicit permission request and resolution events

The imported Codex event types include content deltas, reasoning deltas, command output deltas, tool-call begin and end events, turn lifecycle events, and permission events.

That strongly suggests that `codex-acp` gets its rich UX from native Codex event streams.

## claude-agent-acp Mechanics

`claude-agent-acp` is a TypeScript adapter built on the official Claude Agent SDK.

The reviewed package dependencies show that it uses:

- `@agentclientprotocol/sdk`
- `@anthropic-ai/claude-agent-sdk`

The adapter appears to rely on Claude Agent SDK session and query APIs instead of parsing Claude CLI terminal output.

Observed mechanics from the source:

- session listing and history loading come from SDK session APIs
- prompt execution is driven through SDK query APIs
- permission mode and tool-allowance types come from the SDK
- interrupt state is tracked with explicit cancellation state and `AbortController`
- tool output is translated into ACP content blocks and `_meta` payloads
- terminal-related metadata such as terminal info, output, and exit are surfaced as structured events

That suggests `claude-agent-acp` gets its capabilities from a native agent SDK plus ACP as the outer protocol.

## What ACP Actually Adds

ACP does not appear to be the source of intelligence or session memory itself.

Instead, ACP provides:

- one standard session model
- one standard streaming model
- one standard permission handshake
- one standard cancellation path
- one standard tool and terminal envelope

The backend-specific adapter still determines how much real power exists behind those methods.

In practice:

- `codex-acp` gets its power from native Codex threads and events
- `claude-agent-acp` gets its power from the Claude Agent SDK
- ACP makes both look similar to an ACP client

## Implications For muxbot

This research suggests four distinct integration strategies:

### 1. tmux capture

Strengths:

- strong compatibility with arbitrary CLIs
- easy prompt injection during a live run
- easy ad hoc steering with extra input or terminal control keys such as `Esc`

Costs:

- noisy transcript normalization
- weaker structured lifecycle and permission semantics
- harder backend-neutral streaming contract

### 2. CLI JSON streaming

Strengths:

- structured events without full ACP adoption
- native session or resume identifiers may already exist
- likely easier than tmux pane scraping for chat-first rendering

Unknowns still worth testing:

- whether interrupt is first-class or only process kill
- whether on-the-go steering matches tmux prompt injection
- whether terminal and tool activity are exposed with enough structure

### 3. ACP adapter

Strengths:

- standard session, streaming, permission, and cancel contract
- backend-neutral client integration path
- better fit for future non-tmux runners

Costs:

- requires an ACP-capable backend adapter
- feature quality still depends on backend-native support
- may not match tmux-style steering unless the backend exposes a real mid-turn control primitive

### 4. vendor SDK

Strengths:

- most native feature access when officially supported
- strongest chance of precise session and event control

Costs:

- backend-specific implementation
- possible policy or product restrictions
- weaker long-term portability across vendors

## Current Working Conclusion

ACP looks valuable as a standard runner contract and control surface.

But ACP alone does not prove that `muxbot` can safely replace the current tmux method for interrupt and live steering.

That still depends on whether the backend exposes:

- true cancel semantics
- resume semantics
- structured tool and terminal events
- an input or steering method during a live turn, or at least a reliable interrupt plus follow-up turn path

For `muxbot`, the current tmux runner still has one practical advantage that the research does not yet disprove:

- it already supports interruption and steering by injecting prompt text or sending terminal control keys

## Recommended Follow-Up

The next runner research should verify, with real commands where possible:

- Codex CLI JSON mode interrupt behavior
- Codex CLI JSON mode resume and session id behavior
- Claude CLI stream-json interrupt behavior
- Claude CLI stream-json resume and session id behavior
- whether ACP-backed Codex or Claude sessions support anything stronger than cancel plus next-turn follow-up

## Sources

- `https://agentclientprotocol.com/protocol/overview`
- `https://agentclientprotocol.com/protocol/prompt-turn`
- `https://agentclientprotocol.com/protocol/schema`
- `https://raw.githubusercontent.com/zed-industries/codex-acp/main/README.md`
- `https://raw.githubusercontent.com/zed-industries/codex-acp/main/Cargo.toml`
- `https://raw.githubusercontent.com/zed-industries/codex-acp/main/src/codex_agent.rs`
- `https://raw.githubusercontent.com/zed-industries/codex-acp/main/src/thread.rs`
- `https://raw.githubusercontent.com/agentclientprotocol/claude-agent-acp/main/README.md`
- `https://raw.githubusercontent.com/agentclientprotocol/claude-agent-acp/main/package.json`
- `https://raw.githubusercontent.com/agentclientprotocol/claude-agent-acp/main/src/acp-agent.ts`
- `https://raw.githubusercontent.com/agentclientprotocol/claude-agent-acp/main/src/tools.ts`
