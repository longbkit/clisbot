# Streaming-Off Truthfulness For Queued And Loop Delivery

## Summary

Fix queued and looped execution paths so `streaming: "off"` is honored truthfully across delayed work, while keeping architecture boundaries clear:

- channels own surface-visible delivery policy
- agents own scheduling and queue ordering
- loop persistence must not silently become the owner of channel reply behavior

## Status

Done

## Outcome

After this task:

- explicit `/queue ...` and implicit `additionalMessageMode: "queue"` no longer show interim queued placeholders or running previews when `streaming: "off"`
- `/loop <count>` does not leak queued placeholders or running previews from later queued iterations when `streaming: "off"`
- managed interval or calendar loops do not keep emitting progress-style surface replies just because an older wrapped prompt was persisted
- queue-by-mode preserves the real user prompt instead of risking an `undefined` prompt handoff
- delayed work follows the current resolved surface delivery contract instead of a stale, prewrapped prompt artifact

Later follow-up note:

- a separate queue-start or loop-start notification may still appear if route `surfaceNotifications` is enabled
- those notifications are independent from `streaming`; they are explicit start announcements, not preview leakage

## Why

There is now a real report that queue execution still appears to stream even when the route is configured with `streaming: "off"`.

Investigation found that this is not only a perception issue.

There are at least three concrete mismatches in the current code path:

- queued execution still posts a queued placeholder in `executePromptDelivery(...)` when `paneManagedDelivery` and `positionAhead > 0`, even if `streaming` is off
- `/loop <count>` reuses that same queued-delivery path multiple times, so later iterations can inherit the same mismatch
- managed interval or calendar loops currently persist `promptText` after the agent prompt wrapper is already applied, then reuse that wrapped prompt later without reconsidering current surface streaming policy

There is also a nearby correctness bug in the same area:

- implicit queue mode currently calls `executePromptDelivery(...)` with `promptText: explicitQueueMessage!`
- in queue-by-mode, `explicitQueueMessage` is actually `undefined`
- this means the delayed handoff path is already structurally brittle even before surface truthfulness is fixed

## Scope

- fix explicit `/queue ...` delivery truthfulness under `streaming: "off"`
- fix implicit `additionalMessageMode: "queue"` delivery truthfulness under `streaming: "off"`
- fix `/loop <count>` delivery truthfulness under `streaming: "off"`
- fix managed interval and calendar loop prompt execution so they respect current channel delivery policy
- decide and document whether future loop ticks follow current surface policy or frozen creation-time policy
- add regression coverage that makes these rules obvious

## Non-Goals

- redesigning all loop UX or notification copy
- adding new queue-start or loop-start notification policies
- changing the meaning of `response: "all" | "final"`
- redesigning slash command syntax
- broad persistence refactors outside what is required to stop policy leakage here

## Product Rules To Implement

### 1. `streaming` remains a channel-owned visibility policy

`streaming` decides whether the channel may show interim surface updates while work is active.

That rule must still hold when the work is delayed:

- queued behind another run
- started later by `/loop <count>`
- started later by an interval loop
- started later by a calendar loop

Delayed work is not allowed to bypass `streaming` just because it started from a queue or a scheduler.

### 2. `responseMode` remains the canonical reply-delivery contract

- `capture-pane` means channel-managed settlement owns visible replies
- `message-tool` means tool-managed replies own canonical surface delivery

If `message-tool` is active and `streaming: "off"`, the system must not implicitly reintroduce progress-like surface visibility through queue placeholders, running drafts, or stale wrapped loop prompts.

### 3. Future loop ticks should follow current resolved surface policy

Recommended rule:

- the originating chat surface owns reply and preview policy
- future loop ticks should use the current resolved route contract for that surface when they execute
- loop persistence should store scheduling intent and the persisted source prompt, not a frozen copy of transient channel delivery instructions

This keeps channel policy changes meaningful after loop creation:

- if the operator turns `streaming` off later, future loop ticks should honor that
- if the operator changes `responseMode`, future loop ticks should honor that too unless a later explicit feature introduces frozen loop-local delivery policy

## Architecture Alignment

