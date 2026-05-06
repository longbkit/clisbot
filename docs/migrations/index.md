# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: any version before 0.1.52 -> 0.1.52
Update path: direct
Manual action: none
Risk: low
Automatic config update: yes for installs before `0.1.50`; `0.1.52` itself does not add a new schema migration, but may still rewrite current-schema configs if stale short startup-delay overrides are detected
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/v0.1.52.md
```

This includes released `0.1.43` configs, older legacy configs before `0.1.43`, internal `0.1.44` pre-release configs, and `0.1.50` or `0.1.51` installs that only need the package-level `0.1.52` update plus stale-startup-delay cleanup when old short overrides are still pinned.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
