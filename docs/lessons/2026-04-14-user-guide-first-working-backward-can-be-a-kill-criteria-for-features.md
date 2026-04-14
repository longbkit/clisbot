---
title: User Guide First Working Backward Can Be A Kill Criteria For Features
date: 2026-04-14
area: docs, product, configuration
summary: For operator-facing and user-facing features, create and review the user guide early as a working-backward artifact. Mark its maturity explicitly, gather feedback on the guide first, and be willing to cancel the feature if the user guide fails to tell a compelling and coherent story.
related:
  - docs/user-guide/README.md
  - docs/user-guide/auth-and-roles.md
  - docs/features/configuration/app-and-agent-authorization-and-owner-claim.md
  - docs/tasks/features/configuration/2026-04-14-app-and-agent-authorization-and-owner-claim.md
---

## Context

This lesson came from a new working method proposed on April 14, 2026.

The key idea was close to Amazon-style working backward:

- start from the user guide
- review the user guide before converging on implementation
- mark the guide's maturity clearly
- use user feedback on the guide itself to shape the feature
- cancel the feature if the guide still does not make sense

The important insight is that for operator-facing products, the user guide is not only documentation after the fact. It is an early product-design artifact.

## Lesson

For this repository, major operator-facing or user-facing features should often start with a user-guide draft, not end with one.

If the guide cannot explain the feature clearly, the feature itself is probably not ready.

That should be treated as a product warning, not a documentation delay.

## Practical Rule

When a feature changes operator workflow, config, permissions, onboarding, or troubleshooting:

1. Draft the user guide early.
2. State clearly whether that guide is:
   explore, spec-ready, alpha, beta, or official.
3. Review the guide as if it were the launch surface.
4. Ask whether a real operator could:
   understand the value, follow the flow, predict the behavior, and recover from errors.
5. Use feedback on the guide to reshape the feature before implementation hardens.
6. If the guide still feels confusing, forced, or not worth using, be willing to cancel or re-scope the feature.

## Review Questions

Before calling a user-facing feature ready:

1. Does the user guide make the feature feel obviously useful?
2. Is the workflow understandable without internal architecture context?
3. Are the status labels explicit enough that readers know whether the guide is exploratory or production-grade?
4. Does the guide expose unclear naming, awkward config, or missing runtime feedback?
5. Would cancelling the feature be the right choice if the guide still reads badly after review?

## Applied Here

This lesson should influence future feature work by:

- encouraging earlier user-guide drafts for config and auth work
- making guide maturity visible instead of pretending everything is already production-ready
- treating guide review as a source of product feedback, not just copyediting
- allowing the team to stop or narrow features whose user guide never becomes convincing
