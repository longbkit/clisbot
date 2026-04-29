# Upcoming

Use this file as the staging area for work that is expected to become the next public release note.

For beta or pre-release builds, keep notes here until the public version ships. When the release note is cut, move the meaningful beta history into that version's `Pre-Release History` section.

## Summary

Durable one-shot queue control is being staged for the next release.

## Operator Impact

- None yet.

## Functional Changes

### Channels

- None yet.

### Auth

- None yet.

### Agents

- Added durable session-scoped queue items under `StoredSessionEntry.queues`.
  Chat `/queue`, route `additionalMessageMode: "queue"`, and `clisbot queues`
  now share the same queue item model.
- Added a configurable per-session pending queue limit:
  `control.queue.maxPendingItemsPerSession`, default `20` when omitted.

### Runners

- None yet.

### Control

- Added `clisbot queues list|status|create|clear` for app-wide or scoped queue
  inspection, explicit routed creation, and pending-only clear.

### Configuration

- Added optional `control.queue.maxPendingItemsPerSession`. The default config
  template omits it so future release defaults can change without pinning old
  generated config files.

### DX

- None yet.

## Non-Functional Changes

### Stability

- Fixed startup ready-pattern matching so stale prompt markers earlier in a tmux
  pane do not let first-submit proceed before the currently launching runner is
  actually ready.
- Fixed mid-run recovery for runners that use explicit session ids without a
  separate resume command; recovery now restarts with the stored id instead of
  clearing and rotating it.
- Fixed status-command session-id capture fallback so full-pane rewrites can
  still read the cleaned `/status` delta when the raw append exists but does
  not contain the session id.
- Fixed existing tmux session reuse when the stored `sessionId` is missing:
  clisbot now captures the runner conversation id before submitting the next
  prompt instead of keeping the session entry permanently non-resumable.
- Fixed `clisbot restart` recovery for the case where `stop` reports a timeout
  but `status` already shows the service is stopped; restart now continues into
  `start` and prints the stop warning instead of leaving the service down.
- Fixed running-state reconciliation for tmux panes that are already idle:
  stale active timer lines in scrollback no longer keep a session `running`,
  and rehydrated active runs can settle without waiting for another pane
  change.
- Fixed chat `/stop` so it clears clisbot's active-run state and unblocks the
  next queued prompt after sending the runner interrupt, instead of depending
  only on later pane settlement.
- Fixed operator active-run listing so stale persisted `running` projections
  with no matching tmux session are cleared instead of continuing to show
  `runner=lost`.

### Security

- None yet.

### Architecture Conformance

- None yet.

### Runtime Benchmarks

- None yet.

## Update Notes

- None yet.

## Validation

- `bun run check`
- `bun run build`
- `git diff --check`

## Links

- [Queues CLI](../features/control/queues-cli.md)
