# Channel Behavior Config Target Binding Standardization

## Summary

Standardize the config-target binding layer that maps a routed channel identity to the persisted bot or route config node that owns behavior overrides.

## Status

Planned

## Why

`src/channels/follow-up-mode-config.ts` currently shows one repeated pattern three times:

- resolve the provider bot record
- decide whether the target is bot-wide or route-scoped
- map a `ChannelIdentity` to the correct DM or shared-surface route key
- create or require the right route object
- read and write one behavior field on that target

Today that duplication exists separately for:

- Slack
- Telegram
- Zalo Bot

The problem is not specific to follow-up mode.

The same binding problem is likely to recur for:

- `followUp`
- `streaming`
- `verbose`
- `responseMode`
- future route-level toggles or behavior overrides

## Scope

- define one shared abstraction for channel behavior config target binding
- separate the generic read or write pattern from the provider-specific route-shape differences
- inventory current differences between Slack, Telegram, and Zalo Bot route resolution
- identify which route-creation behaviors are intentional versus accidental drift
- prepare a safe refactor path that can be implemented later in small slices

## Non-Goals

- broad runtime behavior changes in the first pass
- changing current follow-up behavior policy
- redesigning channel identity or route policy from scratch
- collapsing all provider differences into one fake generic route model

## Current Duplication

Current duplicated areas in `src/channels/follow-up-mode-config.ts` include:

- bot record lookup by provider and bot id
- `scope === "all"` binding
- DM binding with direct-message wildcard inheritance
- shared-surface binding to provider-specific route containers
- `FollowUpModeTargetBinding` construction

Real differences do exist, but they are much smaller than the repeated structure:

- Slack DM keys may fall back to `channelId`
- Telegram and Zalo Bot DM keys may fall back to `chatId`
- Telegram group routes have `topics`
- Slack currently requires an existing shared-surface route
- Telegram and Zalo Bot currently auto-create some route objects

## Proposed Direction

Introduce one intermediate adapter layer that answers questions like:

- how to resolve the provider bot record
- how to resolve the bot-wide behavior target
- how to resolve a DM behavior target
- how to resolve a shared-surface behavior target
- whether missing routes should error or auto-create

Then higher-level behavior features such as follow-up mode should only express:

- which field they want to read or write
- whether they are targeting bot-wide or channel-scoped behavior

## Suggested Implementation Order

### 1. Freeze the binding contract

- document the adapter shape first
- explicitly capture allowed provider differences

### 2. Move follow-up mode onto that contract

- keep behavior unchanged
- remove the current three near-duplicate resolvers

### 3. Reuse the same binding layer for the next behavior flag

- likely `streaming`, `verbose`, or `responseMode`
- use that second migration to verify the abstraction is actually reusable

## Validation Notes

When implementation happens later, verify:

- follow-up mode persistence is unchanged for Slack
- follow-up mode persistence is unchanged for Telegram
- follow-up mode persistence is unchanged for Zalo Bot
- missing-route behavior remains intentional and documented
- no provider loses wildcard DM inheritance behavior

## Exit Criteria

- one explicit shared binding contract exists for channel behavior config targets
- provider-specific differences are isolated behind a small adapter seam
- follow-up mode no longer needs separate large per-channel resolver bodies
- the same seam is ready for later reuse by other route-level behavior settings

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Channel Plugin Standardization](2026-04-10-channel-plugin-standardization.md)
- [Channel Processing Indicator Adapter Standardization](2026-05-09-channel-processing-indicator-adapter-standardization.md)
