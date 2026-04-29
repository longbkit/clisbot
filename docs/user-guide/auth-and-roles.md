# Authorization And Roles

## Mental Model

There are two separate questions:

1. may this person reach the bot on this surface at all?
2. if they can reach it, what commands may they run?

In `clisbot`:

- surface admission is handled by DM/shared route policy
- command privilege is handled by app and agent auth

## Surface Admission

### Shared surfaces

- `disabled` means fully disabled and silent
- enabled shared surfaces may use `open` or `allowlist`
- `allowUsers` and `blockUsers` are enforced before runner ingress
- if allowlist rejects a sender, the bot replies with:

`You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`

### Owner/admin behavior

- app `owner` and app `admin` may use enabled shared surfaces even when allowlist would reject normal users
- `blockUsers` still wins
- `disabled` still wins

### DM surfaces

- DM wildcard defaults live on `directMessages["*"]`
- pairing approval writes to that requesting bot's wildcard DM route
- exact DM routes may carry per-user admission or behavior overrides when needed

## Invariants

- surface policy answers "may this principal reach this surface at all"
- auth roles answer "after they get in, what may they do"
- owner/admin do not bypass `groupPolicy`/`channelPolicy` admission; after a group is admitted and enabled, they bypass sender allowlists
- owner/admin do not bypass `disabled`
- owner/admin do not bypass `blockUsers`
- the deny text intentionally says `group` as the common many-people term

## Roles

Current app roles:

- `owner`
- `admin`
- `member`

Current agent roles:

- `admin`
- `member`

Important current behavior:

- app `owner` and app `admin` bypass DM pairing
- app `owner` and app `admin` implicitly satisfy agent-admin checks
- `principal` is the auth identity format `<platform>:<provider-user-id>`
- principals stay platform-scoped such as `telegram:1276408333` and `slack:U123ABC456`
- use `--user <principal>` when assigning roles or permissions to a user
- use `--sender <principal>` when checking the effective permissions for the current message sender

## Common Commands

```bash
clisbot auth show app
clisbot auth show agent-defaults
clisbot auth get-permissions --sender telegram:1276408333 --agent default --json
clisbot auth add-user app --role owner --user telegram:1276408333
clisbot auth add-user app --role admin --user slack:U123ABC456
clisbot auth add-user agent --agent support --role admin --user slack:UOPS1
clisbot auth add-permission agent-defaults --role member --permission transcriptView
clisbot auth remove-permission agent-defaults --role member --permission shellExecute
```

## First Owner Claim

Runtime rule:

- if no owner exists when the runtime starts, owner claim opens for `ownerClaimWindowMinutes`
- the first successful DM during that window becomes app `owner`
- once an owner exists, claim closes immediately

## Practical Safe Defaults

- keep dangerous commands on auth, not on surface allowlists
- use surface policy to answer "who may talk here"
- use auth roles to answer "what may they do after they get in"
- use `clisbot auth get-permissions --sender <principal> --agent <id> --json` for a read-only effective permission check before sensitive actions
- use `disabled` when you want certainty that nobody gets a reply there

## Related Docs

- [Authorization](../features/auth/README.md)
- [Routes](channels.md)
- [Surface Policy Shape Standardization And 0.1.43 Compatibility](../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)
