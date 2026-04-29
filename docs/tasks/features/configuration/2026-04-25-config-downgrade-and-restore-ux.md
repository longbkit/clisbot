# Config Downgrade And Restore UX

## Status

Planned.

## Context

The `0.1.45` config migration optimizes for low-friction upgrade: when clisbot first reads a released `0.1.43` config, it backs up the original file and writes the new canonical shape automatically.

That is the right default for normal users, but downgrade and restore deserve an explicit operator surface instead of relying on manual file copying.

## Target

- list config backups
- show the current config schema version and latest backup
- restore a selected backup safely
- optionally support downgrade helpers when a future release needs them

## Candidate CLI

```bash
clisbot config backups list
clisbot config restore <backup-id-or-path>
clisbot config schema
```

## Guardrails

- restoring must back up the current config first
- restore output must print both the restored file and the new backup path
- do not silently downgrade across incompatible runtime versions
- keep this separate from the automatic upgrade path so first-run setup stays frictionless
