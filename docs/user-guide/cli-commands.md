# CLI Commands

This page is the operator-facing user guide for the `clisbot` CLI.

It answers two questions:

- what command family does this job
- what that command family does in practice

## Principles

- use kebab-case for all public flags
- one noun maps to one concept
- use `list`, `add`, `remove`, `enable`, `disable`, `get-<key>`, `set-<key>`, and `clear-<key>` consistently
- `add` creates a new object only
- when `add` would overwrite existing state, it fails and points to the right `set-<key>` command

## Mental Model

- `app`: global runtime behavior
- `bots`: provider bot identities, credentials, and provider-level defaults
- `routes`: admitted inbound surfaces under a bot
- `agents`: execution identity, workspace, and runner behavior

## Resolution Order

When more than one level is configured:

- route agent wins over bot fallback agent
- bot fallback agent wins over app default agent
- route settings inherit from the bot first, then route-specific settings override them

## Happy Paths

Start from what you want to do.

- Start from zero:
  - `clisbot start ...`
- Add one more bot identity:
  - `clisbot bots add ...`
- Add one more channel, group, topic, or DM surface under a bot:
  - `clisbot routes add ...`
- Route one specific surface to one specific agent:
  - `clisbot routes set-agent ...`
- Set one fallback agent for one whole bot:
  - `clisbot bots set-agent ...`
- Set the app-wide default agent:
  - `clisbot agents set-default ...`
- Inspect current bot or route state:
  - `clisbot bots list ...`
  - `clisbot routes list ...`
  - `clisbot bots get-<key> ...`
  - `clisbot routes get-<key> ...`

## Common Flags

- `--channel <slack|telegram>`
- `--bot <id>`
- `--agent <id>`
- `--json`
- `--persist`

Use `--bot` as the bot selector.

Bot id rules:

- with `--channel`, use the provider-local bot id
  - `--channel slack --bot default`
  - `--channel telegram --bot support`
- without `--channel` on a bot-specific command, use the fully qualified form
  - `--bot slack:default`
  - `--bot telegram:support`
- when a bot-specific command targets one provider and `--bot` is omitted, it defaults to `default`

## Top-Level

- `clisbot start`
- `clisbot restart`
- `clisbot stop`
- `clisbot status`
- `clisbot version`
- `clisbot logs`
- `clisbot update`
- `clisbot bots ...`
- `clisbot routes ...`
- `clisbot agents ...`
- `clisbot auth ...`
- `clisbot message ...`
- `clisbot runner ...`
- `clisbot pairing ...`
- `clisbot loops ...`
- `clisbot queues ...`
- `clisbot init`

## Service Lifecycle

- `clisbot start [first-run flags...]`: bootstrap config if needed and start the detached runtime
- `clisbot restart`: stop then start again
- `clisbot stop [--hard]`: stop runtime, optionally clean all tmux sessions on the clisbot socket
- `clisbot status`: inspect runtime, config, log, tmux state, and the five most recent runner sessions
- `clisbot logs [--lines N]`: print recent logs
- `clisbot update --help`: print the AI-readable package update guide, including stable/beta defaults, release notes, and migration index links
- `clisbot init [first-run flags...]`: bootstrap config and optional first agent without starting runtime

Focused help:

- `clisbot start --help`: first-run help for tokens, bot bootstrap, and examples
- `clisbot init --help`: same bootstrap help without starting the runtime
- `clisbot update --help`: package update checklist for humans and agents

## Bots

One bot is one provider identity.

Examples:

- a Slack bot entry stores one app token source and one bot token source
- a Telegram bot entry stores one bot token source

A bot can define:

- one bot-specific fallback agent
- conversation admission defaults for direct messages, groups, and Slack channels
- provider credential sources

Core commands:

