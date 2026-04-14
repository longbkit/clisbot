# Auth-Aware CLI Mutation Enforcement And Runner Command Guardrails

## Summary

Later enforce app owner or admin permissions for config-mutating `clisbot` CLI commands, and evaluate whether runner-side command guardrails should block or warn on unauthorized config mutation attempts beyond prompt guidance.

## Status

Planned

## Outcome

After this later task:

- mutating control CLI commands read from `app.auth`
- unauthorized config mutation commands fail fast with a clear error
- operator-facing control commands have one canonical permission check path
- the project has a documented decision on whether runner-side command guardrails should hard-block, soft-warn, or stay advisory

## Why

Phase 1 app or agent auth adds a truthful policy model plus prompt guidance, but prompt guidance alone is not hard enforcement.

The later control-owned slice should close that gap for:

- `clisbot` commands that mutate config
- `clisbot` commands that change runtime policy
- possible runner-side attempts to edit `clisbot.json` or execute mutation commands directly

## Scope

- add control-layer auth checks for mutating `clisbot` CLI commands
- define one shared way to mark CLI actions as read-only or mutating
- evaluate owner-only versus admin-allowed boundaries for:
  - config edits
  - runtime management
  - route management
  - account management
  - pairing approval
- evaluate runner-side guardrail options for unauthorized mutation attempts

## Non-Goals

- redesigning the app or agent auth model itself
- full shell sandboxing for every command the agent may execute
- blocking normal non-mutating inspection commands

## Suggested Direction

- centralize control auth in one resolver keyed by `app.auth`
- treat config-writing control commands as mutating by default
- keep read-only commands such as `status` or `list` separate from mutation checks
- explore runner guardrails as a second layer, not the canonical source of truth
- prefer explicit denial messages over silent failures

## Related Docs

- [App And Agent Authorization And Owner Claim](../../../features/configuration/app-and-agent-authorization-and-owner-claim.md)
- [App And Agent Authorization And Owner Claim Task](../configuration/2026-04-14-app-and-agent-authorization-and-owner-claim.md)
