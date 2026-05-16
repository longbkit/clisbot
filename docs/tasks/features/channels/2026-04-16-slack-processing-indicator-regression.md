# Slack Processing Indicator Regression

## Summary

Investigate and fix the recent Slack regression where the app processing indicator appears briefly and then clears too early while the run is still active.

## Status

Done

## Outcome

After this task:

- Slack processing feedback stays active for the whole intended run lifecycle
- progress replies do not get mistaken for final settlement
- message-tool progress, progress updates, and final replies no longer clear the indicator prematurely
- operator-facing status and tests make the lifecycle truth easier to audit

## Scope

- reproduce the regression on Slack thread routes
- audit the processing-indicator lifecycle against progress, reply, and final-reply events
- verify whether progress messages are being treated as final completion signals
- fix the Slack-specific lifecycle bug without regressing Telegram or detached-run handling
- add regression coverage for progress updates before final settlement

## Non-Goals

- redesigning all processing indicator UX across every channel
- changing Slack-native status wording or appearance unless required for correctness
- broader channel rendering refactors unrelated to this lifecycle regression

## Problem Statement

Recent changes appear to have made Slack app processing feedback unstable. The indicator can flash on and then stop while the run is still working, which breaks the user-facing contract that Slack should show active processing until the routed request actually settles or detaches.

One plausible failure mode is that a progress message or message-tool reply is being treated as though it were the final reply, causing the indicator coordinator to release early.

## Validation Notes

- Slack processing indicator stays active while only progress updates are emitted
- Slack processing indicator stays active across message-tool progress replies until the real final reply lands or the run intentionally leaves live follow mode
- final settlement clears the indicator exactly once
- detached sparse-follow runs clear channel-side indicators because those indicators represent live handling, not long-running background monitoring
- Telegram behavior remains unchanged

## Exit Criteria

- the Slack processing indicator no longer flashes off during active work
- progress vs final lifecycle semantics are explicit and regression-tested
- the fix is narrow enough that channel lifecycle truth remains easy to reason about

## Implementation Notes

- Slack assistant thread status is now kept alive by the shared processing-indicator coordinator while the active run is in live follow mode; it clears when the run reaches terminal state or transitions to detached sparse-follow mode.
- `message-cli` and channel plugins stay transport-only; they do not own or re-arm processing state.
- terminal cleanup still happens through the same processing lease, so status ownership remains in one place.

## Validation

- `bun test test/slack-processing-decoration.test.ts test/slack-assistant-status.test.ts test/message-cli/message-cli.test.ts`
- `bunx tsc --noEmit`
