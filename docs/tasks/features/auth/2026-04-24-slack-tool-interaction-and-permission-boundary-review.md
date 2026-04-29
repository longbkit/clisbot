# Slack Tool Interaction And Permission Boundary Review

## Summary

Review Slack-specific interaction surfaces and make the permission model easier to reason about for command, tool, and reply paths.

## Status

Planned

## Why

`clisbot` on Slack now combines several layers:

- route admission
- audience gating
- follow-up policy
- slash-command handling
- `/bash` auth
- `/transcript` visibility
- `message-tool` reply delivery

Each slice exists, but the combined Slack operator story is still easy to misread.

The product needs one clearer audit of:

- which Slack interactions are member-safe
- which ones require admin-like agent permissions
- which ones are route policy only rather than auth policy
- where Slack-specific behavior differs from Telegram enough to deserve explicit docs or tests

## Scope

- audit Slack handling for `/bash`, `/transcript`, `/streaming`, `/queue`, `/steer`, `/loop`, `/followup`, and related control commands
- review how `message-tool` replies and Slack-native interaction patterns fit the current auth and route model
- verify the boundary between route policy, route verbose, agent auth, and app auth for Slack surfaces
- identify any Slack-specific permission ambiguity that is still only implicit in docs or code
- add or link a concise operator matrix for common Slack interaction types versus their governing permission or policy layer

## Non-Goals

- redesigning the whole auth model
- introducing a Slack-only permission system
- changing Telegram behavior unless parity gaps are found

## Exit Criteria

- Slack interaction surfaces have a clearer documented permission boundary
- common Slack operator questions can be answered without reading multiple feature docs and source files
- any real Slack-specific auth or route gaps are turned into concrete implementation tasks

## Related Docs

- [App And Agent Authorization And Owner Claim](../../../features/auth/app-and-agent-authorization-and-owner-claim.md)
- [Audience-Scoped Access And Delegated Specialist Bots](2026-04-21-audience-scoped-access-and-delegated-specialist-bots.md)

