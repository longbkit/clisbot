# AI Review Checklist

## Purpose

Use this checklist when asking AI to review work in this repo.

It is intentionally short and high-leverage.

The goal is not broad generic review.

The goal is to force review through the highest-risk lenses first, then keep looping until the artifact is truly clear and defensible.

Related lesson:

- [Channel Planning And Review Should Use One Owner Per Decision And One Reason To Change](../lessons/2026-05-09-channel-planning-and-review-should-use-one-owner-per-decision-and-one-reason-to-change.md)

Related workflow principle:

- [Workflow Principles Draft](workflow-principles-draft.md)

Named lenses to apply when the work touches architecture, channels, config binding, or cross-cutting behavior:

- `Robert C. Martin lens`: one dominant reason to change per module
- `Martin Fowler lens`: one canonical owner per decision; duplicate decision paths are a stronger smell than duplicate lines

## Checklist

### 1. Readability first

If config, CLI, docs, or code is not instantly easy to understand, stop and simplify before judging anything else.

### 2. Naming and concepts

One concept should have one name.

Review:

- consistency
- prefix and suffix form
- reuse of existing naming
- near-duplicate names that may signal wrong boundaries, duplicate logic, or concept leaks

### 3. Shape and mental model

Review:

- file size
- function size
- nesting depth
- whether architecture stays cleanly separated from implementation detail
- whether one file is carrying transport, policy, binding, and syntax decisions at the same time
- whether the same decision is implemented again in another layer with slightly different branching

### 4. Real user path

Review the real path, not only local code quality:

- first run
- normal use
- follow-up behavior
- debug and recovery flow
- whether the surface feels predictable and easy to review from the user side

### 5. Risk sweep

Check:

- security
- stability
- dangerous fallbacks

If a fallback hides truth, deepens coupling, or makes future extension harder, reject it.

### 6. Decision ownership sweep

Check:

- where principal normalization lives
- where target parsing lives
- where route binding lives
- where behavior-config binding lives
- where processing-indicator lifecycle lives

If any of those answers is "it depends on which channel branch you read," treat that as a structural finding.

## How To Use It

Use this checklist:

- as one short prompt
- as a looped review prompt
- or one section at a time when deeper review is needed

Suggested operating mode:

- review one section
- patch
- rerun the next section
- keep looping until the result is genuinely clear instead of only superficially acceptable

For channel work, do not stop at "tests pass" if either named lens still reports dirty boundaries or duplicated decision paths.
