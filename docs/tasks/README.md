# Task Docs

## Purpose

Use `docs/tasks/` as the working project-management layer for this repository.

This folder should answer, quickly:

- what is active
- what is next
- where the task doc lives
- what subtasks matter
- what related product or architecture docs should be read first

`backlog.md` is the canonical index.

## Information Architecture

Keep task docs easy to scan from generic to detail:

1. `backlog.md`
2. feature folder
3. task entry doc
4. supporting docs only when needed

Suggested structure:

```text
docs/tasks/
  README.md
  backlog.md
  yyyy-MM-dd-cross-cutting-task.md
  features/
    README.md
    channels/
      yyyy-MM-dd-channel-task.md
    agents/
      yyyy-MM-dd-agents-task.md
```

## Core Rules

- `backlog.md` is the source of truth for task status and priority.
- Every task must have one main entry doc.
- Main entry doc filenames must use `yyyy-MM-dd-<taskname>.md`.
- Small tasks should be one file.
- Large tasks may use a folder, but the entry doc inside that folder must still use `yyyy-MM-dd-<taskname>.md`.
- Keep docs under `500` lines when possible.
- Split before the doc becomes noisy.
- Prefer links over repeated context.
- Do not copy long requirement text from other docs when a link and short summary are enough.

## Where Tasks Go

Use the root of `docs/tasks/` for:

- cross-cutting work
- process work
- architecture work that spans multiple features

Use `docs/tasks/features/<feature-name>/` for:

- work tied to one canonical system feature
- bug-fix batches tied to one product system
- UX, runtime, or QA follow-up work tied to one feature

## Backlog Flow

When a new task starts:

1. add one row to `backlog.md`
2. create the task entry doc
3. link the task doc from the backlog row
4. track subtasks inside the task doc, not in the backlog table
5. link related product, architecture, UX, or lesson docs instead of repeating them

When a task completes:

1. update the status in `backlog.md`
2. leave the task doc in place as project memory
3. add follow-up tasks as new dated docs instead of endlessly rewriting one old task
