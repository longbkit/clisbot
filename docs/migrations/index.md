# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: any version before 0.1.51 -> 0.1.51
Update path: direct
Manual action: none
Risk: low
Automatic config update: yes for installs before `0.1.50`; `0.1.51` itself does not add a new schema migration
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/v0.1.51.md
```

This includes released `0.1.43` configs, older legacy configs before `0.1.43`, internal `0.1.44` pre-release configs, and `0.1.50` installs that only need the package-level `0.1.51` runtime default update.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
