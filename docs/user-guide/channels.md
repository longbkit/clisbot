# Channel Operations

## Purpose

Use this page for routed Slack and Telegram behavior that operators need during setup, debugging, and live validation.

## Conversation Commands

Useful slash commands on routed Slack and Telegram conversations:

- `/start`
- `/help`
- `/status`
- `/whoami`
- `/stop`
- `/nudge`

`clisbot` also supports session-scoped Slack and Telegram follow-up policy.

Current control commands inside a conversation are:

- `/followup status`
- `/followup auto`
- `/followup mention-only`
- `/followup pause`
- `/followup resume`

Current meanings are:

- `auto`: once the bot has already replied in a thread, later plain thread replies can continue naturally without a fresh mention
- `mention-only`: every later turn in that thread must explicitly mention the bot
- `pause`: temporarily stop passive follow-up until the next explicit mention
- `resume`: clear the runtime override and restore the configured default

Important distinction:

- `mention-only` stays active until changed again
- `pause` is temporary; the next explicit mention re-activates the conversation and clears the pause override

Operational notes:

- `/whoami` is the fastest way to confirm the resolved platform, session key, sender id, and route-level privilege-command policy for the current conversation
- `/status` shows the current route follow-up state, current run state, and operator hints for enabling privilege commands on that exact route
- `/status` is also the fastest way to see whether this routed thread is idle, actively running, or detached after a long autonomous turn
- `/start` is useful both for routed conversations and for Telegram groups or topics that are not routed yet

## Operator Commands

Use the `clisbot channels ...` CLI to update route config without editing JSON by hand.

Current commands:

- `clisbot channels enable slack`
- `clisbot channels disable slack`
- `clisbot channels enable telegram`
- `clisbot channels disable telegram`
- `clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove telegram-group <chatId> [--topic <topicId>]`
- `clisbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove slack-channel <channelId>`
- `clisbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove slack-group <groupId>`
- `clisbot channels set-token <slack-app|slack-bot|telegram-bot> <value>`
- `clisbot channels clear-token <slack-app|slack-bot|telegram-bot>`
- `clisbot channels privilege enable <target>`
- `clisbot channels privilege disable <target>`
- `clisbot channels privilege allow-user <target> <userId>`
- `clisbot channels privilege remove-user <target> <userId>`

Practical notes:

- these commands update the existing OpenClaw-style config paths directly
- Telegram groups land in `channels.telegram.groups.<chatId>`
- Telegram topics land in `channels.telegram.groups.<chatId>.topics.<topicId>`
- Slack public channels land in `channels.slack.channels.<channelId>`
- Slack private groups land in `channels.slack.groups.<groupId>`
- token commands only change the existing token fields; they do not fetch or validate secrets for you

Current default Slack config is:

- `channels.slack.followUp.mode: "auto"`
- `channels.slack.followUp.participationTtlMin: 5`
- `channels.slack.ackReaction: ""`
- `channels.slack.typingReaction: ""`
- `channels.slack.processingStatus.enabled: true`
- `channels.slack.processingStatus.status: "Working..."`
- `channels.slack.processingStatus.loadingMessages: []`

Reaction notes:

- the live in-thread reply is still the main processing indicator
- Slack reactions need bot scope `reactions:write`
- if `reactions:write` is missing, `clisbot` should keep replying normally and fall back to the live in-thread processing reply only

Assistant status notes:

- Slack assistant thread status currently accepts bot scope `chat:write` and still temporarily accepts `assistant:write`
- this is the UI line that looks like `<bot name> Working...` or rotates configured loading messages
- if Slack status writes are unavailable, `clisbot` should keep replying normally and fall back to reactions plus the live in-thread processing reply

## Transcript Visibility And Privilege Commands

Transcript inspection and bash execution no longer use the same gate.

Current rule:

- `verbose: "minimal"` allows `/transcript`
- `verbose: "off"` blocks `/transcript`
- `/bash <command>` and bash shortcuts such as `!<command>` still require `privilegeCommands.enabled: true`

`verbose` defaults to `minimal` on top-level Slack and Telegram channel config so routed users can inspect transcript state without extra privilege setup.

Important rollout note:

- if an existing config does not set `verbose` yet, the current release resolves it as `minimal`
- set `verbose: "off"` explicitly on any route where transcript inspection should stay hidden

Route examples for `verbose`:

- `channels.slack.verbose`
- `channels.slack.channels.<channelId>.verbose`
- `channels.slack.groups.<groupId>.verbose`
- `channels.slack.directMessages.verbose`
- `channels.telegram.verbose`
- `channels.telegram.groups.<chatId>.verbose`
- `channels.telegram.groups.<chatId>.topics.<topicId>.verbose`
- `channels.telegram.directMessages.verbose`

Privilege examples for bash:

