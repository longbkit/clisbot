# Channel Accounts

## Purpose

Use this page when you need to configure Slack or Telegram accounts for:

- runtime startup
- `clisbot message ...` operator actions
- binding-level account selection with `channel[:accountId]`

Current startup rule:

- fresh `clisbot start` only bootstraps channels that the operator names with flags
- ambient env vars alone do not auto-enable Slack or Telegram on first run
- `--slack-app-token`, `--slack-bot-token`, and `--telegram-bot-token` accept:
  - env var names such as `TELEGRAM_BOT_TOKEN`
  - placeholders such as `'${TELEGRAM_BOT_TOKEN}'`
  - literal or shell-expanded token values such as `"$TELEGRAM_BOT_TOKEN"`
- literal input becomes `credentialType: "mem"` and never gets written into `clisbot.json`
- `clisbot start --persist` promotes those mem credentials into canonical credential files immediately
- `clisbot accounts add` and `clisbot accounts persist` manage the same provider-account model after bootstrap

## Config Shape

Slack and Telegram now support provider-owned account maps.

Current target shape:

```json
{
  "channels": {
    "slack": {
      "appToken": "${SLACK_APP_TOKEN}",
      "botToken": "${SLACK_BOT_TOKEN}",
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "appToken": "${SLACK_APP_TOKEN}",
          "botToken": "${SLACK_BOT_TOKEN}"
        },
        "ops": {
          "appToken": "${SLACK_OPS_APP_TOKEN}",
          "botToken": "${SLACK_OPS_BOT_TOKEN}"
        }
      }
    },
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "botToken": "${TELEGRAM_BOT_TOKEN}"
        },
        "alerts": {
          "botToken": "${TELEGRAM_ALERTS_BOT_TOKEN}"
        }
      }
    }
  }
}
```

Rules:

- `channels.<provider>.accounts.<accountId>` defines one provider account
- `channels.<provider>.defaultAccount` is used when routing or CLI input omits `--account`
- route tables such as `channels.slack.channels`, `channels.slack.groups`, and `channels.telegram.groups` remain provider-owned
- bindings can target the provider default with `slack` or `telegram`
- bindings can target a specific account with `slack:ops` or `telegram:alerts`
- `clisbot message ...` can target a specific account with `--account <accountId>`
- root token fields still exist and are used for startup defaults and compatibility with existing setup helpers

## Binding Examples

Examples:

```json
{
  "bindings": [
    { "match": "slack", "agentId": "default" },
    { "match": "slack:ops", "agentId": "ops-agent" },
    { "match": "telegram:alerts", "agentId": "alerts-agent" }
  ]
}
```

Interpretation:

- `slack` means the Slack provider using `channels.slack.defaultAccount`
- `slack:ops` means the Slack provider using `channels.slack.accounts.ops`
- `telegram:alerts` means the Telegram provider using `channels.telegram.accounts.alerts`

## Slack Tokens

You need both:

- `SLACK_APP_TOKEN`
- `SLACK_BOT_TOKEN`

Current practical flow:

1. create or open a Slack app
2. enable Socket Mode
3. install the app to the workspace
4. copy the app-level token into `SLACK_APP_TOKEN`
5. copy the bot token into `SLACK_BOT_TOKEN`

Official docs:

- Slack app management: <https://api.slack.com/apps>
- Slack Socket Mode: <https://api.slack.com/apis/connections/socket>

## Telegram Token

You need:

- `TELEGRAM_BOT_TOKEN`

Current practical flow:

1. open BotFather in Telegram
2. create a bot or inspect an existing bot
3. copy the issued token into `TELEGRAM_BOT_TOKEN`

Official docs:

- Telegram bots overview: <https://core.telegram.org/bots>
- BotFather setup: <https://core.telegram.org/bots#6-botfather>

## Credential Direction

Current direction:

