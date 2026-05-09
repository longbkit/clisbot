---
title: Streaming Stability Fixes Must Prove No Regression On Settled Content
date: 2026-04-19
area: channels, streaming, stability, validation
summary: Fixes for streaming drift or repeated updates must be validated against the steady-state case too. A patch that improves recovery but starts replaying already-settled content is still a regression.
related:
  - docs/features/channels/streaming-mode-and-message-tool-draft-preview-handoff.md
  - docs/tasks/features/channels/2026-04-14-streaming-mode-and-message-tool-draft-preview-handoff.md
  - docs/tasks/features/channels/2026-04-12-telegram-capture-pane-settlement-stall.md
  - docs/lessons/2026-04-09-live-surface-validation-must-distinguish-product-bugs-from-observer-artifacts.md
---

## Context

This lesson came from an April 19, 2026 pass on `clisbot` streaming stability.

The immediate bug was real: under pane drift or delayed capture, the product needed to recover better instead of stalling or losing progress. But one attempted fix improved the drift case while creating a new steady-state failure: already-settled content was replayed again even when nothing had drifted.

The human feedback was the right correction: better recovery is not a win if the normal path starts looking noisy or wrong.

## Lesson

Streaming logic has two separate contracts:

- recover correctly when capture or delivery drifts
- stay quiet and idempotent once content is already settled

Future fixes must prove both contracts. Do not validate only on the failure mode that motivated the patch.

## Practical Rule

Whenever streaming settlement, replay, or pane-capture logic changes:

1. test the drift case that motivated the patch
2. test the normal settled case with no drift
3. confirm that no extra replay happens after the final settled content
4. confirm that surface-visible behavior still matches the internal state transition

If the patch makes the noisy case better but causes repeated settled output, it is still a regression.

## Reusable Heuristic

Treat streaming state as edge-sensitive:

- transitions into draft/update mode should be explicit
- transitions out of draft/update mode should be explicit
- once the system reaches settled state, later capture passes should be no-op unless new content arrived

This is the same general rule as idempotent reconcilers elsewhere in the product: recovery code must not keep "repairing" a state that is already correct.
