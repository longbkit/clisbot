---
title: Live Surface Validation Must Distinguish Product Bugs From Observer Artifacts
date: 2026-04-09
area: channels, rendering, tests
summary: Live Slack and tmux validation should separate real product rendering bugs from formatting artifacts introduced by the inspection tool itself.
related:
  - docs/features/channels/README.md
  - docs/tests/features/channels/README.md
  - src/runners/transcript/transcript-normalization.ts
  - src/runners/transcript/transcript-rendering.ts
  - src/channels/slack/service.ts
  - test/text/text.test.ts
---

## Context

This lesson comes from live Slack validation in the `clisbot` project on April 9, 2026.

The user explicitly asked for real end-to-end Slack testing, including happy paths, edge cases, long-running tool usage, and rendering quality under streaming updates.

During that work, one real transcript bug was found and fixed: soft-wrapped fragments from tmux capture could be rejoined with an extra space, which changed words such as `homepage` into `homep age`.

At the same time, some punctuation and formatting issues seen in `slack-cli` CSV output turned out to be observer artifacts from the readback path rather than actual `clisbot` rendering defects in Slack.

That distinction mattered, because otherwise the debugging loop would have pushed the code toward compensating for the wrong problem.

## Lesson

Live surface validation must use at least two viewpoints when the readback tool is lossy:

- the bot's own rendered output path
- the observer tool or export path

If those disagree, do not assume the product is wrong first.

The validation bar should be:

- confirm the behavior in the actual surface when practical
- compare with raw runtime evidence such as tmux capture or normalized transcript state
- only then decide whether the bug belongs in product code or in the inspection workflow

## Practical Rule

When debugging live Slack or Telegram rendering:

1. capture the original runtime text close to the source
2. inspect the platform-visible result
3. compare that with any secondary observer tool such as CSV export or CLI readback
4. only patch product code when the platform-visible result is actually wrong
5. add a regression test if the root cause came from real runtime data

## Applied Here

This lesson was applied by:

- fixing transcript normalization for soft-wrapped tmux fragments
- adding a regression test in `test/text/text.test.ts`
- avoiding unnecessary rendering changes based only on `slack-cli` CSV flattening
