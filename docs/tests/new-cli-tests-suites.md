# New CLI Test Suites

## Purpose

Use this checklist before declaring a new interactive CLI stable inside `clisbot`.

This guide turns the current runner and channel test docs into one gated rollout path, with extra checks learned from the live Claude validation and shutdown or submit bugs already traced.

## How To Use This Guide

- treat each gate as a release checkpoint, not a suggestion
- do not skip a lower gate because a higher-level Slack or Telegram demo happened to work once
- record backend-specific quirks in the relevant task doc before widening usage
- if a gate fails, stop and fix that layer first instead of compensating in another layer

## Gate 0: Local Runner Bring-Up

Priority: `P0`

Paths to validate:

- raw tmux session
- direct local CLI invocation
- runner startup path without Slack or Telegram in the loop

Checklist:

- [ ] The CLI binary is discoverable and launchable from the configured runner command.
- [ ] A fresh session reaches a clearly ready prompt without manual tmux typing.
- [ ] Trust, login, or safety prompts are explicitly handled or explicitly rejected with a clear error.
- [ ] Authentication is compatible with the intended runtime shape: either the CLI is already logged in, or a headless-compatible auth path exists for routed use.
- [ ] Known startup blockers such as auth waits or setup dialogs are detected at runner startup instead of leaking into later prompt submission.
- [ ] The runner can distinguish static startup chrome from meaningful output.
- [ ] Session bootstrap does not depend on channel-specific retries or delays.

Minimum evidence:

- one saved raw pane trace for fresh startup
- one targeted regression test for any CLI-specific readiness quirk
- one documented note about the chosen auth prerequisite for local, detached, and channel-routed runs

## Gate 1: Submit Truthfulness

Priority: `P0`

Paths to validate:

- single-line prompt submit
- multiline prompt submit
- long prompt submit
- first-turn submit after a fresh session

Checklist:

- [ ] Prompt body paste visibly settles before final submit.
- [ ] `Enter` truthfulness is confirmed without silently resending the whole prompt.
- [ ] First-turn submit works after trust or bootstrap prompts.
- [ ] Multiline prompts do not require manual `/nudge` in the normal success path.
- [ ] Long prompts do not truncate, partially paste, or double-submit.

Minimum evidence:

- targeted unit or integration coverage around the submit handshake
- at least one real tmux trace proving multiline success

## Gate 2: Output Normalization And Settlement

Priority: `P0`

Paths to validate:

- raw runner output
- normalized runner output
- channel-visible final answer

Checklist:

- [ ] Static dashboard, footer, and prompt echo chrome are removed from user-visible output.
- [ ] Progress deltas remain ordered and meaningful.
- [ ] One stable final settled answer is exposed for channel delivery.
- [ ] Interrupts, redraws, or status bars do not leak noisy terminal frames into replies.

Minimum evidence:

- regression tests for normalization rules
- before or after pane captures for one representative run

## Gate 3: Session Continuity

Priority: `P0`

Paths to validate:

- session-id create
- session-id capture
- session-id resume
- tmux-session loss recovery

Checklist:

- [ ] The chosen session-id strategy is explicit: runner-generated, explicit, captured later, or none.
- [ ] A killed tmux session can recover without losing the intended conversation when the backend supports resume.
- [ ] Stale or rejected session ids are preserved truthfully; operators use `/new` for intentional rotation.
- [ ] Session continuity metadata stays backend-neutral outside the runner boundary.

Minimum evidence:

- automated test coverage for the selected session-id strategy
- one manual recovery trace if resume is part of the backend contract

## Gate 4: Channel End-To-End

Priority: `P0`

Paths to validate:

- primary launch channel
- follow-up in the same thread or topic
- second independent thread or conversation

Checklist:

- [ ] A fresh mention or routed message produces exactly one accepted run.
- [ ] The first reply, progress surface, and final answer all land in the correct thread or topic.
- [ ] Follow-up reuses the same logical session when intended.
- [ ] A separate top-level conversation does not leak or reuse the wrong active run.
- [ ] Any account or route-specific diagnostics needed for debugging are visible in status.

Minimum evidence:

- at least one real end-to-end run on the primary launch channel
- one follow-up in the same conversation
- one independent second conversation proving isolation

## Gate 5: Interrupt, Steering, And Manual Recovery

Priority: `P1`

Paths to validate:

- interrupt during active generation
- manual recovery command such as `/nudge`
- non-destructive steering while a run is active

Checklist:

- [ ] Interrupt reaches the intended live session only.
- [ ] Manual recovery remains a backup path, not a hidden dependency for normal correctness.
- [ ] Steering input does not resend prior prompt text.
- [ ] Busy-state reporting stays truthful while the runner is active or recovering.

## Gate 6: Restart And Shutdown Correctness

Priority: `P0`

Paths to validate:

- detached runtime start
- detached runtime stop
- restart after stop
- stale pid cleanup

Checklist:

- [ ] `clisbot start` does not reuse a stale pid that belongs to a dead runtime.
- [ ] `clisbot stop` finishes truthfully when the runtime is gone, including zombie or defunct pid cases on POSIX.
- [ ] Restart produces one healthy runtime without duplicate listeners on the same account.
- [ ] Status reflects the real runtime state after stop or restart.
- [ ] Mem-only credentials or runtime-only state are cleaned up according to the documented lifecycle.

Minimum evidence:

- regression coverage for stop and stale-pid handling
- one manual `start -> status -> stop -> status` smoke flow on the real CLI

## Gate 7: Stability And Performance Soak

Priority: `P1`

Paths to validate:

- repeated prompts in the same session
- repeated prompts across separate sessions
- long-running route with concurrent channel activity

Checklist:

- [ ] No duplicate replies appear under one healthy single-runtime setup.
- [ ] Median first-progress and final-response latency are acceptable for the target channel.
- [ ] Repeated runs do not accumulate stale sessions, zombie pids, or orphan runtime state.
- [ ] Failure modes are visible enough that operators can tell whether the problem is channel, control, agent, or runner.

## Exit Rule

A new CLI should only be called stable when all `P0` gates above are complete.

`P1` gates can remain open only if:

- the missing coverage is tracked in a task doc
- the current launch scope does not depend on that path
- the residual risk is stated plainly in status or release notes

## Related Docs

- [Runner Tests](features/runners/README.md)
- [Channel Tests](features/channels/README.md)
- [Stability](../features/non-functionals/stability/README.md)
