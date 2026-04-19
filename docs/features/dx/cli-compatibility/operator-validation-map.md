# Operator Validation Map For Real CLI Compatibility

## Status

Draft v0

## Summary

This page turns the human checklist into an operator-first validation map.

The goal is not to restate concerns.

The goal is to say:

- what the real risk is
- how to reproduce it on purpose
- what the operator should run
- which signals and metrics matter
- which artifacts prove the result

This document is intentionally risk-first, not scenario-first.

## Why This Exists

If the DX surface starts from pretty scenarios alone, it is too easy to miss the real operator pain:

- first launch in a truly new workspace
- update banners and auto-update exits
- delayed or fragile session id capture
- state inference that is correct too late
- prompt paste behavior drifting because of special characters
- steering during a live run
- no quick human-readable proof when the inference struggles

Those are not edge details.

Those are the unstable boundaries that determine whether the app can trust a real CLI.

## Design Principle

The primary unit should be a **risk slice**, not a transcript and not a golden scenario.

Each risk slice should define:

- reproduction setup
- operator surface
- normalized outcome
- measured timing
- human-readable artifacts

Scenarios can still exist later, but they should be built from these risk slices instead of hiding them.

## Risk Slice Matrix

| Risk Slice | Why It Matters | How To Reproduce Intentionally | What To Measure | Required Artifacts |
| --- | --- | --- | --- | --- |
| Fresh workspace launch | catches trust/setup instability that only appears on first launch | run CLI in a new workspace copy with no prior runner state for that workspace | startup blocker class, time to first stable state, retries before settle | first pane snapshot, transitions timeline, final probe JSON |
| CLI version drift | catches upstream behavior changes after upgrade | run immediately after version change or when startup shows update banner | version before/after, update notice seen, exit or restart behavior, settle result | startup snapshot, version record, failure classification |
| Session id acquisition | proves continuity path is real, not assumed | run one launch path that injects session id when supported, and one capture path when not supported | session id source, time to first session id, retry count, capture success rate | snapshot around id appearance, probe outputs, session record |
| Ready-state detection | proves prompt can be sent at the right time | probe continuously from launch until ready or blocked | false positives, false negatives, detection latency, retry count | probe timeline, pane snapshots at state changes |
| Prompt paste and submit | proves input actually enters and executes | submit curated prompts through the same tmux path as production | input accepted, submit success, time from submit to running, settle result | pre-submit snapshot, post-submit snapshot, final snapshot |
| Special-character safety | catches accidental CLI-native command modes | send prompts containing `/`, `$`, `@`, multiline blocks, and leading whitespace variants | whether prompt stayed literal, whether alternate mode triggered, whether submit path changed | raw prompt fixture, pane snapshot before and after submit |
| Live running and steer | proves state truth during long runs | send a long-running prompt, then inject one steer message mid-run | running-state continuity, timer movement seen, steer accepted, final settle result | running snapshots, steer event record, final result |
| Human observability | keeps operator trust high during failures | save and display the same pane text the detector used | whether a human can explain the classification quickly | watch output, summary markdown, latest snapshot path |

## Workspace Modes

The surface should model workspace mode explicitly instead of leaving it implicit.

### `current`

Use the current working workspace and current CLI environment.

Use this when checking whether today's real setup is healthy.

### `fresh-copy`

Copy the current repository into a new temporary workspace path, then launch there without prior runner artifacts for that workspace.

Use this to reproduce first-launch trust and setup flows without destroying the current workspace.

This is the most important mode for the trust-prompt problem.

For the standardized two-pass report that measures this path directly, use:

- [Bootstrap Trust And Readiness Report](./bootstrap-trust-and-readiness-report.md)

### `fresh-empty`

Launch the CLI in an empty temporary directory.

Use this to distinguish repository-specific trust/setup from generic startup behavior.

### `existing-session`

Reuse a prior logical session on purpose.

Use this for continuity, resume, and pane-loss recovery slices.

## Painpoint Mapping

### 1. Workspace Trust And First Launch

This should not be treated as a generic startup failure.

It needs its own reproduction path:

- create a temporary workspace path
- avoid reusing prior runner state for that workspace
- launch the CLI there first
- probe until one of these settles:
  - `ready`
  - `blocked:trust`
  - `blocked:auth`
  - `failed`

Minimum operator need:

- one command that launches in `fresh-copy`
- one watch surface that lets the operator see the trust prompt directly

What matters most:

- whether the blocker is visible
- how long it takes to reach a stable classification
- whether the system ever lies and says `ready` too early

### 2. Version Update Flow

Version drift should be treated as its own validation slice, not hidden inside generic launch failure.

The operator needs to know:

- which CLI version launched
- whether an update notice appeared
- whether the process exited, restarted, or kept running
- whether the final failure came from upstream update flow or from our own runner path

