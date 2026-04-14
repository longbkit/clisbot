# Processing Indicator Lifecycle And Active-Run Truthfulness

## Summary

Fix Slack and Telegram processing indicators so they stay truthful while a routed run is still active, especially when later user messages are injected into that active run through steering.

## Status

Done

## Outcome

After this task:

- Telegram typing stays alive while the underlying run is still active
- Slack processing status and typing-style feedback do not clear just because a steering message was submitted
- processing indicators are tied to real active-run lifecycle, not only to one inbound message handler lifetime
- follow-up steering no longer makes the bot look idle while work is still happening

## Why

Current behavior is not truthful enough.

There is now a real report that after recent changes, both Slack and Telegram can show a short processing indicator, then stop showing it even though the agent is still working.

The strongest current suspicion is the steering path in `processChannelInteraction`:

- when `additionalMessageMode: "steer"` handles a busy conversation
- or `/steer ...` injects text into the active run
- the code submits steering input and returns immediately

That early return ends the surrounding indicator lifecycle:

- Telegram stops its typing heartbeat
- Slack clears typing/status decoration in `finally`

This creates a false idle signal while the active run continues.

## Scope

- trace and fix indicator lifecycle for:
  - implicit steering when `additionalMessageMode: "steer"` and the session is busy
  - explicit `/steer ...` follow-up
  - normal active runs that receive later steering input
- make indicator ownership match the real active-run lifecycle
- prevent Slack processing status or Telegram typing from clearing too early on steering
- verify whether Slack assistant status needs refresh behavior for long runs
- add regression coverage for both Slack and Telegram

## Non-Goals

- redesigning the full response rendering system
- changing the default product choice of `additionalMessageMode`
- rewriting runner supervision or queue semantics in this slice
- solving unrelated capture-pane settlement bugs unless they directly block indicator truthfulness here

## Current Suspected Root Cause

Most suspicious code paths:

- `src/channels/interaction-processing.ts`
  - implicit steering path for busy sessions
  - explicit `/steer` path
- `src/channels/telegram/service.ts`
  - typing heartbeat lifetime is scoped to `processChannelInteraction(...)`
- `src/channels/slack/service.ts`
  - processing decorations are cleared in `finally` when `processChannelInteraction(...)` returns

The likely mismatch is:

- active run is still alive
- but the follow-up handler returns because steering injection is complete
- so the channel service thinks processing is done

## Product Rule To Implement

Processing indicators must represent actual active work for the conversation.

They must not disappear merely because one follow-up message was converted into steering input.

More concretely:

- if a session still has an active run, the channel may keep showing processing feedback
- if no active run remains, the channel must stop processing feedback promptly
- steering acknowledgment text such as `Steered.` must not be treated as proof that the underlying run is done

## Implementation Slices

### 1. Make lifecycle ownership explicit

- decide where processing-indicator lifetime should live for active runs
- ensure the lifetime survives steering-input submission when the same run continues

### 2. Fix Telegram typing truthfulness

- keep typing heartbeat alive while the active run remains active
- stop it only when the run actually settles or detaches under the intended rule

### 3. Fix Slack processing truthfulness

- do not clear assistant status or typing-style decoration just because steering injection returned
- review whether one-shot `setStatus(...)` is sufficient for long runs or needs refresh logic

### 4. Add regression tests

- busy session + implicit steering keeps indicator alive
- explicit `/steer ...` keeps indicator truthfully aligned with the still-running session
- indicator stops after true run completion
- no duplicate final clear or stuck indicator after completion

## Validation Notes

- unit or integration tests should cover:
  - `additionalMessageMode: "steer"` on a busy session
  - explicit `/steer ...`
  - Telegram typing heartbeat lifetime
  - Slack processing clear timing
- live validation should confirm:
  - Telegram no longer flashes typing once and stops while work continues
  - Slack no longer clears `Working...` too early on steered runs

## Exit Criteria

- steering into an active run no longer makes Slack or Telegram look idle while the run is still active
- processing indicators stop when the run truly completes, errors, or is intentionally detached under the designed rule
- both Slack and Telegram have regression coverage for this lifecycle
- the doc and tests make the intended lifecycle obvious to the next developer

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Agent Progress Reply Wrapper And Prompt](../../../features/channels/agent-progress-reply-wrapper-and-prompt.md)
- [Slack Channel MVP Validation And Hardening](2026-04-04-slack-channel-mvp-validation-and-hardening.md)
- [Telegram Capture-Pane Settlement Stall](2026-04-12-telegram-capture-pane-settlement-stall.md)
