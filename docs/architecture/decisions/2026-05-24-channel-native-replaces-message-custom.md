# Channel-Native Replaces Message Custom

## Status

Accepted

## Date

2026-05-24

## Context

[Shared Message Surface And Channel-Owned Custom Subtrees](2026-05-10-shared-message-surface-and-channel-owned-custom-subtrees.md) introduced `clisbot message custom ...` as a possible provider-extension gateway.

Zalo Personal later moved provider-specific capabilities into named `channel-native` commands. Keeping the unused `message custom` gateway caused operator confusion because agents could try a stale shared path instead of the shipped channel-native surface.

## Decision

Remove `message custom` from the public shared message CLI.

Provider-specific capabilities must use named `channel-native` commands unless they are promoted into a portable shared command.

## Rationale

- A named native command is easier to document, test, and permission-gate than a raw provider subtree.
- The shared `message` CLI stays limited to portable message actions.
- Operators and agents get one obvious path for Zalo-only features such as enhanced sends, typing cues, stickers, polls, and other native actions.

## Supersedes

This decision supersedes the `message custom` gateway portion of [2026-05-10-shared-message-surface-and-channel-owned-custom-subtrees](2026-05-10-shared-message-surface-and-channel-owned-custom-subtrees.md).
