# Channel Processing Indicator Adapter Standardization

## Summary

Standardize the channel-facing processing indicator adapter contract so Slack, Telegram, and Zalo Bot share one explicit model for "conversation is being worked on" without forcing one transport-specific UI behavior.

## Status

Planned

## Why

`clisbot` already has one shared lifecycle coordinator for processing indicators:

- `src/channels/message/processing-indicator.ts`

But the channel-specific adapter layer is still inconsistent:

- Telegram uses a native typing heartbeat
- Zalo Bot uses a near-duplicate native typing heartbeat
- Slack uses reaction and assistant-status decoration instead of native typing

This creates three problems:

- duplicated heartbeat logic between Telegram and Zalo Bot
- no single channel adapter contract that explains which indicator capabilities a channel implements
- harder future expansion for channels that do not support native typing but can still express "working" through another mechanism

The immediate need is standardization with low blast radius, not a risky runtime rewrite.

## Scope

- define one explicit channel-side processing indicator adapter contract
- inventory current Slack, Telegram, and Zalo Bot indicator behavior against that contract
- identify what should remain shared lifecycle behavior versus what should stay channel-specific
- remove obvious Telegram or Zalo Bot heartbeat duplication if that can be done without changing behavior
- document the migration path before broadening implementation to more channels

## Non-Goals

- changing product behavior in the first pass unless a bug fix is trivial and low risk
- redesigning `processChannelInteraction(...)`
- merging Slack into a fake typing API when its surface semantics are materially different
- broad refactors across every channel in one batch
- reworking queue, loop, or runner lifecycle in this task

## Current State

Shared today:

- `ConversationProcessingIndicatorCoordinator`
- `ProcessingIndicatorLifecycle` with `handler` and `active-run`
- `processChannelInteraction(...)` returning indicator lifecycle information

Channel-specific today:

- `src/channels/telegram/typing.ts`
- `src/channels/zalo-bot/typing.ts`
- `src/channels/slack/service.ts` processing decoration activation

The shared abstraction currently starts too low in the stack:

- lifecycle ownership is shared
- adapter shape is not

## Proposed Direction

Introduce one explicit adapter boundary for channel processing indicators.

The contract should be neutral enough to cover:

- native typing heartbeats
- reaction-based "working" decoration
- assistant or thread status surfaces
- channels with no indicator capability at all

One likely direction:

- shared lifecycle coordinator remains the owner of lease and active-run truth
- a channel adapter describes how to activate, refresh if needed, and clear processing feedback
- Telegram and Zalo Bot become two implementations of the same heartbeat helper
- Slack keeps its own transport behavior but conforms to the same adapter contract

The contract name does not need to be final yet, but it should describe "processing indicator" rather than only "typing".

## Suggested Implementation Order

### 1. Freeze the contract in docs first

- write the adapter responsibilities
- define which parts are mandatory versus optional
- decide whether refresh behavior is push-driven, timer-driven, or adapter-owned

### 2. Remove obvious Telegram/Zalo duplication

- share the heartbeat runner if behavior is identical
- keep API-specific `sendTyping()` functions in the channel service or API layer

### 3. Fold Slack into the same contract

- map reaction or status decoration to the same lifecycle hooks
- avoid changing visible Slack behavior in the same batch unless required

### 4. Expand only after regression coverage is in place

- broaden to more channels or more indicator capability metadata only after the first three channels are stable

## Validation Notes

The first implementation pass should verify:

- Telegram typing behavior is unchanged
- Zalo Bot typing behavior is unchanged
- Slack decoration timing is unchanged
- active-run truthfulness still depends on the shared coordinator, not on one message-handler lifetime
- no new stuck-indicator or early-clear regressions appear

## Exit Criteria

- one explicit task-approved adapter contract exists for channel processing indicators
- Telegram, Zalo Bot, and Slack are mapped against that contract
- duplicated Telegram/Zalo heartbeat logic is either removed or explicitly deferred with justification
- docs make it obvious where lifecycle truth lives and where channel-specific behavior lives
- the task can be implemented later in small slices without reopening the architecture question

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Channel Plugin Standardization](2026-04-10-channel-plugin-standardization.md)
- [Processing Indicator Lifecycle And Active-Run Truthfulness](2026-04-14-processing-indicator-lifecycle-and-active-run-truthfulness.md)
- [Slack Processing Indicator Regression](2026-04-16-slack-processing-indicator-regression.md)
- [Zalo Bot Platform Channel MVP](2026-04-18-zalo-bot-platform-channel-mvp.md)
