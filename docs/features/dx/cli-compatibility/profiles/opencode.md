# OpenCode CLI Profile

## Summary

OpenCode is the strongest ACP-native member of the supported CLI set: it
advertises `session/load`, so resume continuity over ACP does not depend on
parsing any CLI output.

Its tmux story is weaker: the opencode TUI exposes no status command that
prints the session id, so the tmux backend cannot auto-capture a session id.

## Capability Mapping

### `start`

Support: `Strong`

Current basis:

- command: `opencode`
- default backend: `acp` (launch preset `opencode acp`)
- tmux startup args include:
  - `--auto`
- trust prompt handling is enabled

### `probe`

Support: `Partial` (tmux) / `Strong` (acp)

Current basis:

- tmux ready pattern:
  - `Ask anything`
- acp readiness comes from the structured initialize/session handshake, not
  pane scraping

Current implication:

- over ACP, readiness and session identity are machine-readable from the start
- over tmux, readiness is a plain-text pattern with no session-id signal

### `sessionId`

Support: `Strong` (acp) / `Partial` (tmux)

Current basis:

- acp create mode: `session/new` returns a `ses_...` id directly
- acp capture mode: not needed; the id is known at session creation
- tmux create mode: `runner`
- tmux capture mode: `off` (opencode TUI has no status command that prints
  the session id)

### `resume`

Support: `Strong` (acp) / `Partial` (tmux)

Current basis:

- acp resume shape: `session/load {sessionId}` (advertised `loadSession: true`)
- tmux resume shape:
  - `opencode --session {sessionId} --auto`

Current implication:

- acp resume is validated end-to-end
- tmux resume only works when an external session id is known, because the
  tmux backend cannot capture it automatically

### `recover`

Support: `Strong` (acp) / `Partial` (tmux)

Current basis:

- `agents` persists `sessionKey -> sessionId`
- acp can recreate an adapter process and reuse the session id with
  `session/load`
- tmux cannot re-derive the session id from runner output, so a lost tmux
  session restarts fresh

### `attach`

Support: `Strong` (tmux) / `Partial` (acp)

Current basis:

- tmux snapshot capture and observer flows already exist
- acp has no terminal pane; `/attach` shows the accumulated conversation text

### `interrupt`

Support: `Strong` (acp) / `Partial` (tmux)

Current basis:

- acp cancel is first-class
- tmux interrupt sends `Escape`; confirmation is best-effort

## Main Drift Risks

- opencode session-id format (`ses_...`) is not UUID-shaped, so any
  future tmux capture would need its own pattern
- opencode auth is stored outside clisbot (`opencode auth login`), so a
  machine without opencode credentials is blocked, not ready

## Operator Caveat

OpenCode support is real and ACP-first, but tmux continuity is intentionally
limited. If you need resume across runner restarts, stay on the ACP backend.
