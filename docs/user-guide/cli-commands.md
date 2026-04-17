# CLI Commands

## Status

Current runtime command inventory.

This page is the canonical overview for operator CLI surfaces and a quick reference for auth and permission planning.

## Source Of Truth

- Top-level parse and help: `src/cli.ts`
- Runtime dispatch: `src/main.ts`
- Subcommand families:
  - `src/control/channels-cli.ts`
  - `src/control/accounts-cli.ts`
  - `src/control/loops-cli.ts`
  - `src/control/message-cli.ts`
  - `src/control/agents-cli.ts`
  - `src/control/auth-cli.ts`
  - `src/channels/pairing/cli.ts`

If this page and runtime ever disagree, runtime wins.

## Top-Level

- `clisbot start`
- `clisbot restart`
- `clisbot stop`
- `clisbot status`
- `clisbot version`
- `clisbot logs`
- `clisbot channels ...`
- `clisbot accounts ...`
- `clisbot loops ...`
- `clisbot message ...`
- `clisbot agents ...`
- `clisbot auth ...`
- `clisbot pairing ...`
- `clisbot init`

## Service Lifecycle

- `clisbot start [bootstrap flags...]`: seed config if needed and start the detached runtime
- `clisbot restart`: stop then start again
- `clisbot stop [--hard]`: stop runtime, optionally clean all tmux sessions on the clisbot socket
- `clisbot status`: inspect runtime, config, log, and tmux state
- `clisbot logs [--lines N]`: print recent logs
- `clisbot init [bootstrap flags...]`: seed config and optionally first agent without starting runtime

Focused help:

- `clisbot start --help`: bootstrap-first help for first-run flags, token input, and examples
- `clisbot init --help`: same bootstrap-focused help, but for config-only setup without starting runtime

## Channels

- `clisbot channels enable <slack|telegram>`
- `clisbot channels disable <slack|telegram>`
- `clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove telegram-group <chatId> [--topic <topicId>]`
- `clisbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove slack-channel <channelId>`
- `clisbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove slack-group <groupId>`
- `clisbot channels response-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]`
- `clisbot channels response-mode set <capture-pane|message-tool> --channel <slack|telegram> [--target <target>] [--topic <topicId>]`
- `clisbot channels additional-message-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]`
- `clisbot channels additional-message-mode set <queue|steer> --channel <slack|telegram> [--target <target>] [--topic <topicId>]`
- `clisbot channels set-token <slack-app|slack-bot|telegram-bot> <value>`
- `clisbot channels clear-token <slack-app|slack-bot|telegram-bot>`

Important behavior:

- route adds for Slack channels, Slack groups, Telegram groups, and Telegram topics default to `requireMention: true`
- pass `--require-mention false` only when that surface should accept plain non-mention follow-up immediately

## Accounts

- `clisbot accounts add telegram --account <id> (--token | --telegram-bot-token) <ENV_NAME|${ENV_NAME}|literal> [--persist]`
- `clisbot accounts add slack --account <id> (--app-token | --slack-app-token) <ENV_NAME|${ENV_NAME}|literal> (--bot-token | --slack-bot-token) <ENV_NAME|${ENV_NAME}|literal> [--persist]`
- `clisbot accounts persist --channel <slack|telegram> --account <id>`
- `clisbot accounts persist --all`

Important behavior:

- `clisbot accounts help` and `clisbot accounts --help` both work
- env-style values keep the account env-backed
- `accounts add` accepts both the short account-local flags and the bootstrap-style token flags
- literal token values without `--persist` stay runtime-only and require a running clisbot runtime
- `--persist` writes canonical token files for later plain starts

## Loops

- `clisbot loops list`
- `clisbot loops status`
- `clisbot loops cancel <id>`
- `clisbot loops cancel --all`

Examples:

- recurring loops are created from chat with `/loop 5m check CI` or `/loop every day at 07:00 check CI`
- use `clisbot loops ...` only to inspect or cancel persisted loops later from the operator CLI

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

Important behavior:

- `message send` and `message edit` now accept:
  - `--input <plain|md|html|mrkdwn|blocks>`
  - `--render <native|none|html|mrkdwn|blocks>`
  - `--body-file <path>` as an alternative to `--message`
  - `--message-file <path>` as a compatibility alias for `--body-file`
- default behavior is intentionally short and stable:
  - `--input md`
  - `--render native`
- `native` means channel-owned rendering:
  - Telegram currently resolves to Telegram-safe HTML
  - Slack currently resolves to Slack `mrkdwn`
- use `--render none` when the content is already in the destination-native format
  - Telegram example: `--input html --render none`
  - Slack example: `--input mrkdwn --render none`
  - Slack raw Block Kit example: `--input blocks --render none`
- use `--render blocks` when you want Slack Block Kit output from markdown input
- for the full contract, channel matrix, and current renderer behavior, see [Message Command Formatting And Render Modes](../features/channels/message-command-formatting-and-render-modes.md)

## Agents

- `clisbot agents help`
- `clisbot agents list`
- `clisbot agents list --bindings`
- `clisbot agents list --json`
- `clisbot agents add <id> --cli <codex|claude|gemini> [--workspace <path>] [--startup-option <arg>]... [--bot-type <personal|team>] [--bind <channel[:accountId]>]...`
- `clisbot agents bootstrap <id> --bot-type <personal|team> [--force]`
- `clisbot agents bindings [--agent <id>] [--json]`
- `clisbot agents bind --agent <id> --bind <channel[:accountId]>`
- `clisbot agents unbind --agent <id> [--bind <channel[:accountId]> | --all]`
- `clisbot agents response-mode status --agent <id>`
- `clisbot agents response-mode set <capture-pane|message-tool> --agent <id>`
- `clisbot agents response-mode clear --agent <id>`
- `clisbot agents additional-message-mode status --agent <id>`
- `clisbot agents additional-message-mode set <queue|steer> --agent <id>`
- `clisbot agents additional-message-mode clear --agent <id>`

Important behavior:

- `clisbot agents --help` and `clisbot agents help` both work
- `agents add` is the lower-level manual surface; first-run `clisbot start` and `clisbot init` can bootstrap the first `default` agent for you
- explicit route `agentId` still wins before top-level fallback bindings

## Auth

- `clisbot auth list [--json]`
- `clisbot auth show <app|agent-defaults|agent> [--agent <id>] [--json]`
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
- agent-specific writes clone the inherited role from `agents.defaults.auth.roles.<role>` into the target agent override on first mutation
- app permissions are limited to the app permission set: `configManage`, `appAuthManage`, `agentAuthManage`, `promptGovernanceManage`
- agent permissions are limited to the agent permission set shown by `clisbot auth --help`
- this CLI writes config; config remains the source of truth for routed auth
- `clisbot auth --help` is the detailed operator help surface for scopes, examples, and permission names
- app `owner` and `admin` principals bypass DM pairing automatically once granted

## Pairing

- `clisbot pairing help`
- `clisbot pairing list <slack|telegram> [--json]`
- `clisbot pairing approve <slack|telegram> <code>`
- `clisbot pairing reject <slack|telegram> <code>`
- `clisbot pairing clear <slack|telegram>`

## Notes

- This page is inventory-first by design
- It is meant to answer “what commands exist” before answering “how each one behaves”
- For current route and channel operating details, see `docs/user-guide/channels.md`
