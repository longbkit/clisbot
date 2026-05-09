---
title: Live E2E Validation Should Use Pane Truth, Real Surface Evidence, And Active Task Context
date: 2026-04-27
area: validation, channels, runtime, workflow
summary: End-to-end checks should be grounded in live pane evidence and actual surface output, with the active task doc visible during the run. That keeps E2E work from drifting into guesswork or detached debugging.
related:
  - docs/tasks/features/channels/2026-04-27-prompt-context-sender-surface-contract.md
  - docs/tasks/features/stability/2026-04-27-session-runner-state-machine-review.md
  - docs/features/channels/recent-conversation-replay.md
  - docs/lessons/2026-04-09-live-surface-validation-must-distinguish-product-bugs-from-observer-artifacts.md
---

## Context

On April 27, 2026 the repo went through live Slack end-to-end validation while task docs were also being used as the source of current intent.

The durable takeaway was not only "test on the real surface." It was stricter:

- inspect the pane that actually backs the session
- compare it against the real surface-visible transcript
- keep the active task visible so the validation stays tied to the claimed scope

Without that triangle, it is easy to over-explain from logs, misread observer artifacts, or forget what the current pass was supposed to prove.

## Lesson

For live channel E2E work, the strongest evidence stack is:

1. pane truth
2. surface truth
3. task truth

All three matter.

Pane truth alone can miss rendering or delivery bugs. Surface truth alone can hide runner state. Task truth keeps the validation aligned with the feature or fix being claimed.

## Practical Rule

Before calling a live E2E pass done:

1. capture the backing pane or session state
2. compare against the actual Slack or Telegram output
3. verify the active task doc still matches what is being validated
4. record any mismatch as product truth, observer artifact, or task-scope drift

This keeps validation anchored to evidence instead of reconstruction.
