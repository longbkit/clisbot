# Routes

## Purpose

Use this page for routed Slack and Telegram behavior during setup, debugging, and live operation.

Official operator surface:

- `clisbot routes ...`

Mental model:

- bots define provider identity and bot-wide defaults
- routes admit specific inbound surfaces under a bot
- a route may inherit the bot fallback agent or override it

## Route Ids

Slack route ids:

- `channel:<channelId>`
- `group:<groupId>`
- `dm:<userId|*>`

Telegram route ids:

- `group:<chatId>`
- `topic:<chatId>:<topicId>`
- `dm:<userId|*>`

Examples:

- `channel:C1234567890`
- `group:G1234567890`
- `dm:U1234567890`
- `group:-1001234567890`
- `topic:-1001234567890:42`
- `dm:1276408333`

## Route Commands

Common commands:

```bash
clisbot routes list
clisbot routes add --channel slack channel:C1234567890 --bot default
clisbot routes add --channel slack group:G1234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot default
clisbot routes add --channel telegram topic:-1001234567890:42 --bot default
clisbot routes add --channel telegram dm:* --bot default
clisbot routes set-agent --channel slack channel:C1234567890 --bot default --agent support
clisbot routes set-policy --channel telegram group:-1001234567890 --bot default --policy open
clisbot routes set-require-mention --channel slack channel:C1234567890 --bot default --value false
clisbot routes set-allow-bots --channel telegram topic:-1001234567890:42 --bot default --value true
clisbot routes add-allow-user --channel slack channel:C1234567890 --bot default --user U_OWNER
clisbot routes add-block-user --channel telegram group:-1001234567890 --bot default --user 1276408333
clisbot routes set-follow-up-mode --channel slack channel:C1234567890 --bot default --mode mention-only
clisbot routes set-follow-up-ttl --channel telegram topic:-1001234567890:42 --bot default --minutes 10
clisbot routes set-response-mode --channel slack channel:C1234567890 --bot default --mode message-tool
clisbot routes set-additional-message-mode --channel telegram topic:-1001234567890:42 --bot default --mode queue
```

Behavior rules:

- `add` is create-only
- if the route already exists, use the matching `set-<key>` command
- route-local overrides only work after the route exists
- `dm:*` owns DM admission fields: `policy`, `allowUsers`, `blockUsers`, and effective enabled state
- exact DM routes such as `dm:U1234567890` or `dm:1276408333` are behavior-only overrides and must not be used for DM auth mutation

## Route Policy

Typical meanings:

- `policy: "open"`: the route is admitted and open to allowed senders
- `policy: "allowlist"`: the route is admitted but sender access is restricted
- `policy: "pairing"`: DM-only policy that requires pairing unless auth bypasses it
- `policy: "disabled"`: the route is configured but inactive

Common defaults:

- Slack public or private shared surfaces usually start with `requireMention: true`
- Telegram groups and topics usually start with `requireMention: true`
- DM routes usually start with `requireMention: false`

DM-specific rule:

- pair or allow a DM sender on `dm:*`
- block a DM sender on `dm:*` too
- use exact DM routes only for per-user behavior overrides such as `agentId`, `streaming`, `responseMode`, `additionalMessageMode`, `followUp`, `verbose`, or `timezone`
- pairing approval also lands on the requesting bot's `dm:*` allowUsers, so DM admission stays in one place

## Route Ownership

Routes live under each bot:

```json
{
  "bots": {
    "slack": {
      "default": {
        "groups": {
          "channel:C_GENERAL": {
            "enabled": true,
            "policy": "open",
            "requireMention": false,
            "agentId": "support"
          }
        },
        "directMessages": {
          "dm:*": {
            "enabled": true,
            "policy": "pairing"
          }
        }
      }
    },
    "telegram": {
      "default": {
        "groups": {
          "-1001234567890": {
            "enabled": true,
            "policy": "allowlist",
            "topics": {
              "42": {
                "enabled": true,
                "policy": "open",
                "agentId": "support"
              }
            }
          }
        }
      }
    }
  }
}
```

## Conversation Commands

Useful commands inside routed Slack and Telegram conversations:

- `/start`
- `/help`
- `/status`
- `/whoami`
- `/stop`
- `/nudge`
- `/followup status`
- `/followup auto`
- `/followup mention-only`
- `/followup pause`
- `/followup resume`

Useful rule of thumb:

- use route config for admission and route-local behavior
- use auth roles for privileged actions such as `/bash`

## Transcript And Bash Rules

Current rule split:

- transcript visibility is route-local through `verbose`
- `/bash` depends on resolved auth permissions such as `shellExecute`

Use:

- `clisbot auth --help` for auth mutations
- `clisbot routes --help` for route mutations

## Follow-up And Mode Overrides

Route-local overrides can control:

- `followUp.mode`
- `followUp.participationTtlMin`
- `responseMode`
- `additionalMessageMode`
- `streaming`
- `surfaceNotifications`
- `verbose`

That gives one simple pattern:

- set stable behavior on the bot
- override only the few routes that need something different