Recommended rule:

- every real CLI validation result should record CLI version at the start
- if the start and end versions differ, record that explicitly
- if an update banner appears, classify the run under update drift even if later steps fail differently

### 3. Session Id Capture

There are really two distinct paths here:

- **provided session id**: the CLI accepts a session id up front
- **captured session id**: the runner must observe and extract it later

Those should be validated separately.

For captured paths, the system should expose:

- command or mechanism used to trigger capture
- retry count
- delay before first successful capture
- whether capture required a side-effecting slash flow

The operator should not have to infer whether continuity is real.

The result should say whether continuity was:

- `injected`
- `captured`
- `missing`
- `unsupported`

### 4. Ready Detection And State Truth

The hard part is not only being correct.

It is being correct quickly enough to be operationally useful.

This slice therefore needs both correctness and latency:

- first observed stable state
- time from launch to stable state
- number of probe retries
- contradictory state flips before settlement

Recommended truth model:

- detection latency is a first-class metric
- false positive and false negative observations should be counted over time
- a late but correct answer is still a degraded result

### 5. Prompt Paste And Submit Stability

This should be validated through the real production path, not through a simplified injection path that avoids the risk.

The important question is:

did the same tmux send path that production uses successfully paste and submit the intended prompt?

The minimum fixture set should include:

- plain short prompt
- multiline prompt
- prompt starting with `/`
- prompt containing `$skill` style syntax
- prompt containing `@file` references
- prompt where leading whitespace matters

This slice should distinguish:

- text appeared in pane but did not submit
- submit happened but input was mutated
- CLI switched into another mode
- run started and settled normally

### 6. Long Run And Steering

The important risk is not only whether the steer message sends.

It is whether the system keeps correct running truth before, during, and after steering.

This slice therefore needs:

- a long enough prompt to keep the CLI visibly running
- a mid-run steer injection
- a running snapshot before steer
- a running snapshot after steer
- a final settlement record

The operator should be able to see whether:

- the timer kept moving
- the run stayed live
- the steer was accepted
- state inference regressed after steering

### 7. Human Observability

Every automated conclusion should have a human-readable proof path.

JSON alone is not enough.

Every real CLI validation run should leave:

- a short summary markdown
- the latest pane snapshot text
- the transitions timeline
- enough path information that the operator can attach or inspect quickly

If the machine says `blocked:trust`, a human should be able to open one file or one live watch surface and see that truth immediately.

The same rule applies to trust persistence:

- if the report says trust persisted, the operator should be able to open the pass-2 artifact and see that the same workspace relaunched without the trust prompt returning

## Recommended Surfaces

The fastest useful set is still low-level and operator-facing.

### `runner probe`

Purpose:

- answer whether the CLI is healthy right now
- classify the current state
- expose timing and retries

Minimum output should include:

- `cli`
- version
- workspace mode
- normalized state
- blocker class when blocked
- session id status
- detection latency
- retry count
- latest snapshot path

### `runner watch`

Purpose:

- let a human compare normalized state against live pane truth

It should show:

- current normalized state
- recent timing and retry counters
- latest pane text or rolling snapshot
- attach target when available

### `runner send`

Purpose:

- validate the real paste and submit path

It should record:

- prompt fixture identity
- whether literal input was preserved
- whether submit was confirmed
- transition to `running`
- settlement outcome

### `runner test`

Purpose:

- wrap the low-level surfaces into named validations once the primitives are trusted

Recommended short names:

- `launch`
- `roundtrip`
- `session`
- `steer`
- `interrupt`
- `recover`

These names are fine as thin wrappers, but they should stay secondary to the operator truth surfaces above.

## Fastest Practical Rollout

If the next batch must be lean and still answer the real painpoints, build in this order:

1. `runner probe` with workspace-mode support and timing metrics
2. `runner watch` with human-readable pane output
3. `runner send` with curated prompt fixtures for special-character and submit-risk cases
4. `runner test launch`
5. `runner test roundtrip`
6. `runner test session`

That sequence gives fast operator truth first, then wraps it into friendly validations later.

## Anti-Patterns

Avoid these traps:

- treating fresh-workspace trust flow as a generic launch failure
- hiding update banners inside free-form logs
- claiming continuity without exposing how session id was obtained
- reporting state without timing or retry context
- validating prompt submission with sanitized inputs only
- keeping only JSON when a human-readable pane view is needed to debug drift

## Relationship To Other Docs

- [Human Checklist](./human-checklist.md) keeps the original operator concerns
- [Capability Contract](./capability-contract.md) defines the normalized machine-readable model
- [Real-CLI Smoke Surface](./real-cli-smoke-surface.md) describes the higher-level validation surface

This page is the bridge between the literal painpoints and the future command surface.