- raw Slack or Telegram token literals are not supported in `~/.clisbot/clisbot.json`
- canonical credential files are preferred at:
  - `~/.clisbot/credentials/telegram/<accountId>/bot-token`
  - `~/.clisbot/credentials/slack/<accountId>/app-token`
  - `~/.clisbot/credentials/slack/<accountId>/bot-token`
- explicit `tokenFile` overrides remain supported for non-standard paths
- env-backed setup still works through `${ENV_NAME}` placeholders
- config makes mem and token-file state explicit through `credentialType`
- `start` supports shorthand `default` input and repeated account blocks
- `accounts add`, `accounts persist`, and `start --persist` are the supported persistence-management surfaces

Why:

- `clisbot.json` is easier to share, diff, or accidentally commit than a separate secret file
- a dedicated credential file gives nearly the same convenience as raw config secrets with less operator footgun risk

The credentials directory should also carry a default ignore file:

Path:

```text
~/.clisbot/credentials/.gitignore
```

Suggested content:

```gitignore
*
!*/
!.gitignore
```

## CLI Input Semantics

These inputs mean different things:

- `--telegram-bot-token \"$TELEGRAM_BOT_TOKEN\"`
  - shell expands first
  - actual meaning: pass the token value itself, so `clisbot` treats it as in-memory `mem`
- `--telegram-bot-token TELEGRAM_BOT_TOKEN`
  - actual meaning: treat as env var name
- `--telegram-bot-token '${TELEGRAM_BOT_TOKEN}'`
  - actual meaning: treat as env placeholder

Guardrail:

- raw token input on `clisbot accounts add` without `--persist` currently requires the runtime to already be running
- this keeps mem credentials tied to the active runtime instead of silently leaving long-lived secrets outside config without a running process to consume them
- raw token input on `clisbot start` is cold-start friendly: when the runtime is stopped, the secret is injected into the spawned runtime process instead of being written into `clisbot.json`
- if the runtime is already running, `clisbot start` with raw token input now requires `--persist`; otherwise stop first, then run `start` again with the literal token
- those mem accounts are ephemeral: `clisbot stop` and the next cold `clisbot start` will disable expired `credentialType: "mem"` accounts automatically

## Shell Setup

Examples:

```bash
# ~/.bashrc
export SLACK_APP_TOKEN=...
export SLACK_BOT_TOKEN=...
export TELEGRAM_BOT_TOKEN=...
```

```bash
# ~/.zshrc
export SLACK_APP_TOKEN=...
export SLACK_BOT_TOKEN=...
export TELEGRAM_BOT_TOKEN=...
```

```bash
source ~/.bashrc
```

```bash
source ~/.zshrc
```

Custom env names also work:

```bash
export CUSTOM_SLACK_APP_TOKEN=...
export CUSTOM_SLACK_BOT_TOKEN=...
export CUSTOM_TELEGRAM_BOT_TOKEN=...
```

Then point `clisbot` at them on first run:

```bash
clisbot start \
  --cli codex \
  --bootstrap personal-assistant \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

## What Start Does

When `~/.clisbot/clisbot.json` does not exist yet:

- only the explicitly requested channels are enabled
- repeated account blocks create or update the requested provider accounts
- env-backed input is stored as `${ENV_NAME}`
- literal input is stored as `credentialType: "mem"`
- `--persist` writes canonical credential files and flips the affected accounts to `credentialType: "tokenFile"`
- no Slack channels, Slack groups, Telegram groups, or Telegram topics are auto-added

When `~/.clisbot/clisbot.json` already exists:

- `start` preserves existing channels and accounts unless the operator explicitly adds or updates them
- passing token flags can enable a second channel later or add a named account to an existing provider
- if the runtime is already running, config reload reconciles the updated provider state immediately
- status output reports whether the active source is `env`, `credential-file`, or `cli-ephemeral`

When no agents exist yet:

- `start` requires both `--cli` and `--bootstrap` to create the first `default` agent
- choose `personal-assistant` for one assistant serving one human
- choose `team-assistant` for one assistant serving a shared team surface
