# Codex Runner Stability Grill

## Status

Review draft.

## Purpose

This doc turns the Codex runner stability note into one reviewable grilling pass.

It is intentionally a question list with recommended defaults so the next implementation task does not start from vague goals like "make it more stable" or "increase timeout".

Primary task:

- [Codex Runner Stability Strategy](../../tasks/features/stability/2026-06-05-codex-runner-stability-strategy.md)

## Core Thesis

The next clisbot stability push should make Codex session startup and blocked states explicit before adding broader retries or longer waits.

Recommended direction:

- classify runner state first
- extend timeouts only for slow states that show progress
- fail fast for known blocked states that need policy or human action
- never submit user prompts into Codex menus or approval screens
- make operator-facing failure text name the exact blocker and next action

## Grilling Questions

### 1. What does "super stable" mean for Codex runner startup?

Recommended answer:

Stability means clisbot reaches one truthful terminal state for every startup:

- ready and safe to submit prompt
- blocked with a named reason
- failed with a named reason

It does not mean waiting forever or hiding Codex menus behind generic retry logic.

### 2. Which runner states must be first-class?

Recommended answer:

Start with this taxonomy:

- `starting`
- `ready`
- `blocked:update`
- `blocked:trust-workspace`
- `blocked:hook-review`
- `blocked:human-approval`
- `blocked:auth`
- `failed:codex`
- `failed:timeout`
- `unknown`

Keep the names boring and operator-readable. Do not introduce separate state names for every visual variant until real evidence requires it.

### 3. Should clisbot increase session-open timeout now?

Recommended answer:

Yes, but only after state classification.

Timeout should become adaptive:

- longer for `starting` when the pane is changing or an update is progressing
- bounded recoverable retry for Codex-owned update restart
- short and actionable for known blockers such as trust, hooks, auth, or human approval
- hard failure for unclassified timeout with a pane snapshot and inspect/watch command

### 4. How should Codex self-update be handled?

Recommended answer:

Keep the existing direction: Codex-owned update flow may be auto-confirmed if Codex presents a clear default update path, and a temporary process exit during update can be treated as recoverable.

Needed follow-up:

- expose update state in diagnostics
- record bounded retry count
- distinguish update-progress from generic runner disappearance
- fail with "Codex update did not complete" instead of "runner disappeared"

### 5. How should trust-workspace be handled?

Recommended answer:

Trust workspace should be explicit policy, not accidental prompt submission.

Default should stay conservative:

- detect the trust prompt
- do not submit user prompt into it
- surface required action or configured policy

If clisbot already has a trusted-workspace policy for first-run bootstrap, document whether Codex inherits it or needs a Codex-specific policy.

### 6. How should hook review be handled?

Recommended answer:

Do not trust changed hooks by default.

Supported policies should be explicit:

- block and ask operator to review hooks
- continue without trusting hooks
- trust all and continue only when explicitly configured

The implementation must test that user prompts are not submitted while the hook menu is visible.

### 7. What does "human approval" mean here?

Recommended answer:

Human approval is any Codex screen where the runner is waiting for the user to approve a command, action, permission, or environment change before continuing.

For the first slice:

- detect approval screens enough to avoid classifying them as `ready`
- surface them as `blocked:human-approval`
- do not auto-select an approval action unless a later policy explicitly allows it

### 8. Should human approval be supported during startup only or during a run too?

Recommended answer:

Both matter, but split the work.

First slice:

- startup and first prompt readiness gates

Follow-up:

- mid-run approval state that pauses observation, notifies the user, and resumes after approval

Reason:

Startup blockers prevent prompt loss. Mid-run approval is a broader observer/active-run state-machine problem.

### 9. What should the user see when Codex is failing?

Recommended answer:

Failure text should name:

- boundary: binary/path/version, update, trust, hooks, approval, prompt readiness, tmux disappearance
- current state
- whether clisbot will retry automatically
- exact next operator command, such as `clisbot runner inspect ...`, `clisbot watch ...`, or the relevant policy setting

Avoid generic "runner failed" messages when pane evidence is available.

### 10. What should `clisbot status` and `runner inspect` show?

Recommended answer:

They should show the classified runner state and concise evidence:

- runner id/session name
- selected Codex binary path and version when known
- startup blocker state
- last pane classifier match
- retry count
- suggested next action

Do not dump full pane transcripts into normal status. Keep detailed snapshots in inspect/debug surfaces.

### 11. What fixture tests are required before live smoke?

Recommended answer:

Minimum fixture matrix:

- normal ready prompt
- slow startup eventually ready
- update prompt then restart then ready
- update prompt then exhausted retry
- trust workspace prompt
- hook review prompt
- continue without trusting hooks
- trust all hooks only under explicit policy
- human approval prompt
- auth blocker
- generic Codex failure before prompt box
- tmux disappears outside recoverable update state

### 12. What live smoke should prove after fixture coverage?

Recommended answer:

Run real Codex smoke for:

- fresh workspace startup
- trusted workspace startup
- changed hooks startup
- first prompt after `/status` session capture
- long prompt
- multiline prompt
- approval-required command path if the current Codex version exposes one

Live smoke should produce artifacts or logs, not only "worked for me".

### 13. How should this interact with existing state-machine work?

Recommended answer:

Treat this as the Codex startup/readiness slice of the broader session-runner state machine.

Do not solve all active-run persistence in this task, but keep state names compatible with:

- active-run truth
- runner liveness
- final delivery
- observer attach/watch
- queue and loop admission

### 14. What should be explicitly out of scope?

Recommended answer:

Keep these out of the first implementation slice:

- trusting changed hooks by default
- auto-approving arbitrary Codex actions
- open-ended waits
- broad Gemini/Claude compatibility changes
- replacing tmux runner architecture
- redesigning all active-run persistence

### 15. What is the first implementation slice?

Recommended answer:

1. Inventory current Codex startup detection and tests.
2. Define startup blocker enum and failure taxonomy.
3. Add fixture tests for update/trust/hooks/approval/failure.
4. Thread classified state into diagnostics and user-facing failure text.
5. Increase timeout only for classified slow-progressing states.

## Decisions To Confirm

- Is `blocked:human-approval` the right term, or should it be `blocked:codex-approval` to avoid confusing it with clisbot channel auth?
- Should "continue without trusting hooks" be the default for unattended sessions, or should default be "block and ask operator"?
- Should trust workspace inherit existing runner trust settings, or require a Codex-specific config knob?
- Should update auto-confirm remain enabled by default?
- Which status surface is allowed to include pane snapshots, if any?

## Recommended First Backlog Bundle

If this grill is accepted, the first execution bundle should be:

- update the Codex runner task with the confirmed state taxonomy
- add fixture tests before code changes that widen timeouts
- implement state classification and diagnostics
- then tune timeouts
- then run real Codex smoke

