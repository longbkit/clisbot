# OpenClaw CLI Command Surfaces And Slack Telegram Send Syntax

## Summary

This note is a source-backed reference for OpenClaw operator CLI commands related to outbound messaging and channel routing.

## Historical Note

This note is research input from OpenClaw.

It is useful for understanding why some early `clisbot` slices explored `channels`, `accounts`, and `defaultAccount`.

It is not the current `clisbot` product contract.

For current `clisbot`, use:

- `app`
- `bots`
- `agents`
- `bots` and `routes` as the operator setup flow

Main conclusions:

- `openclaw message send` is the main outbound CLI surface
- `openclaw channels ...` provides provider setup, status, and target resolution
- `openclaw agents ...` provides agent-to-channel binding and routing
- Slack sending uses one generic send surface but delivers media as Slack file uploads
- Telegram uses the same generic send surface but branches transport by media kind
- shell CLI commands and in-chat slash commands are separate systems and should not be merged conceptually

## Scope

This note focuses on:

- all message-related shell CLI commands that matter for Slack and Telegram delivery
- compact command meaning and operator intent for each relevant command
- channel-specific behavior for Slack and Telegram
- image, audio, generic file, and threaded or topic sends
- chat slash commands only where needed to distinguish them from shell CLI commands

This note does not attempt to catalog every OpenClaw command unrelated to channel routing or outbound sends.

## Message Command Reference First

This section is the compact operator view. Deeper source notes come later.

### Primary command families

- `openclaw message`
  - meaning: create or manage outbound message actions
  - most important subcommand: `send`
- `openclaw channels`
  - meaning: add channel accounts, inspect runtime status, and resolve provider ids
- `openclaw agents`
  - meaning: bind logical agents to channel accounts or default channel routes
- `openclaw agent`
  - meaning: run one agent turn and optionally send the result back
  - relevance here: secondary to `message send`

### Compact command list

- `openclaw message send`
  - meaning: send text, media, replies, or thread-targeted messages to a provider target
  - why it matters: this is the main send command for Slack and Telegram
- `openclaw message poll`
  - meaning: create a provider-native poll when supported
  - why it matters: Telegram-specific poll behavior is exposed here, separate from generic sends
- `openclaw channels add`
  - meaning: register a Slack or Telegram account for CLI and runtime use
- `openclaw channels status --probe`
  - meaning: verify channel connectivity and runtime health
- `openclaw channels resolve`
  - meaning: turn human-facing channel references into provider ids usable by `message send`
- `openclaw channels capabilities`
  - meaning: inspect what a provider account claims to support
- `openclaw agents add`
  - meaning: create a named agent identity
- `openclaw agents bind`
  - meaning: bind an agent to `channel[:accountId]`
- `openclaw agents bindings`
  - meaning: inspect current binding state
- `openclaw agents unbind`
  - meaning: remove a binding from an agent

### Multiple accounts and profiles

OpenClaw message commands support multiple configured channel accounts, but the CLI surface uses `account`, not a separate `profile` flag.

- shared rule:
  - all `openclaw message *` commands inherit `--account <id>`
  - the selected account is the channel account used for the action
  - one command invocation selects one account
  - the CLI does not expose multiple `--account` values for one message action
- how accounts are created:
  - use `openclaw channels add --channel <name> --account <id> ...`
- how accounts are inspected:
  - use `openclaw channels list`
- practical meaning:
  - yes, multi-account sending and acting is supported
  - no, there is no separate `--profile` flag on `openclaw message`

Examples:

- Slack send through a named account:
  - `openclaw message send --channel slack --account work --target channel:C08ABC12345 --message "sent from work account"`
- Telegram send through a named account:
  - `openclaw message send --channel telegram --account alerts --target -1001234567890 --message "sent from alerts account"`
- Telegram delete through a named account:
  - `openclaw message delete --channel telegram --account alerts --target -1001234567890 --message-id 4421`

### How OpenClaw accounts are configured

OpenClaw treats accounts as channel-owned provider instances.

OpenClaw-style shape:

