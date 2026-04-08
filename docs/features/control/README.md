# Control

## Summary

Control is the operator-facing system for inspecting and intervening in `muxbot`.

## State

Planned

## Why It Exists

The people operating the system need first-class control surfaces that are separate from end-user channels.

Attaching to tmux, checking health, restarting sessions, or clearing broken state should not be modeled as chat UX.

Session-scoped follow-up behavior changes requested by end users do not belong here.

Those belong to Agent-OS runtime policy, because they are part of the conversation contract rather than operator intervention.

## Scope

- inspect flows
- attach flows
- restart and stop flows
- health and debug views
- operator-safe intervention points
- config reload watch behavior

## Non-Goals

- end-user message rendering
- backend-specific runner details
- channel routing

## Related Task Folder

- [docs/tasks/features/control](../../tasks/features/control)

## Related Test Docs

- [docs/tests/features/control](../../tests/features/control/README.md)

## Dependencies

- [Agent-OS](../agent-os/README.md)
- [Runners](../runners/README.md)

## Current Focus

Turn the current ad hoc tmux inspection and recovery path into an explicit operator control surface.

Current control-owned config is:

- `control.configReload.watch`
- `control.configReload.watchDebounceMs`