Examples:

- `channels.slack.directMessages.privilegeCommands`
- `channels.slack.channels.<channelId>.privilegeCommands`
- `channels.slack.groups.<groupId>.privilegeCommands`
- `channels.telegram.directMessages.privilegeCommands`
- `channels.telegram.groups.<chatId>.privilegeCommands`
- `channels.telegram.groups.<chatId>.topics.<topicId>.privilegeCommands`

Example:

```json
{
  "channels": {
    "slack": {
      "privilegeCommands": {
        "enabled": false,
        "allowUsers": []
      },
      "directMessages": {
        "enabled": true,
        "policy": "pairing",
        "allowFrom": [],
        "requireMention": false,
        "agentId": "default",
        "verbose": "minimal",
        "privilegeCommands": {
          "enabled": true,
          "allowUsers": []
        }
      },
      "channels": {
        "C07U0LDK6ER": {
          "requireMention": true,
          "agentId": "default",
          "verbose": "off",
          "privilegeCommands": {
            "enabled": true,
            "allowUsers": ["U123"]
          }
        }
      }
    }
  }
}
```

Important rule:

- leaving top-level `verbose` at `minimal` is the low-friction default for internal use
- set `verbose: "off"` only on routes where transcript monitoring should stay hidden
- leaving `privilegeCommands.enabled` disabled at the root is recommended
- use `privilegeCommands.allowUsers` when a route should trust only specific user ids
- enable privilege commands only on the specific DM, channel, group, or topic routes that should have bash access
- shortcut prefixes are configured through `channels.<platform>.commandPrefixes`
- defaults are `slash: ["::", "\\"]` and `bash: ["!"]`
- the `privilege` CLI is the fastest way to enable or restrict `/bash` without editing JSON by hand
- DM targets are literal: use `clisbot channels privilege enable slack-dm` or `clisbot channels privilege enable telegram-dm`

## Slack Event Subscriptions

Natural no-mention continuation in Slack depends on routed `message.*` events, not only `app_mention`.

For channel threads, the critical subscription is:

- `message.channels`

If `message.channels` is missing:

- explicit `@tclisbot ...` messages can still work through `app_mention`
- plain thread follow-up after the bot has already replied will not reach `clisbot`
- the follow-up policy status can look correct while the bot still appears silent, because the inbound Slack event never arrives

For other Slack conversation kinds, the matching routed subscriptions are also needed:

- `message.groups`
- `message.im`
- `message.mpim`

## Slack Routes

Slack routing supports:

- direct messages through `channels.slack.directMessages`
- public channel routes through `channels.slack.channels.<channelId>`
- private channel or group routes through `channels.slack.groups.<groupId>`

If the bot starts successfully but does not respond in Slack, the most common reasons are:

- Slack DMs are gated by `channels.slack.directMessages.policy`
- Slack channels do not route unless you add `channels.slack.channels.<channelId>`
- Slack private groups do not route unless you add `channels.slack.groups.<groupId>`

Minimal Slack channel example:

```json
{
  "channels": {
    "slack": {
      "defaultAgentId": "default",
      "channels": {
        "C1234567890": {
          "agentId": "default",
          "requireMention": false
        }
      }
    }
  }
}
```

Minimal Slack private group example:

```json
{
  "channels": {
    "slack": {
      "groups": {
        "G1234567890": {
          "agentId": "default",
          "requireMention": false
        }
      }
    }
  }
}
```

Minimal Slack DM example:

```json
{
  "channels": {
    "slack": {
      "directMessages": {
        "enabled": true,
        "policy": "open",
        "requireMention": false,
        "agentId": "default"
      }
    }
  }
}
```

Practical rules:

- if you only configured `channels.slack.directMessages`, the bot can still appear healthy in `status` while staying silent in Slack channels
- if `directMessages.policy` is `pairing`, unknown Slack DMs are also gated until approved
- if you expect public or private channel traffic, add explicit Slack routes instead of assuming `defaultAgentId` is enough

### How To Get Slack `channelId` And `groupId`

Use one of these practical paths:

1. Open the target Slack channel or private group.
2. Copy the Slack conversation link.
3. Read the conversation id from that link.
4. Copy that id into either `channels.slack.channels.<channelId>` or `channels.slack.groups.<groupId>`.

Practical notes:

- public channels usually use ids that start with `C`
- private groups usually use ids that start with `G`
- Slack DMs also have a conversation id, but DM routing is controlled by `channels.slack.directMessages`, not by adding a DM id under `channels.slack.channels`
- `/whoami` only works after the Slack conversation is already routed to an agent
- if the bot is not responding yet, check `clisbot logs` after sending a message and confirm the required `message.channels`, `message.groups`, `message.im`, or `message.mpim` subscription exists

Example:

- Slack link contains `C1234567890`
- config path to use: `channels.slack.channels."C1234567890"`
- Slack link contains `G1234567890`
- config path to use: `channels.slack.groups."G1234567890"`

## Telegram Routes

Telegram routing supports:

- direct messages through `channels.telegram.directMessages`
- group-level routes through `channels.telegram.groups.<chatId>`
- topic overrides through `channels.telegram.groups.<chatId>.topics.<topicId>`

The main practical difference from Slack is that Telegram topic identity is first-class. One busy topic should not block unrelated Telegram topics or DMs on the same bot.

If the bot starts successfully but does not respond in a Telegram group, the most common reason is simple:

- Telegram DMs can work through `channels.telegram.directMessages`
- Telegram group messages do not route unless you add `channels.telegram.groups.<chatId>`
- Telegram forum topics do not route unless you add `channels.telegram.groups.<chatId>.topics.<topicId>`

Minimal Telegram group example:

```json
{
  "channels": {
    "telegram": {
      "defaultAgentId": "default",
      "groups": {
        "-1001234567890": {
          "agentId": "default",
          "requireMention": true
        }
      }
    }
  }
}
```

Minimal Telegram topic example:

```json
{
  "channels": {
    "telegram": {
      "groups": {
        "-1001234567890": {
          "agentId": "default",
          "topics": {
            "42": {
              "agentId": "default",
              "requireMention": true
            }
          }
        }
      }
    }
  }
}
```

Practical rule:

- if you only configured `channels.telegram.directMessages`, the bot can still appear healthy in `status` while staying silent in Telegram groups
- if `directMessages.policy` is `pairing`, unknown Telegram DMs are also gated until approved

### How To Get Telegram `chatId` And `topicId`

Use one of these practical paths:

1. Start `clisbot`, add the bot to the target Telegram group, and send `/start`, `/status`, or `/whoami` in that group.
2. Read the reply.
3. Copy `chatId` into `channels.telegram.groups.<chatId>`.
4. Copy `topicId` into `channels.telegram.groups.<chatId>.topics.<topicId>` when you are using a forum topic.

What `/whoami` gives you:

- `platform`
- `sessionKey`
- `senderId`
- `chatId`
- `topicId` when the current message is inside a Telegram forum topic

When the group or topic is not routed yet:

- Telegram still exposes a minimal command menu with `/start`, `/status`, `/help`, and `/whoami`
- the reply includes the exact `clisbot channels add telegram-group ...` command to run
- route-only commands such as `/transcript`, `/stop`, `/followup`, and `/bash` only make sense after the route is added; `/transcript` then follows `verbose`, while `/bash` still follows privilege gating

Practical notes:

- a normal Telegram group only needs `chatId`
- a Telegram forum supergroup topic needs both `chatId` and `topicId`
- the General topic usually uses topic id `1`
- if the bot is not responding yet, check `clisbot logs` after sending a message in the group and look for Telegram activity before assuming the token is wrong

Example:

- `/whoami` shows `chatId: -1001234567890`
- `/whoami` shows `topicId: 42`
- config path to use: `channels.telegram.groups."-1001234567890".topics."42"`

## Direct Message Pairing

Slack and Telegram direct messages support four access policies:

- `open`
- `pairing`
- `allowlist`
- `disabled`

Current defaults are:

- `channels.slack.directMessages.policy: "pairing"`
- `channels.telegram.directMessages.policy: "pairing"`

If you want OpenClaw-style gated DM onboarding, set the route to `pairing`.

Example:

```json
{
  "channels": {
    "slack": {
      "directMessages": {
        "enabled": true,
        "policy": "pairing",
        "allowFrom": [],
        "requireMention": false,
        "agentId": "default"
      }
    }
  }
}
```

Current policy meaning:

- `open`: accept any DM sender
- `pairing`: create or reuse a pending pairing code for unknown senders
- `allowlist`: accept only configured or previously approved senders
- `disabled`: ignore direct messages on that channel

Pairing commands:

```bash
bun run pairing -- list slack
```

```bash
bun run pairing -- approve slack <CODE>
```

```bash
bun run pairing -- list telegram
```

```bash
bun run pairing -- approve telegram <CODE>
```

Important rules:

- pairing is checked before session routing and before a runner starts
- approving a code adds the sender to the channel allowlist store
- the pairing store is channel-scoped
- `allowFrom` in config and approved senders in the pairing store are merged for access checks

Safe Slack verification flow:

1. set `channels.slack.directMessages.policy` to `"pairing"`
2. restart the service, or rely on `control.configReload.watch` if already enabled
3. send the bot a direct message from a user not already approved
4. confirm the bot replies with a pairing code
5. run `bun run pairing -- list slack`
6. run `bun run pairing -- approve slack <CODE>`
7. send another direct message from the same user
8. confirm the normal agent flow now runs
