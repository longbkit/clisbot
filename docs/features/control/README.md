# Control

## Summary

Control is the operator-facing system for inspecting and intervening in `clisbot`.

## State

In Progress

## Why It Exists

The people operating the system need first-class control surfaces that are separate from end-user channels.

Attaching to tmux, checking health, restarting sessions, or clearing broken state should not be modeled as chat UX.

Session-scoped follow-up behavior changes requested by end users do not belong here.

Those belong to agents runtime policy, because they are part of the conversation contract rather than operator intervention.

Permission semantics do not belong here either.

Those belong to auth, because control is a surface that consumes auth decisions rather than the owner of the auth model.

## Scope

- inspect flows
- attach flows
- restart and stop flows
- authorized chat-channel recovery ingress for the same control semantics
- health and debug views
- inspect and cancel persisted managed loops
- operator-safe intervention points
- config reload watch behavior

## Non-Goals

- end-user message rendering
- CLI-specific runner details
- channel routing
- owning the auth model itself

## Related Task Folder

- [docs/tasks/features/control](../../tasks/features/control)

## Related Feature Docs

- [loops-cli.md](./loops-cli.md)
- [runner-debug-cli.md](./runner-debug-cli.md)

## Related Test Docs

- [docs/tests/features/control](../../tests/features/control/README.md)

## Dependencies

- [Auth](../auth/README.md)
- [Agents](../agents/README.md)
- [Runners](../runners/README.md)

## Current Focus

The tmux inspection path now has a first-class runner debug CLI for list, inspect, and watch.

Current control follow-on work is still broader than that shipped slice:

- richer intervention actions
- chat-channel recovery commands for current-session runner restart or reset
- explicit health and recovery flows
- config reload watch behavior

Current control-owned config is:

- `control.configReload.watch`
- `control.configReload.watchDebounceMs`