```json
{
  "channels": {
    "telegram": {
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "token": "${TELEGRAM_BOT_TOKEN}"
        },
        "alerts": {
          "token": "${TELEGRAM_ALERTS_BOT_TOKEN}"
        }
      }
    },
    "slack": {
      "defaultAccount": "work",
      "accounts": {
        "work": {
          "botToken": "${SLACK_WORK_BOT_TOKEN}",
          "appToken": "${SLACK_WORK_APP_TOKEN}"
        },
        "ops": {
          "botToken": "${SLACK_OPS_BOT_TOKEN}",
          "appToken": "${SLACK_OPS_APP_TOKEN}"
        }
      }
    }
  }
}
```

What that means:

- `channels.<provider>.accounts.<accountId>` defines one configured provider account
- `channels.<provider>.defaultAccount` controls what happens when CLI or routing omits `--account`
- `openclaw message send --channel slack ...` uses the Slack default account when `--account` is omitted
- `openclaw message send --channel slack --account ops ...` uses the explicit `ops` account instead
- if older single-account top-level provider fields exist and a non-default account is added later, OpenClaw promotes the original values into `accounts.default`

Examples:

- default Slack account:
  - `openclaw message send --channel slack --target channel:C08ABC12345 --message "uses defaultAccount"`
- explicit Slack account:
  - `openclaw message send --channel slack --account ops --target channel:C08ABC12345 --message "uses ops account"`
- default Telegram account:
  - `openclaw message send --channel telegram --target -1001234567890 --message "uses defaultAccount"`
- explicit Telegram account:
  - `openclaw message send --channel telegram --account alerts --target -1001234567890 --message "uses alerts account"`

### Current `~/.clisbot/clisbot.json` gap

Current `clisbot` config is still mostly single-account at the provider root.

Current `clisbot` shape:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "appToken": "${SLACK_APP_TOKEN}",
      "botToken": "${SLACK_BOT_TOKEN}",
      "channels": {},
      "groups": {},
      "directMessages": {}
    },
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "groups": {},
      "directMessages": {}
    }
  }
}
```

Current gap versus OpenClaw:

- no `channels.slack.accounts`
- no `channels.telegram.accounts`
- no `channels.slack.defaultAccount`
- no `channels.telegram.defaultAccount`
- token fields live at provider root, not at `accounts.<accountId>`
- runtime and CLI already carry `accountId` in several places, but config does not yet truthfully model multiple Slack or Telegram accounts
- docs already note that account-specific bindings are accepted, while current Slack and Telegram runtime routing still mostly uses channel-level context

Practical consequence for `clisbot`:

- `clisbot` can talk about `accountId` in bindings and session keys
- but `~/.clisbot/clisbot.json` does not yet expose the OpenClaw-style account map needed for first-class multi-account Slack or Telegram setup
- this is the configuration-model gap the repo still needs to close

Recommended target shape for `clisbot` parity:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
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
      },
      "channels": {},
      "groups": {},
      "directMessages": {}
    },
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "botToken": "${TELEGRAM_BOT_TOKEN}"
        },
        "alerts": {
          "botToken": "${TELEGRAM_ALERTS_BOT_TOKEN}"
        }
      },
      "groups": {},
      "directMessages": {}
    }
  }
}
```

Recommended `clisbot` target shape:

- model Slack and Telegram accounts explicitly under `channels.<provider>.accounts`
- require `defaultAccount` whenever more than one account exists for a provider
- keep route tables under the provider because routes remain provider-owned
- keep bindings in `channel[:accountId]` form
- treat provider-root token fields as the current gap to remove from the product config model, not as the long-term target

### All `openclaw message *` commands

All commands below include one working-form example. Support notes are based on the inspected CLI docs and source.

#### Core message actions

- `openclaw message send`
  - meaning: send text, media, replies, and thread or topic-targeted messages
  - Slack: primary send command
  - Telegram: primary send command
  - example: `openclaw message send --channel slack --target channel:C08ABC12345 --message "deploy finished"`
- `openclaw message broadcast`
  - meaning: send one outbound message to multiple targets
  - example: `openclaw message broadcast --channel all --targets slack:channel:C08ABC12345 --targets telegram:-1001234567890 --message "system maintenance in 10 minutes"`
