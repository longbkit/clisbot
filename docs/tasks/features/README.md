# Feature Task Folders

## Purpose

Use `docs/tasks/features/` to group task docs by product area so the backlog stays easy to navigate.

Examples:

- `channels`
- `agents`
- `runners`
- `control`
- `configuration`

## Folder Rules

- use kebab-case
- keep names stable
- prefer product-area names over team or implementation names
- keep the tree shallow

## Task Placement Rules

Put a task doc here when:

- the work clearly belongs to one canonical system feature
- future related tasks will likely live beside it
- the feature benefits from local browsing

Keep the task doc in the root `docs/tasks/` folder when:

- the task is cross-cutting
- the task spans several feature areas
- the task is process or architecture work
