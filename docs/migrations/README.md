# Manual Migrations

## Purpose

Use `docs/migrations/` only when an update requires manual operator action.

Agents should read [`index.md`](index.md) first during updates. It is the short machine-readable decision file. This README is for maintainers writing future migration docs.

## File Layout

- `index.md`: short update path index for agents.
- `vA.B.C-to-vX.Y.Z.md`: one runbook per required manual migration path.
- `templates/migration.md`: template for future migration notes.

## Writing Rule

Create a migration runbook only when at least one field below is not safe/automatic:

- `Manual action`
- `Update path`
- `Breaking change`
- `Rollback`
- `Intermediate version`

For every release, still update or verify [`index.md`](index.md) so operators and agents can answer the migration question without inventing a runbook.

## Current Manual Migrations

No current stable update requires a manual migration runbook.
