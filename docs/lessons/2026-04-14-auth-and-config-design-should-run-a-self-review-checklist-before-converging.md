---
title: Auth And Config Design Should Run A Self-Review Checklist Before Converging
date: 2026-04-14
area: configuration, control, prompts, docs
summary: For auth and config design, do not wait for human pushback to expose gaps. First force a short self-review of current vs target behavior, ownership boundaries, default semantics, enforcement layers, operator workflow, regression risks, and compatibility policy before settling on syntax or docs.
related:
  - docs/features/configuration/app-and-agent-authorization-and-owner-claim.md
  - docs/tasks/features/configuration/2026-04-14-app-and-agent-authorization-and-owner-claim.md
  - docs/tasks/features/control/2026-04-14-auth-aware-cli-mutation-enforcement-and-runner-command-guardrails.md
  - docs/user-guide/auth-and-roles.md
  - src/channels/agent-prompt.ts
  - src/channels/interaction-processing.ts
---

## Context

This lesson came from the April 14, 2026 design review for app roles, agent roles, owner claim, prompt safety, and route-local bash privilege policy.

The design improved significantly only after repeated human questioning forced the following clarifications:

- current behavior versus target behavior
- app-level versus agent-level versus route-local ownership
- prompt guidance versus runtime slash-command enforcement versus later CLI enforcement
- neutral fallback roles versus real privileged roles
- legacy compatibility versus explicit fail-fast replacement
- developer implementation contract versus operator-facing quickstart

The important signal was not only the final design. The more important signal was that the review questions themselves should have been asked proactively before converging.

## Lesson

For this repository, config and auth design should be treated as a structured review exercise, not just a naming or schema exercise.

Before converging on config syntax, docs, or enforcement scope, proactively ask the same questions a strong product or technical reviewer would ask.

Do not wait for the human to drag the design there through multiple rounds.

## Self-Review Checklist

When proposing or patching auth, permissions, config grammar, or other operator-facing policy:

1. What is the current shipped behavior, and what is the target behavior?
2. Which layer owns each concern:
   admission, authorization, route-local restriction, prompt guidance, runtime enforcement, later control enforcement?
3. What is the default or fallback behavior, and could that fallback be misread as a privileged state?
4. Which parts are advisory only, and which parts are actually enforced at runtime?
5. If prompts are involved, is safety-critical auth truth injected from a protected layer rather than only from editable templates?
6. Does the design need backward compatibility or migration, or is fail-fast replacement cleaner for this stage of the product?
7. What are the most likely regression risks, and are they named explicitly in docs or tests?
8. Does the repo now have both:
   a developer implementation contract and an operator-facing quickstart?
9. What exact operator flow should someone follow:
   first claim, add user, remove user, denial handling, common examples?
10. Are naming, config shape, CLI grammar, docs, and status language all using the same concepts consistently?

## Practical Rule

For future config or auth design work:

- write a short "current vs target" section early
- write the ownership boundaries early
- write the runtime-versus-advisory split early
- force one regression-risk section before calling the doc ready
- decide compatibility policy explicitly instead of leaving it implicit
- add or queue the missing operator doc in the same batch if the feature is user-facing

If these answers are still fuzzy, the design is not ready to converge.

## Applied Here

This lesson was applied by:

- clarifying that app auth and agent auth share one grammar but have different authority scopes
- clarifying that app-level `member` is a neutral fallback, not a meaningful app privilege role
- documenting that prompt auth facts must live in a protected prompt segment
- separating prompt guidance, slash-command gating, and later CLI enforcement into different slices
- explicitly choosing to reject legacy `privilegeCommands.enabled` and `allowUsers` instead of carrying a compatibility mode
- adding regression-risk coverage to the auth task doc
- adding a separate operator-facing page for auth and roles so the feature is not documented only for developers