- `clisbot bots list [--channel <slack|telegram>] [--json]`
- `clisbot bots add --channel telegram [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]`
- `clisbot bots add --channel slack [--bot <id>] --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]`
- `clisbot bots enable --channel <slack|telegram> [--bot <id>]`
- `clisbot bots disable --channel <slack|telegram> [--bot <id>]`
- `clisbot bots remove --channel <slack|telegram> [--bot <id>]`
- `clisbot bots get --channel <slack|telegram> [--bot <id>] [--json]`
- `clisbot bots get-agent --channel <slack|telegram> [--bot <id>]`
- `clisbot bots set-agent --channel <slack|telegram> [--bot <id>] --agent <id>`
- `clisbot bots clear-agent --channel <slack|telegram> [--bot <id>]`
- `clisbot bots get-default --channel <slack|telegram>`
- `clisbot bots set-default --channel <slack|telegram> --bot <id>`
- `clisbot bots get-credentials-source --channel <slack|telegram> [--bot <id>]`
- `clisbot bots set-credentials --channel telegram [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]`
- `clisbot bots set-credentials --channel slack [--bot <id>] --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]`
- `clisbot bots get-dm-policy --channel <slack|telegram> [--bot <id>]`
- `clisbot bots set-dm-policy --channel <slack|telegram> [--bot <id>] --policy <disabled|pairing|allowlist|open>`

Token aliases:

- Slack app token: `--app-token`, `--slack-app-token`
- Slack bot token: `--bot-token`, `--slack-bot-token`
- Telegram bot token: `--bot-token`, `--telegram-bot-token`

Important behavior:

- `bots add` creates a new bot only
- `bots add` does not admit any routes by itself
- if the bot already exists, `bots add` fails and points to `set-agent`, `set-credentials`, or another matching `set-<key>` command
- `disable` keeps the bot in config but stops using it for now
- `remove` deletes the bot from config
- `bots enable` and `bots disable` are the fast toggle when you want to keep config but stop or resume handling
- `bots remove` fails while any route still references that bot
- `bots set-agent` defines the bot-specific fallback agent
- if no bot-specific fallback agent is set, routing falls back to the app default agent
- if `--agent` is passed on `bots add`, it binds an existing agent
- if `--cli` and `--bot-type` are passed on `bots add`, the command creates and bootstraps a new agent for that bot
- `bots add` rejects ambiguous input such as passing both `--agent` and `--cli`
- shared-route admission for normal users comes from `groupPolicy` or Slack `channelPolicy`
- with default admission `allowlist`, normal users need explicit routes such as `group:<id>` or `topic:<chatId>:<topicId>`
- stored `groups["*"]` is the default sender rule after that shared surface is admitted

## Routes

One route is one inbound surface under one bot.

It inherits bot defaults first, then overrides only what needs to differ for that one surface.

Examples:

- one Slack public channel under one Slack bot
- one Slack private group or MPIM under one Slack bot
- one Slack DM fallback or one specific Slack DM peer under one Slack bot
- one Telegram group under one Telegram bot
- one Telegram topic inside one Telegram group under one Telegram bot
- one Telegram DM fallback or one specific Telegram DM peer under one Telegram bot

Notes:

- a Slack thread inside a channel uses the parent channel route
- a Telegram topic is its own route because topics are explicit sub-surfaces inside a group

Route ids:

- Slack shared surface: `group:C123456` or `group:G123456`
- Shared default fine-grain route: `group:*`
- Slack direct message fallback: `dm:*`
- Slack specific DM peer: `dm:U123456`
- Telegram group: `group:-1001234567890`
- Telegram topic: `topic:-1001234567890:42`
- Shared default fine-grain route: `group:*`
- Telegram direct message fallback: `dm:*`
- Telegram specific DM peer: `dm:1276408333`

Notes:

- canonical CLI shared wildcard route id is `group:*`
- canonical stored wildcard key under a bot is `groups["*"]`
- legacy shorthand `*`, old `groups:*`, and Slack `channel:<id>` input are still accepted for compatibility
- canonical operator naming still treats `group:<id>` as the preferred multi-user route id across providers
- `group:*` is the bot default multi-user sender policy node and should be updated, not treated as removable

Core commands:

