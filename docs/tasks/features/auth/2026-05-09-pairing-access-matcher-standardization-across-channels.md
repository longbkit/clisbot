# Pairing Access Matcher Standardization Across Channels

## Summary

Standardize the pairing access matcher layer so channel-specific allow or block checks reuse one shared matcher path instead of re-implementing near-duplicate `is*SenderAllowed` and `is*SenderBlocked` helpers per channel.

## Status

Planned

## Why

`src/channels/pairing/access.ts` currently duplicates the same matching structure across channels:

- normalize configured allowlist entries for one channel
- compute normalized sender id and optional handle for one inbound event
- check whether either normalized value is present
- duplicate block matching by delegating back into the allow matcher

This is visible today in pairs such as:

- `isTelegramSenderAllowed(...)`
- `isTelegramSenderBlocked(...)`
- `isZaloBotSenderAllowed(...)`
- `isZaloBotSenderBlocked(...)`

The duplication is small, but it sets the wrong extension pattern:

- every new channel is tempted to add another hand-written matcher pair
- logic drift becomes more likely over time
- review cost rises for changes that should be shared

## Scope

- define one shared matcher model for pairing access checks
- separate channel-specific normalization from generic id or handle matching
- remove obvious duplication between Telegram and Zalo Bot matcher pairs
- clarify where Slack truly differs versus where it only looks different because of current helper shape
- keep behavior unchanged in the standardization pass

## Non-Goals

- redesigning the whole auth system
- changing surface policy semantics
- changing canonical identity forms in the same batch unless required by a separate approved task

## Current Problem

The current file mixes two layers:

- normalization rules that really are channel-specific
- matching flow that is mostly generic

That boundary is too blurry today, so extension pressure falls onto copy-paste instead of reuse.

## Proposed Direction

Use a split like:

- channel-specific normalization adapter
- shared matcher function that accepts normalized candidate values
- shared allow/block wrapper behavior

Likely shape:

- one helper to normalize configured entries for a given channel
- one helper to build normalized sender candidates from runtime input
- one helper to answer whether any candidate matches the configured set

Then channel-specific wrappers, if still needed, should stay minimal.

## Suggested Implementation Order

### 1. Freeze the matcher contract

- identify the canonical matcher inputs
- define where ids, handles, and future candidate forms belong

### 2. Collapse Telegram and Zalo Bot duplication first

- they are currently the clearest repeated pair
- keep tests behavior-identical

### 3. Re-evaluate Slack

- determine whether Slack needs a dedicated wrapper or can use the same generic matcher with one candidate form

## Validation Notes

When implementation happens later, verify:

- Slack allow and block matching is unchanged
- Telegram allow and block matching is unchanged
- Zalo Bot allow and block matching is unchanged
- alias cleanup and canonical naming work remains compatible with the matcher seam

## Exit Criteria

- shared matcher flow exists for pairing access checks
- channel-specific code is limited to true normalization differences
- new channels no longer need copy-pasted allow/block matcher pairs by default

## Related Docs

- [Pairing Allowlist Alias Cleanup And Canonical Identity Naming](2026-05-09-pairing-allowlist-alias-cleanup-and-canonical-identity-naming.md)
- [App And Agent Authorization And Owner Claim](2026-04-14-app-and-agent-authorization-and-owner-claim.md)
