---
title: Operator Errors Must Be Friendly And Actionable
date: 2026-04-08
area: control, runtime, channels
summary: Startup and runtime failures should render as operator guidance with the next action, not as raw exceptions or vague failure messages.
related:
  - docs/user-guide/README.md
  - src/main.ts
  - src/control/commands/operator-errors.ts
  - src/control/runtime/runtime-process.ts
  - src/control/runtime/runtime-supervisor.ts
  - src/config/env/env-substitution.ts
---

## Context

This lesson comes from repeated Codex feedback in the `clisbot` project around `start`, config reload, missing env vars, and Telegram startup conflicts.

It was confirmed against local Codex session history captured during project work, including explicit user corrections asking for active token checks, clearer warning emphasis, and removal of raw exception stacks from normal operator output.

The recurring human feedback was:

- missing token or env-var problems should be caught before the runtime fails when possible
- if the runtime still fails, the message should explain what to do next
- raw source-code exceptions and stack traces are not acceptable as normal operator output
- "failed to start" is not enough without token hints, log path, docs, and the likely fix

This pattern appeared in startup flow, config reload flow, and Telegram `getUpdates` conflict handling.

One notable signal from the session history was that the user even corrected warning punctuation and emphasis, which means the readability of operator failures is part of the product contract here, not just cosmetic polish.

## Lesson

Operator-visible failures should be treated as part of the product surface, not as internal debugging leftovers.

Preferred behavior:

- validate likely operator mistakes early
- render a short error summary
- include the concrete next action
- include the exact config path, env var, log file, or command that matters
- keep raw exception stacks out of normal operator flow

## Practical Rule

Before closing an operator-facing error path, check:

1. Does the message say what failed in one sentence?
2. Does it name the exact env var, config path, route, or log file involved?
3. Does it tell the operator what to run or edit next?
4. Would this still be understandable if the user never opens the source code?

## Applied Here

This lesson was applied by:

- adding active token checks before startup where possible
- rendering friendly missing-env guidance instead of raw substitution exceptions
- surfacing startup log tails on failure
- treating Telegram startup conflict as a product error case that needs clearer handling
