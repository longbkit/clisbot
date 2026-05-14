# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: 0.1.52 -> 0.1.53-beta.1
Update path: direct
Manual action: none
Risk: medium
Automatic config update: no new schema migration in `0.1.53-beta.1`; existing automatic config updates from earlier versions still apply when upgrading older installs
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/upcoming.md
```

`0.1.53-beta.1` is a broad internal boundary refactor beta. It does not require
manual config edits, but beta testers should watch startup, route, queue, loop,
and channel-specific behavior because many files moved behind the same public
contracts.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