- `clisbot routes list [--channel <slack|telegram>] [--bot <id>] [--json]`
- `clisbot routes add --channel slack <route-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]`
- `clisbot routes add --channel telegram <route-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]`
- `clisbot routes enable --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes disable --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes remove --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes get --channel <slack|telegram> <route-id> [--bot <id>] [--json]`
- `clisbot routes get-agent --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-agent --channel <slack|telegram> <route-id> [--bot <id>] --agent <id>`
- `clisbot routes clear-agent --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes get-policy --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-policy --channel <slack|telegram> <route-id> [--bot <id>] --policy <...>`
- `clisbot routes get-require-mention --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-require-mention --channel <slack|telegram> <route-id> [--bot <id>] --value <true|false>`
- `clisbot routes get-allow-bots --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-allow-bots --channel <slack|telegram> <route-id> [--bot <id>] --value <true|false>`
- `clisbot routes add-allow-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes remove-allow-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes add-block-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes remove-block-user --channel <slack|telegram> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes get-follow-up-mode --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-follow-up-mode --channel <slack|telegram> <route-id> [--bot <id>] --mode <auto|mention-only|paused>`
- `clisbot routes get-follow-up-ttl --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-follow-up-ttl --channel <slack|telegram> <route-id> [--bot <id>] --minutes <n>`
- `clisbot routes get-response-mode --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-response-mode --channel <slack|telegram> <route-id> [--bot <id>] --mode <capture-pane|message-tool>`
- `clisbot routes clear-response-mode --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes get-additional-message-mode --channel <slack|telegram> <route-id> [--bot <id>]`
- `clisbot routes set-additional-message-mode --channel <slack|telegram> <route-id> [--bot <id>] --mode <queue|steer>`
- `clisbot routes clear-additional-message-mode --channel <slack|telegram> <route-id> [--bot <id>]`

Policy rules:

- for Slack public channels, Slack groups, Telegram groups, and Telegram topics, route policy is one of:
  - `disabled`
  - `allowlist`
  - `open`
- for DM wildcard routes `dm:*`, route policy is one of:
  - `disabled`
  - `pairing`
  - `allowlist`
  - `open`
- exact DM routes such as `dm:U123456` or `dm:1276408333` may now carry per-user admission and behavior overrides when needed

Important behavior:

- `routes add` fails if the target bot does not exist
- `routes add` fails if the same route already exists under that bot and points to `set-agent` or another `set-<key>` command
- `routes add` can set route creation options in one command, including `--policy`, `--require-mention`, and `--allow-bots`
- `disable` keeps the route in config but stops using it for now
- `remove` deletes the route from config
- `routes enable` and `routes disable` are the fast toggle when you want to keep the route definition but stop or resume handling
- `routes set-agent` answers the operator question: which agent should handle this surface?
- an explicit route agent always wins over the bot-specific fallback agent
- shared surfaces use two gates:
  - gate 1 admission: `groupPolicy` or Slack `channelPolicy`; default `allowlist` means normal users need an explicit shared route such as `group:<id>` or `topic:<chatId>:<topicId>`
  - gate 2 sender policy: stored `groups["*"]` plus any route-local `allowUsers` and `blockUsers`; default is `open`
- shared routes enforce sender lists at ingress for Slack channels or groups and Telegram groups or topics
- app `owner` and app `admin` do not bypass `groupPolicy`/`channelPolicy` admission; after a group is admitted and enabled, they bypass sender allowlists, while shared `blockUsers` still applies
- `disabled` means silent, even for app `owner` and app `admin`
- adding `group:<id>` without `--policy` inherits the default in-group sender policy from `group:*`; exact group/channel/topic routes should omit `policy` unless that surface intentionally differs
- the deny message intentionally uses `group` as the common human-facing many-people term
- shared allowlist failures are denied before runner ingress with:
  - `You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`
- `pairing approve <channel> <code>` writes the approved sender into the requesting bot's wildcard DM route allowlist

How to add or block users:

- Slack DM allow: `clisbot routes add-allow-user --channel slack dm:* --bot <bot-id> --user U123ABC456`
- Slack DM block: `clisbot routes add-block-user --channel slack dm:* --bot <bot-id> --user U123ABC456`
- Telegram DM allow: `clisbot routes add-allow-user --channel telegram dm:* --bot <bot-id> --user 1276408333`
- Telegram DM block: `clisbot routes add-block-user --channel telegram dm:* --bot <bot-id> --user 1276408333`
- Shared default allow: `clisbot routes add-allow-user --channel slack group:* --bot <bot-id> --user U_OWNER`
- Shared default block: `clisbot routes add-block-user --channel telegram group:* --bot <bot-id> --user 1276408333`
- `group:*` writes to the default sender rule for all admitted groups under that bot, stored as `groups["*"]`
- Shared channel/group allow or block stays on that shared route itself, for example `group:<id>` or `topic:<chatId>:<topicId>`
- If one DM peer needs different admission or behavior, mutate that exact `dm:<userId>` route

Examples:

