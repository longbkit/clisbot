---
title: Released Runner Default Changes Must Clean Up Stale Persisted Overrides
date: 2026-04-28
area: configuration, migration, runners, release
summary: When a released runtime default was too low or otherwise wrong, changing the schema default is not enough. Migration and persistence logic must actively clean stale values that were written under the old assumption, including values that look like per-agent overrides but are really accidental pinned defaults.
related:
  - docs/tasks/features/runners/2026-04-24-codex-runner-path-drift-and-update-notice-hardening.md
  - docs/tasks/features/dx/2026-04-24-codex-model-continuity-and-release-drift-compatibility.md
  - docs/features/runners/tmux-runner.md
  - docs/lessons/2026-04-13-cli-trust-flow-drift-must-update-runner-defaults-and-existing-agent-config.md
  - docs/lessons/2026-04-25-auth-config-decisions-must-follow-operator-mental-model-and-release-compatibility.md
---

## Context

The April 28-29, 2026 startup-delay work exposed a release trap:

- the product learned that the old startup delay assumption was too low
- the schema default was raised
- but older installs could still keep smaller values in persisted config
- some of those values looked like deliberate overrides even though they were only yesterday's mistaken default

That means runtime behavior can stay pinned to old assumptions long after the code ships a better default.

## Lesson

For release-facing defaults, persisted config is part of the product.

Do not treat every stored value as sacred custom intent when the product itself previously wrote that value as part of a bad default era. The migration logic needs a rule for recognizing and clearing stale ownership.

## Practical Rule

When a shipped default is corrected upward because the old baseline is no longer acceptable:

1. update the schema default
2. update template and persistence behavior
3. inspect migration paths for old global, per-runner, and per-agent fields
4. remove persisted values that fall inside the old-invalid range when they are better explained as legacy default residue than as intentional operator tuning

This rule is especially important for startup and readiness timing, where too-low values can make the product look flaky.

## Design Rule

Migration should be conservative about destroying true operator intent, but it should not be so conservative that obviously stale defaults survive forever.

If the product now knows "anything below this threshold is not operationally valid anymore," the upgrader is allowed to clean those values instead of preserving them blindly.
