# Authorization

## Summary

Authorization defines who may do what in `clisbot`.

The current split is:

- surface admission and surface audience policy are stored in config
- app and agent permissions are resolved by auth

## State

Active

## Current Contract

### Surface-level rules

- `disabled` means fully disabled and silent, even for app `owner` and app `admin`
- on enabled shared surfaces, app `owner` and app `admin` may bypass allowlist checks
- `blockUsers` still wins
- shared allowlist failures are denied before runner ingress

Current shared deny text:

`You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`

### DM and shared defaults

- DM defaults live on `directMessages["*"]`
- shared defaults live on `groups["*"]`
- CLI ids stay human-facing:
  - `dm:*`
  - `group:*`
  - `group:<id>`
  - `topic:<chatId>:<topicId>`

### App roles

- app `owner` and app `admin` bypass DM pairing
- app `owner` and app `admin` do not bypass `groupPolicy`/`channelPolicy` admission; after a group is admitted and enabled, they bypass sender allowlist checks
- they do not bypass `disabled`
- they do not bypass `blockUsers`

## Implementation Invariants

- owner/admin sender-policy bypass applies only after the surface is admitted and enabled
- `disabled` is stronger than owner/admin convenience
- `blockUsers` is stronger than allowlist bypass
- shared allowlist rejection must happen before runner ingress
- the shared deny text stays generic to the many-people mental model and therefore says `group`

## Current Focus

The shipped auth slice is now:

- app and agent roles
- first-owner claim
- DM pairing bypass for owner/admin
- shared-surface audience gating for Slack and Telegram
- explicit deny-before-runner behavior for shared allowlist failures

The next auth slice is:

- command-level permission enforcement for sensitive actions on already-admitted surfaces

## Related Docs

- [Authorization And Roles](../../user-guide/auth-and-roles.md)
- [Configuration](../configuration/README.md)
- [Audience-Scoped Access And Delegated Specialist Bots](../../tasks/features/auth/2026-04-21-audience-scoped-access-and-delegated-specialist-bots.md)
