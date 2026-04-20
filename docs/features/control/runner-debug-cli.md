# Runner Debug CLI

## Summary

`clisbot runner` now owns the operator-facing tmux debug surface for listing, inspecting, and watching live runner panes without dropping into raw tmux commands first.

The main `clisbot --help` surface now promotes `runner list` and `runner watch --latest`, and `clisbot status` includes the newest five runner sessions by default.

Examples:

- `clisbot runner list`
- `clisbot runner inspect agent-default-main --lines 40`
- `clisbot runner watch agent-default-main --lines 20 --interval 1s`
- `clisbot runner watch --latest --lines 20 --interval 1s`
- `clisbot runner watch --next --timeout 120s --lines 20 --interval 1s`

## Scope

- list live tmux runner sessions on the configured clisbot socket
- capture one pane snapshot from a named session
- watch one named session continuously
- watch the session with the most recently admitted prompt
- wait for the next newly admitted prompt, then watch that session

## Non-Goals

- replacing raw tmux for every advanced operator action
- attaching an interactive operator TTY into tmux
- inferring activity from pane churn or CPU usage
- changing channel-level `/attach` or `/watch` semantics inside chat

## Invariants

- `runner` is the operator control namespace; it does not redefine logical session ownership
- `watch --latest` means the session with the newest admitted prompt, not the newest tmux process
- `watch --next` waits for the next admitted prompt after the command starts, then sticks to that session
- selection uses persisted session metadata first, then maps to the deterministic tmux session name derived from `sessionKey`
- a recreated tmux runner for the same logical session still resolves to the same tmux session name under the current naming rule

## Data Sources

### tmux inventory

- source: configured tmux socket from `tmux.socketPath`
- used by:
  - `runner list`
  - `runner inspect`
  - live pane capture during `runner watch`

### admitted-turn ordering

- source: `session.storePath`, field `lastAdmittedPromptAt`
- used by:
  - `runner watch --latest`
  - `runner watch --next`
  - ordering hints in `runner list`

This field is updated when a prompt is admitted into active execution, before runner readiness or pane capture begins.

It is intentionally separate from `updatedAt` because:

- `updatedAt` also changes for runtime settlement, session id sync, loop persistence, and other continuity updates
- operators need `latest` and `next` to mean "latest new turn" rather than "last metadata write"

## Command Contract

### `clisbot runner list`

- prints current tmux runner sessions
- prefixes each entry header with `sessionName:` for faster scanning
- sorts sessions by newest `lastAdmittedPromptAt` when known
- shows mapped `sessionId` when stored, otherwise `sessionId: none`
- shows simple state from stored runtime when available, otherwise `state: unmanaged` for tmux-only sessions
- still shows unnamed tmux-only sessions even if no persisted metadata row matches

### `clisbot runner inspect <session-name>`

- captures one pane snapshot
- `--lines <n>` controls the pane tail window

### `clisbot runner watch <session-name>`

- continuously captures the named pane
- `--lines <n>` controls the pane tail window
- `--interval <duration>` controls the polling cadence
- `--timeout <duration>` bounds the watch window when desired

### `clisbot runner watch --latest`

- selects the session whose logical conversation most recently admitted a new prompt
- does not mean newest tmux spawn
- does not mean pane with the most visual churn

### `clisbot runner watch --next`

- waits for the first newly admitted prompt after the command starts
- default timeout is `120s`
- once selected, the watcher stays on that session

## Related Docs

- [Control README](./README.md)
- [Session Identity](../agents/sessions.md)
- [Runtime Operations](../../user-guide/runtime-operations.md)
- [Control Test Cases](../../tests/features/control/README.md)
- [Task Doc](../../tasks/features/control/2026-04-18-runner-debug-watch-cli.md)