- `clisbot routes add --channel slack group:C_GENERAL`
- `clisbot routes add --channel slack group:G_SUPPORT --bot support --require-mention false`
- `clisbot routes add --channel telegram group:-1001234567890 --bot alerts --require-mention false --allow-bots true --policy allowlist`
- `clisbot routes add --channel slack dm:* --bot support --policy allowlist`
- `clisbot routes add --channel slack dm:U_OWNER --bot support`
- `clisbot routes add --channel telegram group:-1001234567890`
- `clisbot routes add --channel telegram topic:-1001234567890:42 --bot support --require-mention false`
- `clisbot routes set-agent --channel slack group:C_GENERAL --agent product`
- `clisbot routes set-require-mention --channel telegram topic:-1001234567890:42 --value false`
- `clisbot routes set-allow-bots --channel telegram group:-1001234567890 --bot alerts --value true`
- `clisbot routes set-policy --channel telegram group:* --bot alerts --policy allowlist`
- `clisbot routes add-allow-user --channel telegram group:* --bot alerts --user 1276408333`
- `clisbot routes add-allow-user --channel slack dm:* --bot support --user U_OWNER`
- `clisbot routes add-block-user --channel telegram group:-1001234567890 --user 1276408333`

## Agents

One agent is one execution identity.

The most important mental model is:

- one workspace
- one identity and instruction set
- one CLI tool family
- one set of runner startup and runtime overrides

Examples:

- one Codex work agent with its own workspace and memory
- one Claude support agent with another workspace and different guidance
- one Gemini personal agent for one specific bot or route

Core commands:

- `clisbot agents list [--json]`
- `clisbot agents get <id> [--json]`
- `clisbot agents add <id> --cli <codex|claude|gemini> --bot-type <personal|team> [--workspace <path>] [--startup-option <arg>]...`
- `clisbot agents enable <id>`
- `clisbot agents disable <id>`
- `clisbot agents remove <id>`
- `clisbot agents get-default`
- `clisbot agents set-default <id>`
- `clisbot agents bootstrap <id> --bot-type <personal|team> [--force]`
- `clisbot agents get-response-mode --agent <id>`
- `clisbot agents set-response-mode --agent <id> --mode <capture-pane|message-tool>`
- `clisbot agents clear-response-mode --agent <id>`
- `clisbot agents get-additional-message-mode --agent <id>`
- `clisbot agents set-additional-message-mode --agent <id> --mode <queue|steer>`
- `clisbot agents clear-additional-message-mode --agent <id>`

Important behavior:

- `agents add` creates a new execution identity only
- `agents add` fails if the agent already exists
- `disable` keeps the agent in config but stops exposing it through routing
- `remove` deletes the agent from config
- `agents enable` and `agents disable` are the fast toggle when you want to keep the agent but stop or resume exposing it
- `agents remove` fails while any bot or route still references that agent
- `agents set-default` defines the global fallback agent when a more specific bot or route choice is absent
- `--workspace` is optional; a sensible default workspace path exists
- `agents bootstrap` is the template refresh or update path
- without `--force`, `agents bootstrap` shows what files would change before overwriting them
- when practical, `agents bootstrap` shows a diff or at least a file-by-file overwrite plan

## Auth

- `clisbot auth list [--json]`
- `clisbot auth show <app|agent-defaults|agent> [--agent <id>] [--json]`
- `clisbot auth get-permissions --sender <principal> --agent <id> [--json] [--verbose]`
- `clisbot auth add-user <app|agent-defaults|agent> --role <role> --user <principal> [--agent <id>]`
- `clisbot auth remove-user <app|agent-defaults|agent> --role <role> --user <principal> [--agent <id>]`
- `clisbot auth add-permission <app|agent-defaults|agent> --role <role> --permission <permission> [--agent <id>]`
- `clisbot auth remove-permission <app|agent-defaults|agent> --role <role> --permission <permission> [--agent <id>]`

Important behavior:

- `app` edits `app.auth`
- `agent-defaults` edits `agents.defaults.auth`
- `agent --agent <id>` edits one agent override under `agents.list[].auth`
- `add-user` and `remove-user` mutate `roles.<role>.users`
- `add-permission` and `remove-permission` mutate `roles.<role>.allow`
- `get-permissions` is read-only and returns the sender's effective permissions for one agent
- use `--sender <principal>` for permission checks and `--user <principal>` for role assignment
- `principal` format is `<platform>:<provider-user-id>`, for example `telegram:1276408333` or `slack:U123ABC456`
- agent-specific writes clone the inherited role from `agents.defaults.auth.roles.<role>` into the target agent override on first mutation
- app permissions are limited to the app permission set: `configManage`, `appAuthManage`, `agentAuthManage`, `promptGovernanceManage`
- agent permissions are limited to the agent permission set shown by `clisbot auth --help`
- this CLI writes config; config remains the source of truth for routed auth
- `clisbot auth --help` is the detailed operator help surface for scopes, examples, and permission names
- app `owner` and `admin` principals bypass DM pairing automatically once granted

