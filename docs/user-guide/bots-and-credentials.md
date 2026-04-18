# Bots And Credentials

## Purpose

Use this page when you need to manage Slack or Telegram bot identities, credentials, and provider-level bot defaults.

Official operator surface:

- `clisbot bots ...`

Mental model:

- one bot = one provider identity plus its credentials
- routes are attached under a bot
- a bot may define a fallback `agentId`
- a route may keep that fallback or override it

## Config Shape

The official config shape is:

```json
{
  "bots": {
    "slack": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "default"
      },
      "default": {
        "appToken": "${SLACK_APP_TOKEN}",
        "botToken": "${SLACK_BOT_TOKEN}",
        "agentId": "default"
      },
      "ops": {
        "appToken": "${SLACK_OPS_APP_TOKEN}",
        "botToken": "${SLACK_OPS_BOT_TOKEN}",
        "agentId": "ops"
      }
    },
    "telegram": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "default"
      },
      "default": {
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "agentId": "default"
      },
      "alerts": {
        "botToken": "${TELEGRAM_ALERTS_BOT_TOKEN}",
        "agentId": "alerts"
      }
    }
  }
}
```

Key rules:

- `bots.<provider>.defaults.defaultBotId` is the default bot when `--bot` is omitted
- `bots.<provider>.<botId>` stores one bot
- Slack bots use both `appToken` and `botToken`
- Telegram bots use `botToken`
- route maps live under each bot, not at the provider root

## CLI Flow

Most operators only need these commands:

```bash
clisbot bots list
clisbot bots get --channel telegram --bot default
clisbot bots add --channel telegram --bot default --bot-token TELEGRAM_BOT_TOKEN --persist
clisbot bots add --channel slack --bot default --app-token SLACK_APP_TOKEN --bot-token SLACK_BOT_TOKEN --persist
clisbot bots set-agent --channel telegram --bot default --agent support
clisbot bots set-agent --channel slack --bot ops --agent ops
clisbot bots set-default --channel telegram --bot alerts
clisbot bots set-default --channel slack --bot ops
clisbot bots get-credentials-source --channel slack --bot default
clisbot bots set-dm-policy --channel telegram --bot default --policy pairing
clisbot bots set-group-policy --channel telegram --bot default --policy allowlist
clisbot bots set-channel-policy --channel slack --bot default --policy disabled
```

Behavior rules:

- `add` is create-only
- if the bot already exists, use `set-agent`, `set-credentials`, or another `set-<key>` command
- raw token input without `--persist` is runtime-only and needs a running `clisbot`
- `--persist` writes canonical credential files and keeps raw secrets out of `clisbot.json`

## Credential Sources

Preferred order:

1. canonical credential files
2. env placeholders such as `${SLACK_BOT_TOKEN}`
3. runtime-only mem credentials during bootstrap or a running session

Canonical credential files:

- `~/.clisbot/credentials/telegram/<botId>/bot-token`
- `~/.clisbot/credentials/slack/<botId>/app-token`
- `~/.clisbot/credentials/slack/<botId>/bot-token`

Supported persisted fields:

- `credentialType`
- `tokenFile`
- `appTokenFile`
- `botTokenFile`

Current guardrail:

- raw token literals are not allowed as long-lived values inside `clisbot.json`

## Token Input Semantics

These inputs mean different things:

- `--bot-token TELEGRAM_BOT_TOKEN`
  - treat as env var name
- `--bot-token '${TELEGRAM_BOT_TOKEN}'`
  - treat as env placeholder
- `--bot-token "$TELEGRAM_BOT_TOKEN"`
  - shell expands first, so `clisbot` receives the real token value
  - without `--persist`, that becomes a runtime-only mem credential

## Practical Examples

Create one Telegram bot and persist the token:

```bash
clisbot bots add \
  --channel telegram \
  --bot default \
  --bot-token TELEGRAM_BOT_TOKEN \
  --persist
```

Create one Slack bot and persist both tokens:

```bash
clisbot bots add \
  --channel slack \
  --bot default \
  --app-token SLACK_APP_TOKEN \
  --bot-token SLACK_BOT_TOKEN \
  --persist
```

Point a Slack bot at a different fallback agent:

```bash
clisbot bots set-agent --channel slack --bot default --agent support
```

Show how the current bot gets its credentials:

```bash
clisbot bots get-credentials-source --channel telegram --bot default
```

## What `start` Does

On first run:

- `clisbot start` creates the default config if needed
- explicit token flags create or update the requested bots
- only the providers you name are enabled
- routes are still manual by design

After first run:

- use `clisbot bots ...` to add more bots or rotate credentials
- use `clisbot routes ...` to expose specific channels, groups, topics, or DMs under those bots
