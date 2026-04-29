# Configuration

## Summary

Configuration is the local control plane for `clisbot`.

Today the important mental model is:

- `app`: runtime-wide behavior
- `bots`: channel identities plus surface defaults
- `agents`: execution identity, workspace, and runner behavior

For surface access, the important split is:

- `directMessages`
- `groups`

inside each bot config.

For timezone, the important mental model is:

- `app.timezone`: default timezone for this install
- `agents.list[].timezone`: override when one assistant persona or workspace has a regional context
- route `timezone`: override when one group, channel, DM, or topic has a regional context
- persisted loop `timezone`: execution snapshot for an existing wall-clock loop, not user-facing config

Do not require new users to know IANA timezone values before first start. Fresh bootstrap may infer host timezone and write `app.timezone`, but start/status output must show what was inferred and how to change it.

## State

Active

## Current Contract

Inside one bot config:

- DM routes live under `directMessages`
- multi-user surfaces live under `groups`
- stored child keys use raw provider-local ids plus `*`

Examples:

- Slack DM wildcard:
  - `bots.slack.<botId>.directMessages["*"]`
- Slack shared wildcard:
  - `bots.slack.<botId>.groups["*"]`
- Slack shared surface:
  - `bots.slack.<botId>.groups["C1234567890"]`
  - `bots.slack.<botId>.groups["G1234567890"]`
- Telegram DM wildcard:
  - `bots.telegram.<botId>.directMessages["*"]`
- Telegram group:
  - `bots.telegram.<botId>.groups["-1001234567890"]`
- Telegram topic:
  - `bots.telegram.<botId>.groups["-1001234567890"].topics["42"]`

Operator CLI ids stay prefixed:

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

Backward-compatible CLI input such as `channel:<id>` still works, but it is not the preferred contract anymore.

## Surface Policy Model

### Defaults layer

Provider defaults now expose both:

- quick policy aliases:
  - `dmPolicy`
  - Slack `channelPolicy`
  - Slack `groupPolicy`
  - Telegram `groupPolicy`
- explicit wildcard route nodes:
  - `directMessages["*"]`
  - `groups["*"]`

Sync rules:

- `dmPolicy: "disabled"` means `directMessages["*"]` is disabled too
- shared `groupPolicy` and Slack `channelPolicy` control group admission
- `groups["*"].policy` controls the default sender policy inside admitted groups
- default shared admission is `allowlist`, so normal users need an exact `group:<id>` or `topic:<chatId>:<topicId>` route
- default sender policy inside admitted groups is `open`, so adding a group makes it usable immediately unless the operator passes another `--policy`

### Runtime meaning

- `disabled` means fully disabled and silent when set on admission policy or on a concrete route
- if a surface is enabled and the effective policy is `allowlist`, only allowed users may talk there
- app `owner` and app `admin` do not bypass `groupPolicy`/`channelPolicy` admission; after a group is admitted and enabled, they may bypass sender allowlist checks
- `blockUsers` still wins
- `disabled` still wins over everything

### Shared deny behavior

Shared allowlist failures are denied before runner ingress with:

`You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`

## Implementation Invariants

- canonical operator ids are `group:<id>`, `group:*`, `dm:<id|*>`, and `topic:<chatId>:<topicId>`
- Slack `channel:<id>` is compatibility input only
- canonical stored keys under one bot are raw ids plus `*`
- `group:*` is treated as the default multi-user sender policy node for one bot
- exact DM routes may carry admission config as well as behavior overrides
- the deny message says `group` on purpose because the chosen human model is one-person vs many-people, not provider-specific surface labels

## Timezone Model

Target canonical config uses `app.timezone` as the app-wide default.

`app.control.loop.defaultTimezone` is legacy config only. Migration should move it to `app.timezone`, remove it from the rewritten config document, and keep runtime read compatibility for old config files that were not migrated.

