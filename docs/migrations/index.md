# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: 0.1.52 -> 0.1.53-beta.4
Update path: direct
Manual action: none
Risk: medium
Automatic config update: no new schema migration in `0.1.53-beta.4`; existing automatic config updates from earlier versions still apply when upgrading older installs
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/upcoming.md
```

`0.1.53-beta.4` is a broad internal boundary refactor beta. It does not require
manual config edits. Compared with `0.1.53-beta.1`, it fixes status summary
rendering for legacy configs that omit disabled provider bot records, while
preserving strict failures for enabled providers missing their configured
default bot record. Compared with `0.1.53-beta.2`, it also removes stale
release/publish recovery text from update help. Compared with
`0.1.53-beta.3`, it fixes CLI count/times loop creation so requested iterations
are persisted immediately as durable queue items instead of waiting for the
target session to become idle. Beta testers should still watch startup, route,
queue, loop, and channel-specific behavior because many files moved behind the
same public contracts.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
