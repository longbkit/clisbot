# Pairing Allowlist Alias Cleanup And Canonical Identity Naming

## Summary

Remove or deprecate low-value alias prefixes in pairing and allowlist matching where they add naming ambiguity without clear user-facing benefit, then document one canonical identity form per channel.

## Status

Planned

## Why

`src/channels/pairing/access.ts` currently accepts multiple prefixes for allowlist and blocklist entries, including examples such as:

- `telegram:`
- `tg:`
- `zalo-bot:`
- `zalo:`
- `user:`

This has two costs:

- it makes the naming model harder to trust because multiple strings can mean the same thing
- some aliases are generic enough to be misleading, especially `user:`

Current docs already tend to use clearer canonical forms such as:

- bare Slack user ids
- bare Telegram numeric ids
- `zalo-bot:<id>` in principal-like contexts

There is little evidence that aliases such as `zalo:` or generic `user:` are delivering meaningful operator value today.

## Scope

- inventory where allowlist and pairing aliases are accepted today
- separate true compatibility requirements from accidental convenience aliases
- choose one canonical form per channel for operator-facing docs and config examples
- decide which aliases should be removed, deprecated, or kept temporarily behind explicit compatibility notes
- add targeted regression coverage around the final accepted forms

## Non-Goals

- redesigning the whole auth model
- changing owner principal storage format across the whole repo in the same batch
- broad runtime behavior refactors unrelated to allowlist matching

## Current Problem

The current alias set mixes:

- platform-specific canonical-looking prefixes
- shorthand compatibility prefixes
- generic cross-platform prefixes

That blend is risky because the reader can no longer infer:

- which strings are canonical
- which strings are legacy-only
- which strings are just parser convenience

## Proposed Direction

- define one canonical operator-facing identity form per channel
- keep compatibility aliases only when there is real migration evidence
- treat generic aliases such as `user:` with skepticism by default
- make docs and tests clearly distinguish canonical versus compatibility-only inputs

## Suggested Implementation Order

### 1. Freeze canonical naming

- document the preferred form for Slack
- document the preferred form for Telegram
- document the preferred form for Zalo Bot

### 2. Audit compatibility value

- search config migration paths
- search docs
- search tests
- search any CLI flows that emit alias forms

### 3. Remove or deprecate ambiguous aliases

- preferably remove `zalo:` and `user:` where safe
- keep only the smallest compatibility surface needed

## Validation Notes

When implementation happens later, verify:

- current documented config examples still work
- pairing approve flows still emit or persist canonical values
- block and allow matching remain stable for real configured users
- no hidden CLI path still depends on removed aliases

## Exit Criteria

- canonical naming is explicit in docs and code
- low-value ambiguous aliases are removed or clearly marked as compatibility-only
- tests reflect the intended canonical forms instead of preserving ambiguity by default

## Related Docs

- [App And Agent Authorization And Owner Claim](2026-04-14-app-and-agent-authorization-and-owner-claim.md)
- [Audience-Scoped Access And Delegated Specialist Bots](2026-04-21-audience-scoped-access-and-delegated-specialist-bots.md)
