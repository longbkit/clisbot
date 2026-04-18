# Working Prompts

## Purpose

Use this page for prompts that are proving useful in real `clisbot` workflow loops.

These are not stable product contracts.

They are working operator prompts that help AI stay aligned, persistent, and reviewable over longer runs.

## Prompt 1: Progress-Aware Continuation Loop

Suggested `clisbot` slash-command usage:

```text
/loop 3 continue, update the completed items directly in the task file as progress, add any newly discovered unfinished items so you can keep following them, and always keep the original overall goal in mind so the work stays aligned
```

Suggested prompt body in English:

```text
Continue. Update the completed items directly in the task file as progress. Add any newly discovered unfinished items so you can keep following them. Always keep the original overall goal in mind so the work stays aligned with it.
```

## Why This Prompt Seems Useful

This prompt helps push the model toward:

- continuing instead of stopping after one local slice
- updating task progress in place instead of leaving progress implicit
- tracking newly discovered unfinished work instead of dropping it
- keeping the original objective visible so later loops do not drift

## Observed Operator Note

Current operator observation:

- this prompt can keep the tool working for a long time
- early signal looks promising
- it still needs continued monitoring

Additional observation after more use:

- this prompt looks especially strong for larger tasks
- for larger tasks, it may be worth running the same prompt in a loop up to `10` times
- during execution, the bot appears able to:
  - update progress directly
  - add newly discovered unfinished work
  - update memory so already-completed work is less likely to be repeated
- this strengthens a possible `clisbot` differentiator versus using Codex or Claude directly:
  - long-running loop control
  - in-place progress updates
  - memory updates that help preserve execution continuity across loops
- early evidence also suggests the loop can drive meaningful follow-on doc updates and code updates without drifting away from the original task

## Future Additions

Later, this page can grow into a small library of:

- continuation prompts
- review-loop prompts
- task-readiness prompts
- convergence prompts