## Message Tooling

- `clisbot message send ...`
- `clisbot message poll ...`
- `clisbot message react ...`
- `clisbot message reactions ...`
- `clisbot message read ...`
- `clisbot message edit ...`
- `clisbot message delete ...`
- `clisbot message pin ...`
- `clisbot message unpin ...`
- `clisbot message pins ...`
- `clisbot message search ...`

Quick guide:

- use `send` to post a new message
- use `edit` to update one existing message
- use `react` or `reactions` for emoji reactions
- use `read` or `search` to inspect message history
- use `pin`, `unpin`, or `pins` for pinned messages
- use `poll` to create a poll

Required vs optional:

- `message send` requires `--channel`, `--target`, and one of `--message` or `--body-file`
- `message edit` requires `--channel`, `--target`, `--message-id`, and one of `--message` or `--body-file`
- `message react` requires `--channel`, `--target`, `--message-id`, and `--emoji`
- `message poll` requires `--channel`, `--target`, `--poll-question`, and at least one `--poll-option`
- `message search` requires `--channel`, `--target`, and `--query`

Important behavior:

- `--account` chooses which bot account sends or edits the message; if omitted, the provider default bot is used
- `--target` is the destination:
  - Slack uses destination ids such as channels, groups, or DM destinations
  - Telegram uses the numeric chat id
- `--thread-id` chooses the Slack thread container
- `--topic-id` chooses the Telegram topic container
- `--reply-to` replies to one specific message inside that destination
- `message send` and `message edit` accept:
  - `--input <plain|md|html|mrkdwn|blocks>`
  - `--render <native|none|html|mrkdwn|blocks>`
  - `--body-file <path>` as an alternative to `--message`
  - `--message-file <path>` as a compatibility alias for `--body-file`
  - `--file <path-or-url>` as the preferred attachment flag
  - `--media <path-or-url>` as a compatibility alias for `--file`
- default behavior is intentionally short and stable:
  - `--input md`
  - `--render native`
- keep agent reply prompts short by channel:
  - Telegram `native` or `html`: the final payload must stay under `4096` characters, so Markdown-to-HTML paths should leave headroom
  - Slack text or `mrkdwn`: prefer text under `4000` characters; Slack truncates very long text after `40000`
  - Slack `blocks`: keep header text under `150`, section text under `3000`, and total blocks under `50`
- `native` means channel-owned rendering:
  - Telegram currently resolves to Telegram-safe HTML
  - Slack currently resolves to Slack `mrkdwn`
- use `--render none` when the content is already in the destination-native format
  - Telegram example: `--input html --render none`
  - Slack example: `--input mrkdwn --render none`
  - Slack raw Block Kit example: `--input blocks --render none`
- use `--render blocks` when you want Slack Block Kit output from markdown input
- invalid combinations fail fast:
  - `--message` and `--body-file` cannot be used together
  - `--body-file` and `--message-file` are aliases; use only one
  - Telegram does not use `mrkdwn` or `blocks`
  - Slack does not use `html`
  - `--progress` and `--final` cannot be used together
- `--progress` and `--final` are conversation-tracking signals for agent flow; they are not body formatting options
- for the full contract, channel matrix, and current renderer behavior, see [Message Command Formatting And Render Modes](../features/channels/message-command-formatting-and-render-modes.md)

## Runner Debugging

- `clisbot runner list`
- `clisbot runner inspect <session-name>|--latest|--index <n> [--lines <n>]`
- `clisbot runner watch <session-name> [--lines <n>] [--interval <duration>]`
- `clisbot runner watch --index <n> [--lines <n>] [--interval <duration>] [--timeout <duration>]`
- `clisbot runner watch --latest [--lines <n>] [--interval <duration>] [--timeout <duration>]`
- `clisbot runner watch --next [--lines <n>] [--interval <duration>] [--timeout <duration>]`
- `clisbot inspect ...`
- `clisbot watch ...`
- `clisbot runner smoke ...`

