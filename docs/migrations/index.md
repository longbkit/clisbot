# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: any version before 0.1.53 -> 0.1.53
Update path: direct
Manual action: none
Risk: medium
Automatic config update: yes; configs before schema `0.1.53` are backed up and rewritten to add the new admin-only sensitive channel permissions
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/v0.1.53.md
```

`0.1.53` is a broad internal boundary refactor release. It does not require
manual config edits. It introduces a config schema update to `0.1.53` so
existing admin roles receive `contactsManage`, `groupsManage`, and
`sensitiveChannelActionManage` once during upgrade.

The release also fixes status summary rendering for legacy configs that omit
disabled provider bot records, while preserving strict failures for enabled
providers missing their configured default bot record. It removes stale
release/publish recovery text from update help, fixes CLI count/times loop
creation so requested iterations are persisted immediately as durable queue
items, fixes queue/message-tool settlement and recent-context command filtering,
keeps Zalo Bot streaming behavior truthful for an append-only channel, improves
Slack persistent indicator cleanup after restart or reload, and adds the larger
README/user-guide refresh with Zalo Bot QR onboarding and Zalo Personal
attachment/media-group guidance.

Operators should still watch startup, route, queue, loop, and channel-specific
behavior after restart because many files moved behind the same public
contracts.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
