# Streaming Mode And Message-Tool Draft Preview Handoff

## Summary

Make `streaming` govern live preview on both response modes, add `/streaming` surface control, and keep `message-tool` truthful by treating pane preview as one disposable draft instead of a second canonical reply.

## Status

Done

## Outcome

After this task:

- `streaming` affects both `capture-pane` and `message-tool`
- `/streaming status|on|off|latest|all` works on routed Slack and Telegram surfaces
- `message-tool` may still show one edited live draft preview while the run is active
- tool-owned replies can split the preview timeline without causing many concurrent live drafts
- tool-final delivery no longer lets `clisbot` auto-settle a second pane-final reply in `message-tool`
- fallback settlement reuses the draft preview when the tool path never sends a final reply

## Why

The old model overloaded `responseMode`.

It answered both:

- who owns canonical reply delivery
- whether the user sees live progress

That made `message-tool` too binary: either the tool path owned everything, or the channel stayed silent even when operators wanted truthful live progress.

The desired product model is cleaner:

- `responseMode` answers reply ownership
- `streaming` answers live preview visibility

That still leaves one hard UX problem:

- if `message-tool` sends progress or final replies into the thread, pane preview can become confusing unless preview is modeled as disposable draft state instead of another canonical reply

## Scope

- let `message-tool` use one edited live preview draft when `streaming` is enabled
- rotate that draft only when a tool-owned reply lands and later preview-worthy output appears
- stop draft updates after a tool final
- clean up the disposable draft on successful completion when `response: "final"`
- keep `message-tool` final ownership strict; do not auto-settle pane output when tool-final is missing
- add `/streaming` slash command handling and persistence
- update docs and regression coverage

## Non-Goals

- fully differentiating `streaming: "latest"` from `streaming: "all"` in this slice
- redesigning structured Block Kit or Telegram HTML rendering
- changing queue semantics or steer semantics beyond preview ownership
- removing `message-tool` final ownership

## Implementation Slices

### 1. Persisted route control

- add `/streaming status`
- add `/streaming on|off|latest|all`
- persist route-target `streaming` the same way surface `responseMode` and `additionalMessageMode` already work

### 2. Message-tool draft preview

- allow live preview when `responseMode: "message-tool"` and `streaming !== "off"`
- keep that preview to one editable draft message
- do not auto-post a pane-final reply when the tool path already owns final delivery

### 3. Draft handoff and cleanup

- freeze the active draft when a tool-owned reply boundary appears
- open a new draft only when new preview content arrives after that boundary
- delete the last disposable draft on successful tool-final completion when `response: "final"`
- do not auto-settle from pane output when tool-final never arrives; this state handoff is intentionally kept strict because it is easy to reintroduce duplicate or out-of-order final messages

### 4. Regression coverage

- slash command status and update coverage for `/streaming`
- `message-tool` with `streaming: "off"` stays silent if tool-final is missing
- `message-tool` with streaming enabled shows one live preview draft
- tool reply boundaries rotate preview without creating multiple active drafts
- tool final plus `response: "final"` cleans up the disposable draft

## Validation

Automated validation completed with:

- `bun x tsc --noEmit`
- `bun test test/interaction-processing.test.ts test/message-cli.test.ts`
- `bun test`

Focused local end-to-end validation in code-level interaction tests now covers:

- `/streaming` persistence and status
- live draft preview in `message-tool`
- draft rotation after message-tool reply boundaries
- draft cleanup after tool final
- no pane-final auto-settlement when no tool final is sent

## Exit Criteria

- operators can switch streaming directly from the chat surface
- `message-tool` no longer means “no live progress” by default when streaming is enabled
- preview draft behavior stays single-message and non-spammy
- final delivery ownership remains truthful and duplicate-free
- docs explain the ownership split between `responseMode`, `streaming`, draft preview, and tool replies