Important behavior:

- main help promotes `clisbot runner list` and `clisbot watch --latest` as the fastest tmux debug entry points
- `runner list` shows mapped `sessionId` plus a simple persisted state when available; it does not repeat `sessionKey` or `live`, and tmux-only sessions are labeled `unmanaged`
- `clisbot status` includes the newest five runner sessions by default; if there are more, it prints `(n) sessions more`
- `runner list` prefixes each row with a 1-based index such as `[1]`; `inspect --index <n>` and `watch --index <n>` use that exact order
- top-level `clisbot inspect` and `clisbot watch` are shorthand for `clisbot runner inspect` and `clisbot runner watch`
- `inspect --latest` means the session with the newest admitted prompt
- `watch --latest` means the session with the newest admitted prompt, not the newest tmux spawn
- `watch --next` waits for the first newly admitted prompt after the command starts, then sticks to that session
- `--lines` controls the pane tail window for both `inspect` and `watch`; `inspect` defaults to 100 lines
- `--interval` controls polling cadence for `watch`
- `runner watch` keeps the header compact with `session`, `agent`, `sessionId`, `lines`, and current `state`
- use raw tmux only when you need lower-level actions beyond this control surface

## Pairing

- `clisbot pairing list <slack|telegram> [--json]`
- `clisbot pairing approve <slack|telegram> <code>`
- `clisbot pairing reject <slack|telegram> <code>`
- `clisbot pairing clear <slack|telegram>`

Important behavior:

- pairing is only relevant for direct-message routes that use `policy=pairing`
- `list` shows pending pairing requests for one provider at a time
- `approve` and `reject` operate on one pairing code
- `clear` removes pending pairing requests for one provider

## Loops

- `clisbot loops list`
- `clisbot loops status`
- `clisbot loops status --channel slack --target group:C1234567890 --thread-id 1712345678.123456`
- `clisbot loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI`
- `clisbot loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI`
- `clisbot loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox`
- `clisbot loops --channel telegram --target group:-1001234567890 --topic-id 42 --sender telegram:1276408333 5m check CI`
- `clisbot loops --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 3 review backlog`
- `clisbot loops cancel <id>`
- `clisbot loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --all`
- `clisbot loops cancel --all`

Targeting:

- `--target` selects the routed surface
- Slack accepts `group:<id>`, `dm:<user-or-channel-id>`, or raw `C...` / `G...` / `D...` ids
- Telegram accepts the route-style `group:<chat-id>` or `topic:<chat-id>:<topic-id>` target; raw numeric chat ids are accepted for compatibility
- `--thread-id` means an existing Slack thread ts
- `--topic-id` means a Telegram topic id
- omitting the sub-surface flag targets the parent Slack channel/group/DM or Telegram chat
- `--new-thread` is Slack-only and creates a fresh thread anchor before the loop starts
- `--sender <principal>` is required for loop creation and records the human creator as `slack:<user-id>` or `telegram:<user-id>`
- `--sender-name <name>` and `--sender-handle <handle>` optionally store readable creator context for scheduled prompts
- in Telegram forum groups, omitting `--topic-id` targets the parent chat surface; sends then follow Telegram's normal no-`message_thread_id` behavior, which is the General topic when that forum has one

Examples:

- recurring loops are created from chat with `/loop 5m check CI` or `/loop every day at 07:00 check CI`
- use scoped `clisbot loops ... --channel ... --target ...` when you want the same session-specific create, status, or cancel behavior from the operator CLI
- CLI loop creation fails without `--sender` so delayed work keeps a real creator instead of rendering sender as unavailable
- use app-wide `clisbot loops list`, `clisbot loops status`, or `clisbot loops cancel --all` when you want global inventory or emergency cleanup
- use scoped `clisbot loops list --channel ... --target ...` when you want one routed session
- CLI creation accepts the same expression families as `/loop`: interval, forced interval, times/count, and calendar schedules
- omit the prompt body to load `LOOP.md` from the target workspace for maintenance loops
- count/times loops run synchronously in the CLI process today; recurring loops are persisted for the runtime scheduler
- the first wall-clock loop create attempt returns confirmation-required output and does not persist a loop until rerun with `--confirm`
- AI agents should inspect `clisbot loops --help` for schedule, loop, or reminder requests and follow the CLI output instead of guessing loop state

## Queues

