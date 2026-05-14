---
title: Early-Phase Product Should Not Add Fallback Or Compatibility Modes
date: 2026-04-10
area: product, runtime, configuration
summary: While clisbot is still early, optimize the intended path directly instead of adding fallback modes, compatibility branches, or temporary dual behavior.
related:
  - docs/lessons/2026-04-08-new-products-should-not-carry-legacy-surface-compat.md
  - docs/research/channels/2026-04-10-slack-latency-and-stability-audit.md
  - docs/tasks/features/channels/2026-04-04-slack-channel-mvp-validation-and-hardening.md
  - src/channels/message/agent-prompt.ts
  - src/agents/runtime/runner-service.ts
---

## Context

This was clarified explicitly on April 10, 2026 during live latency and stability optimization work.

The product is still in an early phase.

That means the correct default is:

- no fallback mode
- no compatibility mode
- no extra branch kept only to soften incomplete design decisions

## Lesson

When the intended path is too slow or unstable, fix that path directly.

Do not respond by adding:

- legacy compatibility shims
- alternate behavior toggles just to preserve current drift
- temporary fallback execution paths that reduce clarity

If a tradeoff is real and user-visible, raise it explicitly with the user before introducing it.

## Practical Rule

For early-phase runtime work in this repo:

1. identify the intended product path
2. measure it directly
3. optimize it directly
4. remove design drift instead of layering around it

If a proposed change depends on "keep both behaviors for now", that is usually a sign the product surface is not settled enough yet and should be simplified first.

## Applied Here

This rule applies to the current delay and stability work:

- do not add a fallback response path just to hide slow message-tool delivery
- do not keep a second compatibility behavior for startup or prompt routing unless it is intentionally part of the product
- optimize Slack and Telegram routed agent handling on the real intended path, then re-measure against the audit baseline
