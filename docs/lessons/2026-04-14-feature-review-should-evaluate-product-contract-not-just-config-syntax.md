---
title: Feature Review Should Evaluate Product Contract Not Just Config Syntax
date: 2026-04-14
area: product, docs, configuration, control
summary: When reviewing a feature, do not stop at whether the config shape is implementable or elegant. Review whether the product contract is coherent across users, surfaces, enforcement layers, operator workflow, fallback semantics, and maturity signals.
related:
  - docs/features/configuration/app-and-agent-authorization-and-owner-claim.md
  - docs/tasks/features/configuration/2026-04-14-app-and-agent-authorization-and-owner-claim.md
  - docs/user-guide/auth-and-roles.md
  - docs/lessons/2026-04-14-auth-and-config-design-should-run-a-self-review-checklist-before-converging.md
  - docs/lessons/2026-04-14-user-guide-first-working-backward-can-be-a-kill-criteria-for-features.md
---

## Context

This lesson came from repeated design-review rounds on April 14, 2026.

The strongest human feedback did not focus only on whether the config syntax looked clean.

It kept pushing the review upward to harder product questions:

- who can do what
- on which surface
- which layer truly enforces it
- what is only prompt guidance
- what fallback or default semantics might be misread
- whether the feature is clear enough to deserve shipping at all

That review pattern improved the design more than syntax polish alone.

## Lesson

For this repository, feature review should not stop at "can this be implemented" or "is this config shape elegant."

It should evaluate the full product contract.

If the contract is blurry, a clean schema is still not enough.

## Practical Rule

When reviewing a feature proposal, spec, or doc:

1. Ask what the user-visible contract actually is.
2. Ask which user or role can do what.
3. Ask which surface owns the action:
   prompt, slash command, routed runtime, operator CLI, or config edit.
4. Ask which parts are advisory and which parts are hard enforcement.
5. Ask whether defaults and fallbacks are safe and legible.
6. Ask whether transition policy is explicit:
   compatibility, migration, or fail-fast replacement.
7. Ask whether the operator flow is clean enough to stand on its own.
8. Ask whether the doc signals maturity clearly:
   explore, spec-ready, alpha, beta, or official.
9. Ask whether the feature still seems worth shipping if the user guide remains weak.

## Review Heuristics

Strong review should be able to expose at least these failure modes:

- elegant config with muddy operator workflow
- runtime enforcement that disagrees with prompt wording
- fallback roles that look harmless but create semantic risk
- docs that mix current truth with target design and confuse readers
- a feature that is implementable but still not compelling enough to exist

## Applied Here

This lesson was applied by:

- pushing the auth review above raw config syntax into product contract questions
- splitting developer contract, operator quickstart, and current runtime truth more clearly
- calling out prompt safety as a product boundary instead of mere wording polish
- making transition policy explicit for legacy `privilegeCommands` keys
- recognizing that a weak user guide can be a valid signal to cancel or re-scope a feature
