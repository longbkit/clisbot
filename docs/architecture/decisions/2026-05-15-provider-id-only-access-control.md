---
title: Provider Id Only Access Control
status: accepted
date: 2026-05-15
---

# Context

Channel access checks use `allowUsers`, `blockUsers`, pairing approval, and
auth principals across Slack, Telegram, and Zalo Bot.

Provider handles and usernames are useful for display and prompt context, but
they are not stable authorization identity:

- they can change after access is granted
- they can be missing
- they can collide or be recycled
- they can mean different things across providers
- some providers do not expose a canonical handle at all

Zalo Bot made the risk concrete because its provider user id can be long
hex-like or mixed alphanumeric text. Treating bare text as a possible handle
created ambiguity between a real provider id and an invented alias.

# Decision

Access control is based on raw provider-local user ids only.

This applies to:

- `allowUsers`
- `blockUsers`
- pairing approval writes
- shared-route sender admission
- direct-message pairing admission

Handles, usernames, display names, and mention syntax are not authorization
identities. They may be stored or rendered as display metadata, but they must
not be matched by `allowUsers`, `blockUsers`, or pairing access checks.

Channel-specific rules:

- Slack uses Slack user ids such as `U...` or `W...`; optional `slack:` and
  `user:` input prefixes normalize to the same raw id.
- Telegram uses numeric `from.id`; usernames such as `@alice` do not authorize.
- Zalo Bot uses the raw provider id returned by the Bot API and pairing reply;
  it may be numeric, hex-like, or mixed alphanumeric. `@...` entries are not
  accepted as aliases.

# Why

The operator model stays simple: copy the exact provider user id from
`/whoami`, pairing guidance, or provider metadata into access config.

This avoids hidden identity-linking behavior and prevents a future handle
change from silently moving access to the wrong person or removing access from
the intended person.

# Consequences

Good:

- access checks are stable across handle changes
- channel integrations cannot inherit handle-based authorization accidentally
- pairing approval stores the same id that the provider reported
- docs and tests can state one rule for every channel

Tradeoff:

- operators cannot grant access by friendly handle unless a future explicit
  identity-linking feature is designed, reviewed, and tested separately