- `clisbot queues list`
- `clisbot queues list --channel telegram --target group:-1001234567890 --topic-id 4335`
- `clisbot queues status`
- `clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 review backlog`
- `clisbot queues clear --channel telegram --target group:-1001234567890 --topic-id 4335`
- `clisbot queues clear --all`

Important behavior:

- `list` shows pending queued prompts only
- `status` shows pending and running queued prompts
- `clear` removes pending prompts only and does not interrupt a running prompt
- `create` matches the documented `loops create` addressing shape and requires
  explicit `--channel/--target` routed addressing
- `create` requires `--sender <principal>` so durable queued work has sender metadata
- `create` is capped by `control.queue.maxPendingItemsPerSession`; the default
  is `20` pending items per session when the config key is omitted
- `--current` is not supported
- use `--channel/--target` for scoped inspection, creation, and clearing
- queued prompts are stored under `StoredSessionEntry.queues` in `session.storePath`
- stored queue items are the canonical queue inventory; the live runtime
  hydrates them into the same ordered drain used by `/queue`, so ordering,
  `positionAhead`, active-run idle guards, lazy prompt rebuild, start
  notifications, and cleared-pending settlement stay consistent

## Timezone

- `clisbot timezone get`
- `clisbot timezone set Asia/Ho_Chi_Minh`
- `clisbot timezone clear`
- `clisbot timezone doctor`
- `clisbot agents get-timezone --agent default`
- `clisbot agents set-timezone --agent support-us America/Los_Angeles`
- `clisbot agents clear-timezone --agent support-us`
- `clisbot routes get-timezone --channel telegram group:-1001234567890 --bot default`
- `clisbot routes set-timezone --channel telegram group:-1001234567890 --bot default Asia/Ho_Chi_Minh`
- `clisbot routes clear-timezone --channel telegram topic:-1001234567890:4 --bot default`
- `clisbot bots get-timezone --channel telegram --bot default`
- `clisbot bots set-timezone --channel telegram --bot default Asia/Ho_Chi_Minh`
- `clisbot bots clear-timezone --channel telegram --bot default`

Timezone guidance:

- app timezone is the normal default; prefer `clisbot timezone set <iana>` when the whole install should use one timezone
- agent timezone is for one assistant/workspace that mostly serves a different timezone
- route timezone is for one Slack channel, Telegram group, or topic that has different local time from its app or agent default
- bot timezone is advanced fallback for a concrete provider bot; do not use provider-default timezone fields
- CLI first wall-clock loop creation prints the resolved timezone before persisting; if it is wrong, set timezone first, then create again

## First-Run Flows

### Start From Zero

Telegram personal bot:

```bash
clisbot start \
  --channel telegram \
  --bot-token TELEGRAM_BOT_TOKEN \
  --cli codex \
  --bot-type personal \
  --persist
```

Slack team bot:

```bash
clisbot start \
  --channel slack \
  --app-token SLACK_APP_TOKEN \
  --bot-token SLACK_BOT_TOKEN \
  --cli claude \
  --bot-type team \
  --persist
```

### Add One More Route To The Existing Default Bot

Slack channel to the same default agent:

```bash
clisbot routes add --channel slack group:C_GENERAL
```

Telegram topic to the same default agent:

```bash
clisbot routes add --channel telegram topic:-1001234567890:42
```

If that route should use another agent:

```bash
clisbot routes set-agent --channel telegram topic:-1001234567890:42 --agent alerts
```

### Add One New Bot With One New Agent

Slack support bot with a fresh Claude team agent:

```bash
clisbot bots add \
  --channel slack \
  --bot support \
  --app-token SLACK_SUPPORT_APP_TOKEN \
  --bot-token SLACK_SUPPORT_BOT_TOKEN \
  --cli claude \
  --bot-type team \
  --persist

clisbot routes add --channel slack group:C_SUPPORT --bot support --require-mention false
```

Telegram alerts bot with a fresh Gemini personal agent:

```bash
clisbot bots add \
  --channel telegram \
  --bot alerts \
  --bot-token TELEGRAM_ALERTS_BOT_TOKEN \
  --cli gemini \
  --bot-type personal \
  --persist

clisbot routes add --channel telegram dm:* --bot alerts
clisbot bots set-dm-policy --channel telegram --bot alerts --policy allowlist
clisbot routes add-allow-user --channel telegram dm:* --bot alerts --user 1276408333
```