- `openclaw message poll`
  - meaning: create a native poll where supported
  - Slack: not listed as supported
  - Telegram: supported
  - example: `openclaw message poll --channel telegram --target -1001234567890 --poll-question "Lunch?" --poll-option Pizza --poll-option Sushi --poll-duration-seconds 120`
- `openclaw message react`
  - meaning: add or remove a reaction on a specific message
  - Slack: supported
  - Telegram: supported
  - example: `openclaw message react --channel slack --target channel:C08ABC12345 --message-id 1712345678.123456 --emoji "✅"`
- `openclaw message reactions`
  - meaning: list reactions on a specific message
  - Slack: supported
  - Telegram: not listed as supported
  - example: `openclaw message reactions --channel slack --target channel:C08ABC12345 --message-id 1712345678.123456 --limit 20`
- `openclaw message read`
  - meaning: read recent messages from a conversation
  - Slack: supported
  - Telegram: not listed as supported
  - example: `openclaw message read --channel slack --target channel:C08ABC12345 --limit 20`
- `openclaw message edit`
  - meaning: edit an existing message
  - Slack: supported
  - Telegram: supported in source registration via generic action path even though the high-level CLI doc summary omits Telegram here
  - example: `openclaw message edit --channel slack --target channel:C08ABC12345 --message-id 1712345678.123456 --message "deploy finished successfully"`
- `openclaw message delete`
  - meaning: delete a specific message
  - Slack: supported
  - Telegram: supported
  - example: `openclaw message delete --channel telegram --target -1001234567890 --message-id 4421`

#### Pins and permissions

- `openclaw message pin`
  - meaning: pin a specific message
  - example: `openclaw message pin --channel slack --target channel:C08ABC12345 --message-id 1712345678.123456`
- `openclaw message unpin`
  - meaning: unpin a specific message
  - example: `openclaw message unpin --channel slack --target channel:C08ABC12345 --message-id 1712345678.123456`
- `openclaw message pins`
  - meaning: list pinned messages
  - example: `openclaw message pins --channel slack --target channel:C08ABC12345 --limit 20`
- `openclaw message permissions`
  - meaning: inspect channel permissions where supported
  - Discord or Matrix oriented, not Slack or Telegram in the inspected docs
  - example: `openclaw message permissions --channel discord --target channel:123456789012345678`
- `openclaw message search`
  - meaning: search Discord messages
  - example: `openclaw message search --channel discord --guild-id 123456789012345678 --query "deploy failed" --channel-id 234567890123456789 --limit 20`

#### Thread commands

- `openclaw message thread create`
  - meaning: create a Discord thread from a channel target
  - example: `openclaw message thread create --channel discord --target channel:123456789012345678 --thread-name "incident-bridge" --message "starting thread for follow-up"`
- `openclaw message thread list`
  - meaning: list Discord threads in a guild
  - example: `openclaw message thread list --channel discord --guild-id 123456789012345678 --channel-id 234567890123456789 --include-archived --limit 20`
- `openclaw message thread reply`
  - meaning: reply inside an existing Discord thread by using the thread id as `--target`
  - Discord only in the inspected CLI surface
  - example: `openclaw message thread reply --channel discord --target 1357924680135792468 --message "I checked the logs and the fix is deployed."`
  - Slack equivalent: `openclaw message send --channel slack --target channel:C08ABC12345 --thread-id 1712345678.123456 --message "reply in thread"`
  - Telegram equivalent: `openclaw message send --channel telegram --target -1001234567890 --thread-id 42 --message "reply in topic"`

#### Emoji and sticker commands

- `openclaw message emoji list`
  - meaning: list available emojis
  - Slack: supported without extra flags
  - example: `openclaw message emoji list --channel slack`
- `openclaw message emoji upload`
  - meaning: upload a custom emoji
  - Discord oriented in the inspected CLI surface
  - example: `openclaw message emoji upload --channel discord --guild-id 123456789012345678 --emoji-name deploy_ok --media ./assets/deploy-ok.png`
- `openclaw message sticker send`
  - meaning: send one or more stickers
  - Discord oriented in the inspected CLI surface
  - example: `openclaw message sticker send --channel discord --target channel:123456789012345678 --sticker-id 998877665544332211 --message "approved"`