`bots.defaults.timezone`, `bots.slack.defaults.timezone`, and `bots.telegram.defaults.timezone` are also legacy default-level timezone fields. Migration should move their default intent into `app.timezone` when needed, then remove those fields from the rewritten config document so they cannot shadow app or agent timezone later.

Effective timezone for prompt timestamps and new wall-clock loop creation resolves in this order:

1. explicit one-off loop timezone
2. route or topic timezone
3. agent timezone
4. bot timezone
5. `app.timezone`
6. legacy `app.control.loop.defaultTimezone`
7. legacy `bots.defaults.timezone`
8. legacy `bots.<provider>.defaults.timezone`
9. host timezone

Guide and help should teach timezone in product order, not raw resolver order:

1. app default
2. agent persona/workspace override
3. current surface override
4. one-off loop override
5. bot advanced override

Persisted loop records keep their stored `timezone` so existing wall-clock loops do not shift when config changes.

Operator CLI wall-clock creation uses confirmation-required output for the first wall-clock loop before persisting it. Chat `/loop` creation intentionally stays lower-friction and persists immediately. For chat creation, the response must show the resolved timezone, next run in local time plus UTC, and the exact cancel command so the user can quickly cancel, set the correct app, agent, or surface timezone, then create the loop again if the timezone is wrong.

## 0.1.43 Compatibility

Released `0.1.43` stored older route keys such as:

- `dm:*`
- `groups:*`
- Slack `channel:<id>`
- Slack `group:<id>`

The loader now backs up the original config and normalizes them into the canonical stored shape:

- `directMessages["*"]`
- `groups["*"]`
- Slack raw ids such as `groups["C123"]` and `groups["G123"]`

That keeps upgrade behavior smooth for existing installs. The backup is written beside the config under `backups/`, for example `~/.clisbot/backups/clisbot.json.0.1.43.<timestamp>`, before the current config is rewritten as `0.1.45`.

The upgrade logs each stage:

- backup original config path
- prepare version upgrade
- dry-run validate the new config shape
- apply the new config
- report successful apply with backup path

If the config already has the current schema version, this upgrade path is skipped and those upgrade logs are not emitted.

Downgrade/restore UX is intentionally tracked separately so the common first-run upgrade can stay automatic.

Use this decision log for the detailed migration contract:

- [Surface Policy Shape Standardization And 0.1.43 Compatibility](../../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)

## Official Template

The official template is:

- [config/clisbot.json.template](../../../config/clisbot.json.template)

The released `0.1.43` snapshot is preserved here for migration review:

- [config/clisbot.v0.1.43.json.template](../../../config/clisbot.v0.1.43.json.template)

## Scope

- config loading and migration
- env substitution
- bot identities and bot defaults
- route storage
- DM and shared-surface audience policy
- agent defaults and per-agent overrides
- session storage and session key policy
- runner defaults and session-id capture/resume policy
- runtime monitor, cleanup, and loop defaults
- app timezone default, agent/bot/route timezone overrides, and legacy default-level timezone migration into `app.timezone`
- persisted auth policy shape

## Non-Goals

- channel rendering implementation
- runner mechanics themselves
- auth semantics beyond the persisted config contract

## Related Docs

- [Bots And Credentials](../../user-guide/bots-and-credentials.md)
- [Channels](../../user-guide/channels.md)
- [CLI Commands](../../user-guide/cli-commands.md)
- [Authorization](../auth/README.md)
- [Start Bootstrap And Credential Persistence](start-bootstrap-and-credential-persistence.md)

## Related Tasks

- [Target Config And CLI Mental Model Migration](../../tasks/features/configuration/2026-04-18-target-config-and-cli-mental-model-migration.md)
- [Surface Policy Shape Standardization And 0.1.43 Compatibility](../../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)
- [Timezone Config CLI And Loop Resolution](../../tasks/features/configuration/2026-04-26-timezone-config-cli-and-loop-resolution.md)
