# Operator Control Surface And Debuggability

## Summary

Turn inspect, attach, restart, stop, and health actions into a first-class control system.

## Status

Planned

## Why

Operator actions are a real system surface.

They should not stay as hidden implementation knowledge or be conflated with user-facing channels.

## Scope

- inspect flows
- attach flows
- restart and stop flows
- health and debug views
- safe operator recovery paths
- config reload watch policy

## Non-Goals

- end-user channel rendering
- runner-specific protocol design
- session-scoped follow-up policy requested by end users inside a conversation

That policy belongs to agents runtime control, not operator control.

## Subtasks

- [ ] define the first explicit control commands
- [ ] document safe recovery flows
- [ ] expose runtime state needed by operators
- [ ] define and verify config reload watch behavior
- [ ] add control ground-truth tests

## Dependencies Or Blockers

- stable Agents and runner boundaries

## Related Docs

- [Control Feature](../../../features/control/README.md)
- [Control Tests](../../../tests/features/control/README.md)
