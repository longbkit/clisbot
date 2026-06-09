# Codex Runner Stability Strategy

## Status

Planned

## Priority

P0

## Summary

Make the next clisbot stability push focus on Codex runner startup, blocked-session truthfulness, and operator recovery.

The target is not "try longer and hope". The target is a stable runner state machine that can distinguish slow startup, Codex failure, update flow, trust-workspace prompt, hook-review prompt, human-approval prompt, and real ready state.

## Why

Codex is now a core runner for real clisbot usage. The highest-value stability work is to make Codex sessions boring under the real interactive states Codex shows over time.

Current risk pattern:

- a routed message opens or resumes a Codex session
- Codex is not actually ready because it is updating, asking for trust, asking for hook review, waiting for human approval, or failing before the prompt box
- clisbot may wait too little, classify the pane too weakly, or report a generic runner failure
- the user experiences silence, vague failure, or manual babysitting

## Strategy

### 1. Make runner state explicit before widening timeouts

Increase session-open and readiness time budgets only after the visible startup state is classified.

Needed states:

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

The operator-facing error should name the state and the next action.

### 2. Treat timeout as a diagnostic, not the root cause

Longer timeout is useful for slow Codex startup, install/update, and cold cache. It is harmful if it hides a blocked prompt.

Rules:

- extend cold-start timeout for known slow-but-progressing states
- fail fast with guidance for known blocked states that require policy or human action
- keep bounded retry for transient runner disappearance during Codex-owned update flow
- never submit the user prompt until the runner is in confirmed `ready`

### 3. Cover Codex lifecycle compatibility as fixtures

Build a Codex compatibility test matrix around startup and approval screens:

- normal ready prompt
- Codex self-update prompt and restart
- trust workspace prompt
- hook review prompt
- continue-without-trusting-hooks policy
- trust-all-hooks policy only when explicitly configured
- human approval prompt before a command/action can continue
- Codex startup failure or version/path drift
- slow startup that eventually becomes ready

### 4. Improve user-visible failure messages

When Codex is failing or blocked, clisbot should say exactly which boundary failed:

- binary/path/version problem
- Codex update still in progress or exhausted
- workspace trust decision needed
- hook trust decision needed
- human approval required inside Codex
- prompt box never reached before timeout
- tmux runner disappeared during a non-recoverable state

Each message should include a concrete operator action, such as inspect/watch, trust policy setting, update command, restart runner, or continue-without-hooks policy.

### 5. Add live compatibility gates after fixture coverage

After fixture tests pass, run a small real-Codex smoke suite:

- fresh workspace startup
- trusted workspace startup
- changed hooks startup
- first prompt after `/status` session capture
- long prompt and multiline prompt
- approval-required command path if Codex exposes it in the current version

## First Implementation Slice

Start with state classification and diagnostics, not broad recovery.

Recommended order:

1. Inventory current Codex startup/state detection in code and tests.
2. Define the runner startup blocker enum and failure taxonomy.
3. Add fixture coverage for update, trust workspace, hook review, approval, and generic failure.
4. Route the classified state into `clisbot status`, `runner inspect`, and user-facing failure text.
5. Then increase startup/session-open timeouts only for known slow states.

## Non-Goals

- trusting changed hooks by default
- hiding Codex approval prompts by blindly choosing actions
- adding open-ended startup waits
- solving Gemini or Claude compatibility in the same first slice
- replacing tmux runner architecture before the state model is truthful

## Exit Criteria

- Codex sessions do not receive user prompts while any startup blocker is visible.
- Slow startup gets more time only when progress is observable.
- Known Codex blockers produce specific, actionable errors.
- Hook review and trust workspace are covered by tests and explicit policy.
- Human approval states are detected well enough to avoid misclassifying them as runner readiness.
- Real-Codex smoke evidence exists for the critical startup paths.

## Related Tasks

- [Session Runner State Machine Review](2026-04-27-session-runner-state-machine-review.md)
- [tmux Submit Truthfulness And Telegram Send Reliability](2026-04-12-tmux-submit-truthfulness-and-telegram-send-reliability.md)
- [Codex Hook Review Startup Gating](../runners/2026-05-19-codex-hook-review-startup-gating.md)
- [Codex Runner Path Drift And Update-Notice Hardening](../runners/2026-04-24-codex-runner-path-drift-and-update-notice-hardening.md)
- [Common CLI Launch Coverage And Validation](../runners/2026-04-13-common-cli-launch-coverage-and-validation.md)

## Related Research

- [Codex Runner Stability Grill](../../../research/runners/2026-06-05-codex-runner-stability-grill.md)
