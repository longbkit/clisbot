# Feature Docs

## Purpose

Use `docs/features/` as the feature-planning layer for this repository.

This folder should answer:

- what feature areas exist
- what state each feature is in
- where the main feature doc lives
- which task folder contains delivery work
- where non-functional work is tracked

`feature-tables.md` is the canonical index.

## Information Architecture

Keep feature docs ordered from generic to detail:

1. `feature-tables.md`
2. feature or non-functional folder
3. feature overview doc
4. supporting docs only when needed
5. linked task docs in `docs/tasks/`

Suggested structure:

```text
  docs/features/
    README.md
    feature-tables.md
    channels/
      README.md
      decisions/
        README.md
    auth/
      README.md
    agents/
      README.md
    runners/
      README.md
    control/
      README.md
    configuration/
      README.md
    dx/
      README.md
    non-functionals/
      README.md
      architecture-conformance/
        README.md
```

## Core Rules

- `feature-tables.md` is the source of truth for feature state.
- Each feature should have one clear front door doc.
- Use stable folder names for ongoing feature areas.
- Keep feature docs broad and navigational.
- Keep the current canonical `what` and `why` here.
- Keep execution detail in `docs/tasks/`, not here.
- Link to `docs/tests/` when a feature has ground-truth scenarios for manual and automated validation.
- Link to task docs instead of duplicating subtasks or sprint notes.
- Keep docs under `500` lines when possible.
- Split when one feature doc becomes too broad or repetitive.

## What Goes Here

Use `docs/features/` for:

- feature overviews
- canonical current `what` and `why`
- scope boundaries
- current feature state
- dependencies between features
- feature-level references to task folders
- feature-local decision folders when the decision belongs to one feature instead of the repository architecture

Use `docs/tasks/` for:

- active implementation work
- subtasks
- delivery sequencing
- blockers tied to a specific task

## Folder Rules

Use `docs/features/<feature-name>/` for:

- the canonical top-level systems in the product model
- stable system groupings readers would recognize

Use `docs/architecture/decisions/` instead when the decision is repository-level, cross-feature, or mainly about system ownership boundaries.

Use `docs/features/<feature-name>/decisions/` when the topic is local to that feature, such as:

- end-user behavior choices
- feature-specific implementation detail
- local tradeoffs that do not redefine repository-level architecture

Use `docs/features/non-functionals/` for:

- performance
- security
- reliability
- accessibility
- tracing
- monitoring
- product analytics
- architecture conformance
- cross-cutting quality work

## Feature Table Flow

When a feature area is introduced:

1. add one row to `feature-tables.md`
2. create or link the feature front door doc
3. point to the related task folder in `docs/tasks/` if execution work exists
4. point to the related ground-truth test folder in `docs/tests/` when behavior needs explicit validation

When a feature grows:

1. split it into a feature folder
2. keep one short front door doc
3. link to deeper docs only when necessary

When a feature is stable or paused:

1. update the state in `feature-tables.md`
2. keep the feature doc as reference
3. start new dated task docs for new work instead of rewriting old execution history here
