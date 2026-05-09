---
title: Startup Prompt Automation Must Classify Sequential Blockers And Prove No Side Effects
date: 2026-05-09
area: runners, startup, automation, testing
summary: Startup automation for Codex or similar runners must recognize different startup blockers in sequence, such as update prompts and trust prompts, and prove that each path still works both with and without the prompts present.
related:
  - docs/tasks/features/runners/2026-04-24-codex-runner-path-drift-and-update-notice-hardening.md
  - docs/features/runners/tmux-runner.md
  - docs/tasks/features/stability/2026-04-27-session-runner-state-machine-review.md
  - docs/lessons/2026-04-08-first-start-runner-health-must-handle-trust-prompts-and-dead-tmux-servers.md
---

## Context

The May 9, 2026 Codex startup bug exposed a gap in startup automation:

- when Codex opened with an update/continue prompt, the runner failed during startup
- a fix was proposed to handle that prompt automatically
- the human then correctly pressed on proof: what happens if startup has two blockers in sequence, first update and then trust workspace, and what happens when neither prompt appears

That review pressure captured the real lesson. Startup automation is not just prompt detection. It is prompt classification plus no-side-effect proof.

## Lesson

Startup blockers should be treated as a small state machine, not as one-off pattern replacement.

The automation must show that it can handle all relevant paths:

- update prompt only
- trust prompt only
- update prompt followed by trust prompt
- no startup prompt at all

If one new detector accidentally bypasses or suppresses another startup path, the fix is incomplete.

## Practical Rule

For any startup prompt automation:

1. classify the prompt type explicitly
2. resolve it in the right order
3. re-check the pane after each step instead of assuming startup is now clear
4. keep the old path unless the new design deliberately replaces it
5. prove the no-prompt case still behaves the same

## Evidence Standard

Do not rely on "looks reasonable" reasoning here.

The change should be supported by code-path proof or tests that show:

- trust prompt still works when it appears alone
- update prompt does not swallow the trust path
- no-prompt startup still advances normally
- new behavior is limited to the intended blocker classes

That is the right standard for startup code because the failure mode is silent session loss right at the beginning.
