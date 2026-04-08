# muxbot Transcript Presentation And Streaming

## Document Information

- **Created**: 2026-04-04
- **Purpose**: Define how normalized runner output becomes user-visible channel output
- **Status**: Working architecture

## Why This Document Exists

The product needs two truths at the same time:

- tmux and other runners may emit noisy terminal-shaped output
- users should get a clean chat experience by default, even when the backend is a tmux session or plain shell

That requires one explicit contract between `runners` and `channels`.

## Boundary Rule

`runners` own backend capture and normalization.

`channels` own what users actually see.

This means:

- a runner may capture raw tmux panes, SDK events, or ACP output
- a runner must normalize that backend output into one internal transcript contract
- a channel must render normal interaction output as chat-first streaming by default
- a channel may expose a separate explicit transcript request command when a user or operator asks to inspect the whole session view

Channels must not parse tmux-specific escape hatches directly.

Runners must not decide the final user-facing rendering policy.

## Core Terms

### Raw Transcript

The backend-visible session content before user-facing shaping.

For tmux today, this means pane-derived session content, including repeated chrome and terminal framing.

### Normalized Runner Output

The backend-neutral form emitted by a runner for the rest of the system.

It should preserve execution truth while removing backend-only transport details that higher layers should not need to understand.

### Default Interaction Rendering

The normal channel-visible rendering policy applied to normalized runner output.

Default rule:

- latest normalized view wins
- the channel should reconcile the live user-visible message set from the latest normalized snapshot instead of accumulating deltas during normal chat mode
- suppress repeated chrome, replaceable redraw status, and unchanged frames
- settle each interaction to a clean final answer

Important consequence:

- normal chat mode is not append history mode
- if a CLI redraws `Creating...`, `Doing...`, or similar in place, the live Slack reply should show only the latest visible status, not a growing list of prior redraw variants
- durable append-style history belongs to explicit transcript or debug paths, not to default chat interaction

Transport rule:

- when a channel supports message edits, it should prefer one live edited reply for streaming instead of posting a new progress reply for each update
- when one rendered reply exceeds the channel message cap, the channel should reconcile one ordered live chunk set by editing existing chunks, adding new chunks, and deleting stale trailing chunks
- append-only fallback is for channels that cannot edit or when a channel explicitly chooses that transport model

### Transcript Request Command

An explicit channel command pattern that asks for the whole current session or transcript view.

This is not the default interaction mode.

It exists so users or operators can inspect full tmux-backed state when needed without turning normal interaction into a terminal dump.

### Runner Chrome

Repeated or structural output that helps a terminal operator but is often not the answer a user wants to read.

Examples for tmux-backed Codex include:

- repeated top banners
- directory and model header blocks
- static footer hints
- fixed terminal frame redraws

### Meaningful New Content

New transcript content that should be surfaced to the user during normal interaction streaming.

Examples:

- a newly produced answer line
- a progress update that changes the task state
- a final result

Non-examples:

- unchanged header blocks
- repeated frame redraws
- unchanged footer tips

## Pipeline

The system should behave in this order:

1. runner captures backend state
2. runner emits normalized snapshot and streaming updates
3. channel applies default chat-first rendering or an explicit transcript request path
4. channel renders the interaction to the target surface using that channel's transport capability

The same normalized runner output may be rendered differently by different channels and by different command patterns on the same channel.

## Required Runner Contract For Presentation

To support clean presentation, the runner contract should expose at minimum:

- stable session identity
- lifecycle state such as starting, ready, busy, blocked, done, or failed
- a current snapshot
- ordered output updates
- enough structure to distinguish full-screen redraw from meaningful change
- a way to retrieve the current full session view when a transcript request command explicitly asks for it
- backend error state when normalization fails

This contract must work for tmux now and future ACP or SDK runners later.

## Default Interaction Rendering

Default interaction rendering is for everyday interaction quality.

Rules:

- surface only meaningful new content
- suppress repeated header and footer chrome
- avoid re-sending unchanged full-screen frames
- present progress and final output as a coherent conversation

This default rendering must still preserve truth.

It may hide repeated chrome, but it must not hide meaningful progress, tool activity, or failures.

The key architectural choice is:

- in normal chat mode, "meaningful progress" is derived from the latest normalized runner state
- channels should not try to preserve every intermediate redraw once message-edit transport is available
- for long replies, the channel still follows the same rule by reconciling one ordered chunk set to the latest rendered content

This rule applies even when the backing runtime is:

- a Codex tmux session
- a Claude tmux session
- a plain bash shell inside tmux

Codex and Claude may require different normalization rules, but they should both end in the same channel behavior:

- the latest normalized chat view replaces the previous live view
- replaceable terminal status is not retained as chat history
- final settlement is rendered from the final normalized snapshot, not from accumulated running deltas

## Explicit Transcript Request Commands

Full transcript visibility should remain available, but only when explicitly requested through a separate command pattern.

Rules:

- transcript requests are opt-in commands, not the default streaming path
- transcript requests may return the current whole session view, including terminal chrome
- transcript requests must not change the default interaction model for later normal prompts
- transcript requests should work for tmux-backed agents and plain tmux-hosted shells

## tmux-Specific Implications

For the tmux runner today:

- tmux pane capture is a runner concern
- transcript normalization from pane snapshots is a runner concern
- deciding how Slack users see default interaction output is a channel concern
- providing full session visibility when an explicit transcript request command is used is a runner capability consumed by channels or control

The tmux runner should never be treated as the final user experience layer.

## Configuration Implications

Configuration should be able to express at least:

- chat-first rendering as the default interactive behavior
- transcript request command patterns per channel when enabled
- streaming policy per channel route
- safe defaults for message update behavior

Configuration should not force channels to infer rendering rules from backend type.

Configuration policy should stay separate from channel transport capability:

- `streaming` and `response` define content retention and settlement behavior
- whether the channel edits one live message or appends multiple replies is a channel capability and UX decision

For normal Slack chat mode today, the transport decision is fixed:

- use edited live replies
- reconcile ordered chunks when one reply exceeds the platform cap
- do not use append-delta accumulation for normal interaction updates

## Testing Standard

Tests should verify:

- default interaction strips repeated chrome without hiding meaningful progress
- explicit transcript request commands return full session visibility when asked
- normalized runner output is sufficient for channels to render without tmux-specific parsing
- the same runner can support both normal chat-first interaction and explicit full transcript requests truthfully
