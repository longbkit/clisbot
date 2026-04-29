# Routes

## Mental Model

Use `clisbot routes ...` to manage inbound surfaces under one bot.

Think about routes in two layers:

1. admit a surface
2. decide who may talk inside that surface

Inside stored bot config, those surfaces are split as:

- `directMessages`
- `groups`

## Preferred CLI Route Ids

Slack:

- shared surface: `group:<id>`
- shared wildcard: `group:*`
- DM: `dm:<userId>`
- DM wildcard: `dm:*`

Telegram:

- shared chat: `group:<chatId>`
- topic: `topic:<chatId>:<topicId>`
- shared wildcard: `group:*`
- DM: `dm:<userId>`
- DM wildcard: `dm:*`

Compatibility:

- `channel:<id>` is still accepted for older Slack operator flows
- stored config no longer uses those prefixes inside bot route maps

## Stored Config Shape

```json
{
  "bots": {
    "slack": {
      "default": {
        "channelPolicy": "allowlist",
        "groupPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "policy": "pairing"
          },
          "U1234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["U1234567890"]
          }
        },
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open"
          },
          "C1234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["U_OWNER"]
          }
        }
      }
    },
    "telegram": {
      "default": {
        "groupPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "policy": "pairing"
          }
        },
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open",
            "topics": {}
          },
          "-1001234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["1276408333"],
            "topics": {
              "42": {
                "enabled": true,
                "policy": "open"
              }
            }
          }
        }
      }
    }
  }
}
```

## Policy Rules

### Shared surfaces

- `disabled` means silent for everyone
- normal users need the shared surface itself to exist when `groupPolicy` or Slack `channelPolicy` is `allowlist`
- after admission, effective sender policy comes from:
  - `groups["*"]`
  - plus the exact shared route
- `allowUsers` and `blockUsers` are enforced before the runner sees the message
- default admission is `allowlist`; default in-group sender policy is `open`

### Shared owner/admin behavior

- app `owner` and app `admin` may use enabled shared surfaces even when allowlist would reject normal users
- `blockUsers` still wins
- `disabled` still wins

### Shared deny behavior

When a shared allowlist rejects a sender, the bot replies:

`You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`

### DM surfaces

- `directMessages["*"]` is the normal DM default
- pairing approval writes to that requesting bot's wildcard DM route
- exact DM routes may now carry both behavior overrides and per-user admission overrides when needed

## Invariants

- preferred operator ids are `group:<id>`, `group:*`, `dm:<id|*>`, and `topic:<chatId>:<topicId>`
- Slack `channel:<id>` remains accepted only so existing operator muscle memory and old scripts do not break immediately
- stored config under one bot never uses those prefixes anymore
- `group:*` is the default multi-user sender policy node, not an optional convenience alias
- the deny reply says `group` even for Slack channels and Telegram topics by design

## Common Commands

```bash
clisbot routes list
clisbot routes add --channel slack group:C1234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot alerts --require-mention false --allow-bots true --policy allowlist
clisbot routes add --channel telegram topic:-1001234567890:42 --bot default
clisbot routes set-agent --channel slack group:C1234567890 --bot default --agent support
clisbot routes set-policy --channel slack group:* --bot default --policy allowlist
clisbot routes add-allow-user --channel slack group:* --bot default --user U_OWNER
clisbot routes add-allow-user --channel telegram group:* --bot alerts --user 1276408333
clisbot routes add-block-user --channel telegram group:-1001234567890 --bot default --user 1276408333
clisbot routes set-policy --channel telegram dm:* --bot default --policy pairing
clisbot routes add-allow-user --channel slack dm:U1234567890 --bot default --user U1234567890
```

## Practical Guidance

- use `group:*` when you want one default sender rule for all shared surfaces under a bot
- use `routes add-allow-user ... group:* ...` when one user should be allowed in every admitted group under that bot
- use `routes add ... --policy allowlist --require-mention false --allow-bots true` when a new group route should be created with those settings in one command
- use one exact shared route when you want to admit only one Slack channel, Slack group, Telegram group, or Telegram topic
- use `bots set-group-policy --policy allowlist` when groups must be explicitly added before use
- use `routes set-policy group:<id> --policy allowlist` when only some users may speak inside that group
- keep `disabled` for admission policy or exact routes where the bot should never answer at all

## Related Docs

- [Bots And Credentials](bots-and-credentials.md)
- [CLI Commands](cli-commands.md)
- [Authorization And Roles](auth-and-roles.md)
- [Surface Policy Shape Standardization And 0.1.43 Compatibility](../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)
