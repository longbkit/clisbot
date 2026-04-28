# Migrations

## Purpose

Use `docs/migrations/` for concrete upgrade runbooks.

Release notes say what changed. Migration notes say exactly how to move safely from one version to another when config, schema, runtime state, credentials, or operational behavior may need attention.

## File Layout

- `vA.B.C-to-vX.Y.Z.md`: one runbook per meaningful upgrade path.
- `templates/migration.md`: template for future migration notes.

## Writing Rule

Migration notes should be procedural and verifiable:

- who needs the migration
- preflight checks
- backup or rollback location
- upgrade steps
- post-upgrade verification
- downgrade or rollback caveats

Do not create a migration note for every release. Create one only when the operator may need a concrete procedure.

## Current Migrations

- [v0.1.43 to v0.1.45](v0.1.43-to-v0.1.45.md)
