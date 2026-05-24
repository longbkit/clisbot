# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: 0.1.52 -> 0.1.53-beta.6
Update path: direct
Manual action: none
Risk: medium
Automatic config update: yes; configs before schema `0.1.53` are backed up and rewritten to add the new admin-only sensitive channel permissions
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/upcoming.md
```

`0.1.53-beta.6` is a broad internal boundary refactor beta. It does not require
manual config edits. It does introduce a config schema update to `0.1.53` so
existing admin roles receive `contactsManage`, `groupsManage`, and
`sensitiveChannelActionManage` once during upgrade. Compared with
`0.1.53-beta.1`, it fixes status summary
rendering for legacy configs that omit disabled provider bot records, while
preserving strict failures for enabled providers missing their configured
default bot record. Compared with `0.1.53-beta.2`, it also removes stale
release/publish recovery text from update help. Compared with
`0.1.53-beta.3`, it fixes CLI count/times loop creation so requested iterations
are persisted immediately as durable queue items instead of waiting for the
target session to become idle. Compared with `0.1.53-beta.4`, it fixes
queue/message-tool settlement, recent-context command filtering, Zalo Bot
append-only streaming truthfulness, and Slack persistent indicator cleanup after
restart or reload. Compared with `0.1.53-beta.5`, it adds docs and channel
onboarding updates, including localized README/user-guide mirrors, Zalo Bot QR
onboarding, and Zalo Personal attachment/media-group guidance. Beta testers
should still watch startup, route, queue, loop, and channel-specific behavior
because many files moved behind the same public contracts.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
