# Channel Accounts

## Purpose

Use this page when you need the default Slack or Telegram account tokens that let `muxbot start` bootstrap and run.

Current startup rule:

- `muxbot start` requires either:
  - `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN`
  - or `TELEGRAM_BOT_TOKEN`
- on first run, you can also pass custom token env names with:
  - `--slack-app-token CUSTOM_SLACK_APP_TOKEN`
  - `--slack-bot-token CUSTOM_SLACK_BOT_TOKEN`
  - `--telegram-bot-token CUSTOM_TELEGRAM_BOT_TOKEN`
- the CLI also accepts placeholder form such as `'${CUSTOM_SLACK_APP_TOKEN}'`
- `muxbot start` prints the token env names it checks and whether each one is `set` or `missing`
- when no default channel token is available, `muxbot` does not create runtime state or start the background service

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

Then point `muxbot` at them on first run:

```bash
muxbot start \
  --cli codex \
  --bootstrap personal-assistant \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

## What Start Does

When `~/.muxbot/muxbot.json` does not exist yet:

- if Slack tokens are present, the generated config enables Slack
- if Telegram token is present, the generated config enables Telegram
- if both are present, both channels are enabled
- if neither is present, `muxbot` prints a warning and returns
- custom token-reference flags are written into config exactly as provided
- no Slack channels, Slack groups, Telegram groups, or Telegram topics are auto-added

When `~/.muxbot/muxbot.json` already exists:

- `start` does not change channel enablement in the existing config
- `start` validates the env vars referenced by the enabled channel token fields before it launches the background runtime
- if an enabled channel points at a missing env var, `start` prints the exact missing env name and exits cleanly
- if default tokens are present but `channels.slack.enabled` or `channels.telegram.enabled` is still `false`, `start` prints a warning and continues using the existing config as written

When no agents exist yet:

- `start` requires both `--cli` and `--bootstrap` to create the first `default` agent
- choose `personal-assistant` for one assistant serving one human
- choose `team-assistant` for one assistant serving a shared team surface
