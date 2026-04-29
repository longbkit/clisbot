# Codex CLI Profile

## Summary

Codex is the current default-oriented CLI shape in `clisbot`.

Its continuity model is strong, but its startup readiness model is still more generic than Gemini.

## Capability Mapping

### `start`

Support: `Strong`

Current basis:

- command: `codex`
- startup args include:
  - `--dangerously-bypass-approvals-and-sandbox`
  - `--no-alt-screen`
  - `-C {workspace}`
- trust prompt handling is enabled

### `probe`

Support: `Partial`

Current basis:

- no CLI-specific `startupReadyPattern` is configured
- startup succeeds once the tmux bootstrap sees a non-empty post-trust snapshot and no configured blocker
- `probe`-level readiness is therefore more heuristic than explicit

Current implication:

- `waiting_input` and `ready` can still be normalized
- but the public profile should admit that current proof is weaker than a dedicated ready regex

### `sessionId`

Support: `Strong`

Current basis:

- create mode: `runner`
- capture mode: `status-command`
- status command: `/status`
- capture pattern: UUID-like session id

### `resume`

Support: `Strong`

Current basis:

- command mode resume
- current resume shape:
  - `codex resume {sessionId} --dangerously-bypass-approvals-and-sandbox --no-alt-screen -C {workspace}`

### `recover`

Support: `Strong`

Current basis:

- `agents` persists `sessionKey -> sessionId`
- runner can recreate the tmux host and reuse stored Codex `sessionId`

### `attach`

Support: `Strong`

Current basis:

- tmux snapshot capture and observer flows already exist
- transcript normalization already recognizes Codex-like snapshots and status lines

### `interrupt`

Support: `Partial`

Current basis:

- current interrupt path sends `Escape`
- current normalization recognizes Codex running footer patterns such as `Working (...)` and `Esc to interrupt`

Current implication:

- interrupt is operationally supported
- but confirmation is still indirect and should stay best-effort in the compatibility contract

## Running Snapshot Signals

Current normalized running clues include:

- `Working (...)`
- duration footer with interrupt hint

These are strong enough for running snapshots, but should still be treated as CLI-specific observation signals rather than contract truth by themselves.

## Main Drift Risks

- no explicit startup ready pattern
- `/status` output shape may drift
- model release drift can resume an old session under a newer model, which may affect Codex performance and session continuity
- Codex UI chrome and redraw behavior can still affect pane-derived heuristics