- `openclaw message sticker upload`
  - meaning: upload a sticker
  - Discord oriented in the inspected CLI surface
  - example: `openclaw message sticker upload --channel discord --guild-id 123456789012345678 --sticker-name deploy-badge --sticker-desc "deploy badge" --sticker-tags deploy --media ./assets/deploy-badge.png`

#### Discord admin and metadata commands

- `openclaw message role info`
  - meaning: list roles in a Discord guild
  - example: `openclaw message role info --channel discord --guild-id 123456789012345678`
- `openclaw message role add`
  - meaning: add a role to a Discord member
  - example: `openclaw message role add --channel discord --guild-id 123456789012345678 --user-id 234567890123456789 --role-id 345678901234567890`
- `openclaw message role remove`
  - meaning: remove a role from a Discord member
  - example: `openclaw message role remove --channel discord --guild-id 123456789012345678 --user-id 234567890123456789 --role-id 345678901234567890`
- `openclaw message channel info`
  - meaning: fetch Discord channel info
  - example: `openclaw message channel info --channel discord --target channel:123456789012345678`
- `openclaw message channel list`
  - meaning: list channels in a Discord guild
  - example: `openclaw message channel list --channel discord --guild-id 123456789012345678`
- `openclaw message member info`
  - meaning: fetch member info
  - Slack: supported
  - Discord: supported with `--guild-id`
  - example: `openclaw message member info --channel slack --user-id U08XYZ67890`
- `openclaw message voice status`
  - meaning: fetch Discord voice status for a member
  - example: `openclaw message voice status --channel discord --guild-id 123456789012345678 --user-id 234567890123456789`
- `openclaw message event list`
  - meaning: list Discord scheduled events
  - example: `openclaw message event list --channel discord --guild-id 123456789012345678`
- `openclaw message event create`
  - meaning: create a Discord scheduled event
  - example: `openclaw message event create --channel discord --guild-id 123456789012345678 --event-name "Ops Sync" --start-time 2026-04-10T09:00:00Z --end-time 2026-04-10T10:00:00Z --event-type voice --channel-id 234567890123456789`
- `openclaw message timeout`
  - meaning: timeout a Discord member
  - example: `openclaw message timeout --channel discord --guild-id 123456789012345678 --user-id 234567890123456789 --duration-min 30 --reason "cooldown after spam"`
- `openclaw message kick`
  - meaning: kick a Discord member
  - example: `openclaw message kick --channel discord --guild-id 123456789012345678 --user-id 234567890123456789 --reason "repeated abuse"`
- `openclaw message ban`
  - meaning: ban a Discord member
  - example: `openclaw message ban --channel discord --guild-id 123456789012345678 --user-id 234567890123456789 --delete-days 1 --reason "malicious links"`

### Message commands that matter most for Slack and Telegram

- Slack:
  - `message send`
  - `message react`
  - `message reactions`
  - `message read`
  - `message edit`
  - `message delete`
  - `message pin`
  - `message unpin`
  - `message pins`
  - `message emoji list`
- Telegram:
  - `message send`
  - `message poll`
  - `message react`
  - `message delete`

### `openclaw message send` syntax

```bash
openclaw message send \
  --channel <channel> \
  --account <id> \
  --target <dest> \
  --message <text> \
  [--media <path-or-url>] \
  [--interactive <json>] \
  [--buttons <json>] \
  [--components <json>] \
  [--card <json>] \
  [--reply-to <id>] \
  [--thread-id <id>] \
  [--gif-playback] \
  [--force-document] \
  [--silent] \
  [--json] \
  [--dry-run] \
  [--verbose]
```

### `openclaw message send` option meaning

- `--channel`
  - meaning: provider route such as `slack` or `telegram`
- `--account`
  - meaning: specific configured account id inside that provider
- `--target`
  - meaning: destination identifier inside the provider
  - Slack examples:
    - `--target C08ABC12345`
    - `--target channel:C08ABC12345`
    - `--target user:U08XYZ67890`
  - Telegram examples:
    - `--target 123456789`
    - `--target -1001234567890`
    - `--target @example_channel`
  - practical meaning:
    - Slack channel send: destination channel id
    - Slack DM send: destination user id or resolved DM surface
    - Telegram private chat: user chat id
    - Telegram group or supergroup: negative chat id
    - Telegram channel: channel username or channel chat id
  - required: yes
