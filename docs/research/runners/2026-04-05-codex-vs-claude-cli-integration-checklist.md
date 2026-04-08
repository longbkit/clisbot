# Codex Vs Claude CLI Integration Checklist

## Goal

Capture the runner-facing differences that matter when integrating interactive AI CLIs through tmux.

This note exists so future runner onboarding does not assume that Codex behavior is universal.

## Live Validation Scope

Validated on April 5, 2026 against the current `muxbot` tmux runner and Slack channel routes:

- Codex route on `C07U0LDK6ER`
- Claude route on `C0AQW4DUSDC`

## Main Finding

Codex and Claude can both work behind the same bot and the same tmux runner contract, but they do not emit the same terminal shape.

The main differences are:

- startup screen behavior
- prompt marker shape
- answer marker shape
- status footer shape
- in-place progress redraw behavior
- session-id lifecycle style
- interrupt aftermath

That means each new CLI integration needs a short runner checklist before it is considered channel-safe.

## Observed Differences

### Codex CLI

- prompt marker is `›`
- final answer lines usually start with `•`
- startup may show a trust prompt that must be accepted before the first prompt
- status footer commonly includes `Working (... esc to interrupt)`
- live Slack validation on April 5, 2026 showed Codex is comparatively easy to normalize into chat mode:
  - running progress is usually tied to explicit answer bullets or footer lines
  - once top and bottom chrome are stripped, final settlement is stable
  - long outputs reconciled cleanly into Slack chunk sets under the latest-view-wins model
- session continuity in the current config is capture-first:
  - create mode can stay runner-native
  - `sessionId` is captured by `/status`
  - restart uses `resume <sessionId> ...`

### Claude Code CLI

- prompt marker is `❯`
- final answer lines commonly start with `⏺`
- startup shows a dashboard:
  - `Claude Code v...`
  - `Tips for getting started`
  - `Welcome back!`
  - `Recent activity`
- no Codex-style trust prompt was observed in the validated path
- status footer is persistent and compact:
  - model and usage summary
  - permission mode
  - effort hint
- progress text may appear as single words such as `Sublimating`
- live Slack validation on April 5, 2026 showed Claude requires stricter normalization than Codex:
  - single-word gerund progress such as `Creating...`, `Doing`, `Frolicking`, or `Quantumizing thinking` can be redrawn in place many times
  - wrapped prompt text can leak into early snapshots if prompt-block stripping is too shallow
  - settled footer/status variants such as `Cooked for 50s` can survive unless explicitly treated as chrome
  - once default chat mode was changed to "latest normalized view wins" instead of delta accumulation, the long settled Slack output became clean
- session continuity in the current config is explicit:
  - first start passes `--session-id {sessionId}`
  - restart uses `--resume {sessionId}`
  - `/status` capture is not needed for the current Claude route
- interrupt by `Esc` works, but Claude may append a follow-up question such as `What should Claude do instead?`

## What muxbot Had To Normalize

To make Claude channel-safe, the transcript normalizer had to strip:

- startup dashboard chrome
- prompt echo lines
- wrapped prompt continuation lines before the first blank separator
- footer/status bar lines
- settled footer variants such as `Worked for ...` or `Cooked for ...`
- answer markers such as `⏺`
- replaceable gerund-style progress frames when they are not durable answer content

To make Slack channel-safe across both Codex and Claude, the Slack adapter also had to:

- enforce a platform-safe outbound text cap
- retry `msg_too_long` with a stricter emergency cap
- keep outbound limit handling inside the Slack adapter instead of inside runner logic
- reconcile long replies as one ordered editable chunk set
- render normal chat mode from the latest normalized view instead of accumulating streaming deltas

## Channel Rendering Choice

The validated channel contract for normal chat mode is:

- latest normalized view wins
- one edited live reply, or one ordered edited chunk set when the reply is too long for one Slack message
- explicit transcript or debug commands remain the place for rawer append-style session visibility

This choice matters because Claude and Codex do not expose the same redraw semantics.

If the channel accumulates deltas in normal chat mode:

- Claude leaks repeated redraw lines such as `Creating...`
- wrapped prompt remnants can survive as false chat history
- stale early progress can remain at the top of the settled first chunk

When the channel instead reconciles from the latest normalized view:

- Codex remains clean
- Claude becomes manageable with runner-specific normalization rules
- long replies still work because Slack chunking is handled as transport reconciliation, not transcript history

## CLI Onboarding Checklist

Use this checklist for any new interactive AI CLI.

### 1. Launch Contract

- identify the interactive launch command
- identify the workspace or cwd contract
- identify whether permission or trust prompts appear on first launch
- identify whether tmux should send an automatic confirmation key during bootstrap

### 2. Prompt Submission Shape

- identify the prompt marker shown in the pane
- check whether the CLI echoes the user prompt
- verify tmux literal send plus `Enter` submits exactly one prompt
- verify no doubled prompt text appears in the runner pane

### 3. Answer Marker Shape

- identify how final answers are marked
- verify channel output removes answer markers when they are UI-only
- verify markdown survives normalization

### 4. Static Chrome And Footer Shape

- identify startup dashboard or splash screen blocks
- identify footer or status bar lines
- identify redraw separators and box-drawing frames
- verify these are removed before delta extraction and final settlement

### 5. Streaming Behavior

- verify normal chat mode uses latest-view reconciliation, not delta accumulation
- verify in-progress updates do not replay the whole terminal frame
- verify replaceable redraw status does not accumulate as chat history
- verify progress-only lines do not dominate the visible chat output
- verify the final settled message is cleaner than the running stream when `response: "final"`

### 6. Session Continuity

- identify whether the CLI accepts explicit session ids on first launch
- identify whether the CLI exposes a separate resume command
- identify whether the CLI exposes a status command for session-id capture
- configure one of:
  - explicit create plus explicit resume
  - runner-native create plus status capture plus resume command

### 7. Interrupt Contract

- verify `Esc` or equivalent interrupt key really stops work
- verify the post-interrupt terminal state is still usable for the next prompt
- verify any post-interrupt guidance text is normalized appropriately

### 8. Channel Safety

- verify one short prompt in Slack yields one short clean answer
- verify a no-mention follow-up in the same active thread works when configured
- verify transcript requests return raw enough terminal state for debugging
- verify no Slack `msg_too_long` failure can crash the gateway

## Current Project Checklist Truth

### Codex

- launch contract: validated
- prompt normalization: validated
- final answer settlement: validated
- latest-view Slack reconciliation: validated
- session-id capture and resume: validated
- interrupt path: partially validated

### Claude

- launch contract: validated
- prompt normalization: validated
- final answer settlement: validated
- latest-view Slack reconciliation: validated after removing normal-chat delta accumulation
- explicit session-id create and resume config: validated
- interrupt path: validated at basic level
- transcript request path: validated

## Recommended Follow-Up

- add a runner fixture test set for Claude pane normalization alongside Codex fixture coverage
- add a documented per-runner config example folder once more CLIs are onboarded
- evaluate whether Claude progress-only terms such as `Sublimating` should remain visible during running updates or be classified as runner progress noise
- evaluate future JSON output or JSON streaming modes for better structured UX, while preserving immediate steering and interrupt control that tmux-screen steering already provides
