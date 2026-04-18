# Shared-Surface Pairing Guidance For Unpaired Users

## Summary

Track the onboarding gap where a user can start a channel successfully, mention the bot in a Slack channel or Telegram group, and get no visible guidance because pairing has not happened yet.

Expected behavior:

- when an unpaired user mentions the bot in a shared channel or group, `clisbot` should still reply with brief guidance
- the guidance should tell the user to talk to the bot in direct message first to complete pairing
- after pairing, the guidance should tell the user how to allow the intended channel or group

## Status

Planned

## Why

The current behavior creates a false failure signal.

From the user point of view:

- the bot started successfully
- they mentioned it in the shared surface
- nothing happened
- this looks like an unexpected error instead of an onboarding requirement

That makes first-use trust worse and hides the actual next step.

## Scope

- define the reply behavior for unpaired mentions in Slack channels and Telegram groups
- make the shared-surface rejection path send visible guidance instead of failing silently
- keep the guidance short and action-oriented
- explain that pairing must happen in DM first
- explain the next step for allowing the original shared channel or group after pairing
- decide whether the guidance should appear only on explicit mentions or also on other routed first-contact cases
- add regression coverage for the unpaired shared-surface guidance path

## Non-Goals

- redesigning the full pairing model
- changing channel allowlist policy semantics
- changing DM pairing approval mechanics beyond the guidance copy needed here

## Related Docs

- [Channels](../../../features/channels/README.md)
- [DM-First Pairing Onboarding](2026-04-10-dm-first-pairing-onboarding.md)
- [slack telegram message actions and bot routing](2026-04-09-slack-telegram-message-actions-and-channel-accounts.md)

## User-Reported Flow

```text
1. start a channel successfully
2. talk to the bot in a group or channel
3. bot does not respond
4. user assumes an unexpected error
5. later user realizes they must DM first to approve pairing
6. only then can they configure the shared surface
```

## Exit Criteria

- an unpaired user who mentions the bot in a shared surface gets a visible reply
- the reply explains DM-first pairing clearly
- the reply explains the follow-up step to allow the original channel or group
- Slack and Telegram shared-surface cases are covered by targeted tests or ground-truth validation docs