- `--message`
  - meaning: body text for the send
  - required: yes unless `--media` is present
- `--media`
  - meaning: local file path or remote URL for media or file delivery
- `--reply-to`
  - meaning: reply against a prior provider message id
- `--thread-id`
  - meaning: provider thread surface
  - Slack meaning: `thread_ts`
  - Telegram meaning: forum topic id or DM thread id
- `--gif-playback`
  - meaning: hint that animated media should stay animated when the provider supports it
- `--force-document`
  - meaning: on Telegram, send image or animation as a document instead of rich media
- `--silent`
  - meaning: suppress notification where the provider supports it
- `--interactive`, `--buttons`, `--components`, `--card`
  - meaning: attach structured UI payloads where adapters support them
- `--dry-run`
  - meaning: validate and print intent without executing delivery
- `--json`
  - meaning: machine-readable output
- `--verbose`
  - meaning: extra command diagnostics

### Slack command meaning

- provider route: `--channel slack`
- typical targets:
  - `channel:<id>`
  - `user:<id>`
  - raw channel id
- text send meaning:
  - sends with `chat.postMessage`
  - user targets are converted into DM channel ids first
- media send meaning:
  - image, audio, and generic file all use Slack file upload flow
  - OpenClaw does not expose separate Slack-specific image or audio send commands
- thread meaning:
  - `--thread-id` becomes Slack `thread_ts`
- practical interpretation:
  - Slack has one CLI send command, one target model, and one media-upload strategy

### Telegram command meaning

- provider route: `--channel telegram`
- typical targets:
  - chat id
  - group id
  - supergroup id
  - channel id
- text send meaning:
  - sends as HTML-formatted text by default, with plain-text fallback on parse failure
- media send meaning:
  - transport is selected by media kind
  - image: `sendPhoto`
  - animation: `sendAnimation`
  - video: `sendVideo`
  - voice-compatible audio with runtime hint: `sendVoice`
  - normal audio file: `sendAudio`
  - generic file: `sendDocument`
- thread meaning:
  - `--thread-id` becomes `message_thread_id`
  - forum topics and DM threads keep this value
  - General topic id `1` is omitted on normal sends
- provider-specific flags:
  - `--force-document`
  - `--silent`
- practical interpretation:
  - Telegram uses one CLI send command but several transport methods underneath

### Compact scenario map

- text only
  - Slack: `chat.postMessage`
  - Telegram: `sendMessage`
- image with caption
  - Slack: upload file with `initial_comment`
  - Telegram: `sendPhoto`, or `sendDocument` with `--force-document`
- audio file
  - Slack: upload file
  - Telegram: `sendAudio`, or runtime-level voice path when `asVoice` is available internally
- generic file
  - Slack: upload file
  - Telegram: `sendDocument`
- thread or topic reply
  - Slack: use `--thread-id` as `thread_ts`
  - Telegram: use `--thread-id` as `message_thread_id`

### Command meaning by operator task

- send one message now
  - use `openclaw message send`
- send a poll
  - use `openclaw message poll`
- add a Slack or Telegram account
  - use `openclaw channels add`
- check whether the provider is alive
  - use `openclaw channels status --probe`
- find the provider id to target
  - use `openclaw channels resolve`
- attach an agent to a channel route
  - use `openclaw agents bind`
- inspect current routing
  - use `openclaw agents bindings`

## Source Baseline

Local OpenClaw source inspected:

- source: local OpenClaw checkout provided by the user
- branch: `main`
- commit: `77e0e3bac5`
- checked on: `2026-04-09`

Important constraint:

- this note is based on the local source tree above, not only on public docs
- OpenClaw changes quickly, so strict parity work should re-check the exact source revision in use

## Detailed Source Notes

The compact command-first section above is the main operator reference.

Deeper source-backed analysis, implementation notes, and channel-specific transport details were moved to a companion note to keep this file inside repo size limits:

- [OpenClaw CLI Message Command Analysis Details](./2026-04-09-openclaw-cli-message-command-analysis-details.md)
