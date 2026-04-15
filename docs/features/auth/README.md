# Authorization

## Summary

Authorization is the system that defines who may do what in `clisbot`.

It owns the permission model across app-level control, agent-level runtime actions, owner claim, and the contract between advisory prompt guidance and hard runtime enforcement.

## State

Active

## Why It Exists

Authorization is broader than config shape and broader than operator control surfaces alone.

It needs one clear home for:

- roles and permissions
- app scope versus agent scope
- owner claim
- resolution order
- advisory versus enforced behavior
- cross-system ownership across configuration, channels, agents, and control

Without that, the repository keeps blurring:

- persisted policy shape
- auth semantics
- in-chat gating
- operator-side enforcement

## Scope

- app roles and permissions
- agent roles and permissions
- owner claim semantics
- permission resolution order
- prompt auth context contract
- runtime gating contract for routed actions
- dependency rules for control, channels, agents, and configuration

## Non-Goals

- identity registry design
- OAuth or provider login flows
- backend-specific auth mechanics inside runners
- schema-loading details that belong to configuration
- operator CLI implementation details that belong to control

## Related Task Folder

- [docs/tasks/features/auth](../../tasks/features/auth)

## Related Feature Docs

- [App And Agent Authorization And Owner Claim](app-and-agent-authorization-and-owner-claim.md)

## Related Test Docs

- [docs/tests/features/auth](../../tests/features/auth/README.md)

## Dependencies

- [Configuration](../configuration/README.md)
- [Control](../control/README.md)
- [Channels](../channels/README.md)
- [Agents](../agents/README.md)

## Current Focus

Keep the auth feature area truthful as active work:

- `app.auth` and `agents.<id>.auth` are now live in config and runtime resolution
- `clisbot auth ...` exists for operator auth inspection and mutation
- channels already consume resolved auth for pairing bypass, `/whoami`, `/status`, and `/bash`
- automatic first-owner claim is still pending and remains the main unfinished auth slice
- advisory versus enforced boundaries still need to stay explicit across channels, control, and prompt rules
