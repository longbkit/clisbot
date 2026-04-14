---
title: Fix Channel-Scope Bugs By Narrowing Materialization, Not Changing Global Loader Semantics
date: 2026-04-14
area: configuration, control, channels
summary: When a CLI path only needs one channel, the fix should usually narrow credential materialization to that channel instead of introducing a new config-loading mode or changing shared helper contracts.
related:
  - ../features/configuration/start-bootstrap-and-credential-persistence.md
  - ../../src/config/load-config.ts
  - ../../src/config/channel-credentials.ts
  - ../../src/control/message-cli.ts
---

# Fix Channel-Scope Bugs By Narrowing Materialization, Not Changing Global Loader Semantics

## What Happened

`clisbot message send --channel telegram ...` was failing when Slack token env vars were missing.

The bug was real, but the first attempted fix went too wide:

- it switched `message-cli` to a different config-loading path
- that new path skipped broader env-resolution behavior, not just Slack credential materialization
- it also changed the practical meaning of shared account-resolver helpers

That removed the immediate symptom, but it created new regression risk in unrelated config behavior.

## Why It Matters

This is a common failure mode in configuration-heavy systems:

- the bug is narrow
- the first fix changes a larger shared layer
- the patch starts needing extra explanation, exception handling, or follow-up fixes

That is usually a sign the seam is wrong.

For `clisbot`, config loading, env resolution, and credential materialization are related but not identical concerns.

If a bug is specifically about channel credential scope, the fix should stay at the credential-scope layer whenever possible.

## Reusable Rule

When a command only operates on one channel:

- keep shared config-loading semantics unchanged
- keep shared helper contracts unchanged
- narrow credential materialization to the requested channel
- add tests that prove the unrelated channel no longer gates the command

Prefer:

- `loadConfig(..., { materializeChannels: ["telegram"] })`

Avoid:

- introducing a new loader mode unless the whole command truly needs different config semantics
- re-resolving credential sources inside helper functions that used to consume already-loaded config

## Practical Review Check

Before shipping a fix like this, ask:

1. Is the bug about a narrow scope, but the patch changes a wider layer?
2. Did the fix change config semantics outside the bug?
3. Did any shared helper silently change contract?
4. Does the test lock the real production seam, not just a mocked outcome?

If the patch becomes harder to explain than the bug, the fix is probably too broad.