This task should reinforce the intended ownership split instead of hiding the bug behind ad-hoc conditionals.

### Channels own

- `streaming`
- `response`
- `responseMode`
- prompt-envelope wording that tells the agent how to reply back to the surface
- what is or is not allowed to become visible in the target channel while a run is active

### Agents own

- queue ordering
- active-run state
- loop scheduling
- interval and calendar timing
- persistence of scheduler state

### Persistence must not own channel delivery policy

Persisted loop records should not become the de facto source of truth for:

- whether progress replies are allowed
- whether message-tool wrapper text is still current
- whether a surface should stream

If a loop needs persisted prompt data, persist the source `promptText` plus scheduler metadata, then apply the current channel delivery wrapper when dispatching the tick.

Short-term compatibility is acceptable, but the patch must not deepen the current anti-pattern of persisting more prewrapped surface-specific prompt text.

## Important Design Gap To Close

The managed loop path cannot follow current surface policy unless it knows which surface to resolve.

Today, a persisted loop keeps:

- scheduling state
- `sessionKey`
- `agentId`
- already wrapped `promptText`

That is enough to replay old wrapped text, but not enough to truthfully rebuild current channel delivery policy.

So the task must explicitly add or derive a durable surface binding for loop ticks.

Minimum required binding data should let runtime answer:

- which channel plugin owns the originating surface
- which account owns that surface
- which route target should be resolved
- which thread or topic should be used for reply targeting

Practical examples:

- Slack: `channel`, `accountId`, `target`, `threadTs`
- Telegram: `channel`, `accountId`, `chatId`, `topicId`

Exact naming can differ, but the loop record must stop pretending that prewrapped prompt text alone is enough context.

Recommended direction:

- persist the source `promptText` alongside a `surfaceBinding`
- at tick execution time, use that binding plus current config to re-resolve route policy
- rebuild any prompt envelope from current `responseMode`, `streaming`, and reply-target contract

Existing channel plugin utilities for reply-target resolution are a good seam to reuse or generalize instead of inventing a parallel route-resolution path just for loops.

## Current Known Code Mismatches

Most relevant current paths:

- `src/channels/message/interaction-processing.ts`
  - `executePromptDelivery(...)`
  - queue-by-mode handoff
  - `/loop <count>` repeated dispatch
- `src/agents/runtime/agent-service.ts`
  - managed loop creation
  - managed loop tick execution
- `src/channels/message/agent-prompt.ts`
  - current wrapper depends on `responseMode` but not on `streaming`
- `src/agents/loops/loop-state.ts`
  - persisted loop shape currently stores `promptText` as executed text

Current suspicious mismatches:

- queued placeholder branch can still post while `streaming: "off"`
- queue-by-mode can pass the wrong prompt value
- loop tick execution can reuse stale wrapped prompt text built under older surface rules

## Implementation Slices

### 1. Fix queue prompt handoff correctness first

- introduce one explicit resolved prompt variable for delayed queue delivery
- make explicit `/queue ...` and implicit queue-by-mode use the same resolved value path
- add a regression test that proves the queued prompt body is preserved in queue-by-mode

This should land before or together with the visibility fix so the bug is not masked.

### 2. Fix queued execution truthfulness under `streaming: "off"`

- do not post queued placeholder or running preview messages when the effective surface policy says `streaming: "off"`
- keep final settlement behavior intact
- make explicit `/queue ...` and implicit queue-by-mode behave the same here

Important rule:

- delayed work may still settle visibly at the end
- but it must not produce interim surface visibility when streaming is off

### 3. Fix `/loop <count>` queued iteration truthfulness

- `/loop <count>` should not leak queued placeholder or running-preview behavior for later iterations when streaming is off
- the initial loop-created acknowledgment may remain
- per-iteration interim visibility must still obey the same streaming rule as ordinary queued work

### 4. Fix managed loop prompt contract

- stop treating persisted wrapped prompt text as the sole long-lived execution contract
- choose one truthful execution model and document it explicitly

Recommended implementation direction:

- persist source prompt content, scheduler metadata, and enough surface binding to re-resolve the route later
- resolve the current surface delivery wrapper at tick execution time
- pass current `streaming`, `responseMode`, and related channel contract into prompt wrapping

If a smaller transitional patch is needed first, it must still ensure:

- `message-tool` loop prompts do not instruct progress replies when `streaming: "off"`
- future work is not pushed deeper into persisted stale wrapper text

### 4a. Split urgent fix from structural fix if needed

If scope pressure is high, it is acceptable to ship this in two linked slices:

- urgent slice
  - fix queue placeholder truthfulness
  - fix queue-by-mode prompt handoff bug
  - fix `/loop <count>` delayed-queue truthfulness
  - stop the worst `message-tool` plus `streaming: "off"` leak for managed loops
- structural slice
  - add explicit persisted surface binding
  - rebuild loop prompt envelopes from current route policy at tick execution time
  - add policy-change regression coverage

But the urgent slice must be documented as a true partial fix, not as final architecture closure.

### 5. Add regression coverage at the right seams

Tests should not only assert one string branch.

They should cover contract boundaries:

- queue handoff correctness
- queue visibility under `streaming: "off"`
- times-loop visibility under `streaming: "off"`
- managed loop prompt execution under current surface policy
- config change after loop creation where future ticks must honor the updated surface policy

## Regression Matrix

Minimum required automated coverage:

- explicit `/queue ...` with `streaming: "off"`
  - no queued placeholder
  - no running preview
  - final settlement still arrives
- implicit queue-by-mode with `streaming: "off"`
  - no queued placeholder
  - no running preview
  - final settlement still arrives
  - real prompt text is preserved
- `/loop 3 ...` with `streaming: "off"`
  - creation acknowledgment still posts once
  - later queued iterations do not emit interim placeholders
  - final per-iteration settlement remains truthful
- managed interval or calendar loop with `responseMode: "message-tool"` and `streaming: "off"`
  - tick execution does not instruct progress-style surface replies
  - current route policy is applied at execution time
- managed interval or calendar loop resolution
  - persisted loop record contains enough surface binding to re-resolve the route
  - tick execution does not depend solely on stale wrapped prompt text
- policy-change regression
  - create loop while streaming is on
  - switch surface to streaming off
  - next tick must honor streaming off

## Validation Notes

- unit coverage should center on `processChannelInteraction(...)` and delayed delivery behavior
- loop execution coverage should prove the scheduler path does not bypass current route policy
- if a broader persistence shape change is introduced, add migration or backward-compatibility validation
- live validation should exercise both Telegram and Slack surfaces after the unit slice passes

## Exit Criteria

- no queued or loop-delayed path shows interim surface updates when `streaming: "off"`
- implicit queue mode preserves the user prompt text correctly
- managed loop ticks no longer depend on stale wrapped prompt text for channel delivery semantics
- docs clearly state that channel policy owns delayed-work visibility
- regression tests would catch both the observed bug and the nearby queue prompt handoff bug on future refactors

## Validation

Validated with:

- `bun x tsc --noEmit`
- `bun test test/agent-prompt.test.ts test/interaction-processing/interaction-processing.test.ts test/agent-service/agent-service.test.ts`

This slice now covers:

- explicit `/queue ...` with `streaming: "off"` staying silent until final settlement
- implicit queue-by-mode preserving the real prompt text
- `/loop <count>` no longer posting queued placeholders when `streaming: "off"`
- managed loop execution rebuilding prompt instructions from persisted prompt text plus surface binding under current route policy

## Related Docs

- [Streaming Mode And Message-Tool Draft Preview Handoff](../../../features/channels/streaming-mode-and-message-tool-draft-preview-handoff.md)
- [Agent Progress Reply Wrapper And Prompt](../../../features/channels/agent-progress-reply-wrapper-and-prompt.md)
- [Loop Slash Command](../../../features/channels/loop-slash-command.md)
- [Queued And Loop Running Surface Notifications](2026-04-14-queued-and-loop-running-surface-notifications.md)
- [Architecture Boundary Clarification For Surfaces, Agents, And Runners](../../2026-04-13-architecture-boundary-clarification-for-surfaces-agents-and-runners.md)
