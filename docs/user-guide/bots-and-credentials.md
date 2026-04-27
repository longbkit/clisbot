# Bots And Credentials

## Mental Model

One bot is one provider identity.

A bot owns:

- credentials
- a fallback `agentId`
- DM defaults
- shared-surface defaults
- exact DM and shared-surface overrides

Routes live under that bot.

## Preferred Stored Shape

```json
{
  "bots": {
    "slack": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "default",
        "dmPolicy": "pairing",
        "channelPolicy": "allowlist",
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
            "policy": "open"
          }
        }
      },
      "default": {
        "appToken": "${SLACK_APP_TOKEN}",
        "botToken": "${SLACK_BOT_TOKEN}",
        "agentId": "default",
        "dmPolicy": "pairing",
        "channelPolicy": "allowlist",
        "groupPolicy": "allowlist",
        "directMessages": {},
        "groups": {}
      }
    },
    "telegram": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "default",
        "dmPolicy": "pairing",
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
          }
        }
      },
      "default": {
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "agentId": "default",
        "dmPolicy": "pairing",
        "groupPolicy": "allowlist",
        "directMessages": {},
        "groups": {}
      }
    }
  }
}
```

## Important Rules

- stored config uses raw ids plus `*` inside `directMessages` and `groups`
- CLI still uses `dm:<id>` and `group:<id>`
- `dmPolicy` is a quick alias for the wildcard DM default
- Slack `channelPolicy` and `groupPolicy` control shared-surface admission
- Telegram `groupPolicy` controls Telegram group admission
- `groups["*"].policy` controls the default sender policy inside admitted groups
- `disabled` means silent, even for owner/admin

## Invariants

- Slack `channel:<id>` is compatibility input only; preferred operator naming is still `group:<id>`
- `group:*` is the bot's default multi-user sender policy node
- `directMessages["*"]` and `groups["*"]` are the canonical wildcard storage nodes
- exact DM routes may carry admission config as well as behavior overrides
- bot-level defaults answer "what usually happens under this bot"; exact routes answer "what is special for this one surface"
- exact group/channel/topic routes should omit `policy` when they should inherit `groups["*"].policy`

## Common Commands

```bash
clisbot bots list
clisbot bots add --channel telegram --bot default --bot-token TELEGRAM_BOT_TOKEN --persist
clisbot bots add --channel slack --bot default --app-token SLACK_APP_TOKEN --bot-token SLACK_BOT_TOKEN --persist
clisbot bots set-agent --channel slack --bot default --agent support
clisbot bots set-default --channel telegram --bot alerts
clisbot bots get-credentials-source --channel slack --bot default
clisbot bots set-dm-policy --channel telegram --bot default --policy pairing
clisbot bots set-group-policy --channel slack --bot default --policy allowlist
clisbot routes set-policy --channel slack group:C1234567890 --bot default --policy allowlist
```

## Credential Sources

Preferred order:

1. canonical credential files
2. env placeholders such as `${SLACK_BOT_TOKEN}`
3. runtime-only mem credentials

Raw token literals should not live long-term in `clisbot.json`.

## What `start` Does

On first run:

- `clisbot start` creates the config if needed
- explicit token flags create or update the requested bot
- only the providers you enable are started
- shared routes are still manual by design

After first run:

- use `clisbot bots ...` for credentials and fallback agent changes
- use `clisbot routes ...` for DM, group, and topic admission

## Related Docs

- [Routes](channels.md)
- [CLI Commands](cli-commands.md)
- [Surface Policy Shape Standardization And 0.1.43 Compatibility](../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)
