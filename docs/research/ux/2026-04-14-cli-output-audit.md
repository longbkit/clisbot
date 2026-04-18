---
title: CLI Output Audit
status: draft
date: 2026-04-14
area: ux
summary: Audit draft for current `clisbot` CLI command output, with emphasis on onboarding-critical commands mentioned in Slack and Telegram setup guides, then the remaining operator-facing CLI surfaces.
---

# CLI Output Audit

## Purpose

This draft reviews current CLI output as a product surface.

## Historical Note

This audit was captured before the official operator model fully converged on `bots` and `routes`.

Many examples below intentionally preserve then-current output, including removed `channels` and `accounts` surfaces.

Read this document as UX audit history, not as current CLI guidance.

The goal is not API completeness.

The goal is to quickly spot places where command output can become:

- more user-friendly
- more conversion-focused
- more frictionless during onboarding
- easier to scan under pressure

## Scope

This draft prioritizes:

1. commands explicitly mentioned in:
   - `docs/user-guide/telegram-setup.md`
   - `docs/user-guide/slack-setup.md`
2. the remaining top-level operator-facing CLI surfaces

Live destructive commands such as `stop`, `stop --hard`, and `restart` were not run for this draft.

## How To Read This Audit

Each section now uses the same structure:

- `Current output`: what the CLI returns today
- `Problems to address`: why the current copy still creates friction
- `Proposed output`: a draft rewrite that addresses those problems directly

The proposed output is not implementation-ready wording yet.

It is a review artifact meant to make the UX direction concrete.

## Evidence Map

| Area | Command | Why It Matters | Evidence |
| --- | --- | --- | --- |
| Onboarding | `clisbot --help` | first install / first contact surface | live-captured |
| Onboarding | `clisbot start` first-run failure | high-conversion failure path | live-captured in temp config |
| Onboarding | `clisbot init --cli codex --bot-type personal` first-run failure | pre-start bootstrap path | live-captured in temp config |
| Onboarding | `clisbot status` | primary setup verification command in both guides | live-captured |
| Onboarding | `clisbot logs --lines 20` | primary troubleshooting command in both guides | live-captured |
| Onboarding | `clisbot pairing approve <channel> <CODE>` | DM approval path in both guides | live-captured via usage/error output |
| Onboarding | `clisbot channels add telegram-group ...` | Telegram routing path | live-captured via usage/error output |
| Onboarding | `clisbot channels add slack-channel ...` | Slack public-channel routing path | live-captured via usage/error output |
| Onboarding | `clisbot channels add slack-group ...` | Slack private-channel routing path | live-captured via usage/error output |
| Remaining | `clisbot channels --help` | biggest route/setup control surface | live-captured |
| Remaining | `clisbot accounts --help` | account lifecycle surface | live-captured |
| Remaining | `clisbot loops --help` | recurring loop management | live-captured |
| Remaining | `clisbot message --help` | provider message action surface | live-captured |
| Remaining | `clisbot agents list` | configured-agent visibility | live-captured |
| Remaining | `clisbot pairing list telegram` | pairing visibility | live-captured |
| Remaining | `clisbot version` | install/debug sanity check | live-captured |

## Topline UX Gaps

- onboarding copy still leaks internal terms too early
- several error surfaces tell the user the syntax, but not the next likely successful command
- `status` is strong on truthfulness but weak on hierarchy
- `channels --help` is doing too many jobs in one screen
- some compact surfaces are clear but under-explained

## Onboarding-Critical Outputs

### 1. Root Help

Command:

```bash
bun run src/main.ts --help
```

Current output:

```text
clisbot v0.1.14

Fastest start:
  1. Choose the channels you want to bootstrap explicitly.
  2. Run one of these commands:
     clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN
     clisbot start --cli codex --bot-type personal --telegram-bot-token "$TELEGRAM_BOT_TOKEN" --persist
     clisbot start --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN
  3. Use `clisbot status` to see the config path, log path, tmux socket, and runtime state.

Bot types:
  personal  One human gets one dedicated long-lived assistant workspace and session path.
  team      One shared channel or group routes into one shared assistant workspace and session path.

Credential input rules:
  Pass ENV_NAME or ${ENV_NAME} to keep the account env-backed.
  Pass a raw or shell-expanded token value to use credentialType=mem for the current runtime only.
  Raw token input on `start` is only for cold start unless you also pass --persist.
  Fresh bootstrap only enables channels named by flags; ambient env vars alone do not auto-enable extra channels.

Usage:
  clisbot start [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]
               [--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...
               [--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...
  clisbot restart
  clisbot stop [--hard]
  clisbot status
  clisbot version
  clisbot logs [--lines N]
  clisbot channels <subcommand>
  clisbot accounts <subcommand>
  clisbot loops <subcommand>
  clisbot message <subcommand>
  clisbot agents <subcommand>
  clisbot pairing <subcommand>
  clisbot init [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]
              [--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...
              [--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...
  clis <same-command>
  clisbot --help
...
```

Problems to address:

- The top block is useful, but still assumes the reader already understands token source choices and bot type choices.
- `credentialType=mem` is an implementation term, not a top-of-funnel onboarding term.
- Onboarding guidance and full reference are mixed together too early.

Proposed output:

```text
clisbot v0.1.14

Start in 2 minutes:
  Telegram personal bot:
    clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN

  Slack team bot:
    clisbot start --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN

  After starting:
    clisbot status

Bot types:
  personal  one human gets one dedicated assistant workspace
  team      one shared channel or group gets one shared assistant workspace

Token input:
  ENV_NAME or ${ENV_NAME} keeps the account env-backed
  a literal token starts with a temporary runtime-only credential unless you also pass --persist

Most used commands:
  clisbot start
  clisbot status
  clisbot logs --lines 50
  clisbot channels --help
  clisbot pairing --help

Full reference:
  clisbot accounts --help
  clisbot loops --help
  clisbot message --help
  clisbot agents --help

Docs:
  docs/user-guide/README.md
```

Why this proposed version is better:

- It keeps the first successful action near the top.
- It removes internal config vocabulary from the first screen.
- It separates `start now` guidance from the deeper reference surface.

### 2. First-Run `start` Failure

Command:

```bash
tmpdir=$(mktemp -d)
CLISBOT_HOME="$tmpdir" CLISBOT_CONFIG_PATH="$tmpdir/clisbot.json" bun run src/main.ts start
```

Current output:

```text

+---------+
| FAILED  |
+---------+

warning first-run bootstrap needs explicit channel flags, so clisbot did not start.
Slack token refs: app=SLACK_APP_TOKEN (set), bot=SLACK_BOT_TOKEN (set)
Telegram token ref: TELEGRAM_BOT_TOKEN (set)
Pass the channels you want explicitly, for example with --telegram-bot-token or --slack-app-token plus --slack-bot-token.
Use ENV_NAME or ${ENV_NAME} for env-backed setup, or pass a literal token to cold-start with credentialType=mem.
Example: clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN
Repo docs path (local or GitHub): docs/user-guide/bots-and-credentials.md
Slack docs: https://api.slack.com/apps
Telegram docs: https://core.telegram.org/bots#6-botfather
If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.

+---------+
| FAILED  |
+---------+
```

Problems to address:

- `explicit channel flags` is accurate but not natural operator language.
- The user is told what went wrong, but not shown the most likely successful next command strongly enough.
- `credentialType=mem` is too internal for an onboarding failure.

Proposed output:

```text
+---------+
| FAILED  |
+---------+

No channel was selected for first-time setup.

clisbot found these token references:
  Slack app token: SLACK_APP_TOKEN
  Slack bot token: SLACK_BOT_TOKEN
  Telegram bot token: TELEGRAM_BOT_TOKEN

Choose one channel to turn on now:
  Telegram personal bot:
    clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN

  Slack team bot:
    clisbot start --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN

Token note:
  ENV_NAME or ${ENV_NAME} keeps using an env var
  a literal token starts with a temporary runtime-only credential unless you also pass --persist

Docs:
  docs/user-guide/bots-and-credentials.md
  https://api.slack.com/apps
  https://core.telegram.org/bots#6-botfather
```

Why this proposed version is better:

- It starts with a plain-language diagnosis.
- It gives the operator two concrete next actions immediately.
- It keeps the token-source rule, but translates it into user-facing language.

### 3. First-Run `init` Failure

Command:

```bash
tmpdir=$(mktemp -d)
CLISBOT_HOME="$tmpdir" CLISBOT_CONFIG_PATH="$tmpdir/clisbot.json" bun run src/main.ts init --cli codex --bot-type personal
```

Current output:

```text
warning first-run bootstrap needs explicit channel flags, so clisbot did not start.
Slack token refs: app=SLACK_APP_TOKEN (set), bot=SLACK_BOT_TOKEN (set)
Telegram token ref: TELEGRAM_BOT_TOKEN (set)
Pass the channels you want explicitly, for example with --telegram-bot-token or --slack-app-token plus --slack-bot-token.
Use ENV_NAME or ${ENV_NAME} for env-backed setup, or pass a literal token to cold-start with credentialType=mem.
Example: clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN
Repo docs path (local or GitHub): docs/user-guide/bots-and-credentials.md
Slack docs: https://api.slack.com/apps
Telegram docs: https://core.telegram.org/bots#6-botfather
If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.
```

Problems to address:

- The remediation path is mostly good.
- The main mismatch is intent: `init` is not `start`, so `did not start` is the wrong outcome sentence here.
- Reusing the same copy across both commands hides an important mental-model difference.

Proposed output:

```text
Initialization did not finish because no channel was selected.

Choose the first channel account to add:
  Telegram:
    clisbot init --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN

  Slack:
    clisbot init --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN

Token note:
  ENV_NAME or ${ENV_NAME} keeps using an env var
  a literal token is temporary unless you later persist it

Docs:
  docs/user-guide/bots-and-credentials.md
```

Why this proposed version is better:

- It respects the semantics of `init`.
- It teaches the correct next command shape instead of falling back to `start`.
- It reduces mental drift between bootstrap and runtime flows.

### 4. `status`

Command:

```bash
bun run src/main.ts status
```

Current output:

```text
version: 0.1.14
running: yes
pid: 117486
workspace: /home/node/.clisbot/workspaces/default (agent workspace: default work dir; contains state, sessions, personality, and guidance files)
config: /home/node/.clisbot/clisbot.json
pid file: /home/node/.clisbot/state/clisbot.pid
log: /home/node/.clisbot/state/clisbot.log
tmux socket: /home/node/.clisbot/state/clisbot.sock
Slack account default: source=env app=SLACK_APP_TOKEN bot=SLACK_BOT_TOKEN
Telegram account default: source=env name=TELEGRAM_BOT_TOKEN
stats agents=1 bootstrapped=1 pendingBootstrap=0 tmuxSessions=2
Agents:
  - default tool=codex bootstrap=team-assistant:bootstrapped last=2026-04-14T17:30:59.724Z responseMode=inherit additionalMessageMode=inherit

Channels:
  - slack enabled=yes connection=disabled defaultAgent=default streaming=all response=final responseMode=message-tool additionalMessageMode=steer dm=pairing groups=allowlist routes=none last=2026-04-13T05:41:17.502Z via default
  - telegram enabled=yes connection=active defaultAgent=default streaming=all response=final responseMode=message-tool additionalMessageMode=steer dm=pairing groups=allowlist routes=2 last=2026-04-14T17:30:59.724Z via default

Channel health:
  - slack: Slack channel is disabled in config.
    updated: 2026-04-14T07:45:07.707Z
  - telegram: Telegram polling connected for 1 account(s).
    updated: 2026-04-14T07:45:10.113Z
    instances: default bot=@longluong2bot token#c56b9033

Active runs:
  - agent=default state=running startedAt=2026-04-14T17:26:36.125Z sessionKey=agent:default:telegram:group:-1003455688247:topic:1207
  - agent=default state=running startedAt=2026-04-14T17:31:00.169Z sessionKey=agent:default:telegram:group:-1003455688247:topic:1230

Channel setup notes:
  - slack: no explicit channel or group routes are configured yet
    dms: enabled (pairing)
    groups: allowlist
    route: configure channels.slack.channels.<channelId> or channels.slack.groups.<groupId>
```

Problems to address:

- This is a strong truth surface, but it leads with implementation detail before user outcome.
- A first-time operator has to read too far before learning whether the bot is healthy.
- The command needs better hierarchy, not less information.

Proposed output:

```text
clisbot status

Summary:
  Runtime: running
  Telegram: connected
  Slack: disabled in config
  Agents: 1 configured
  Active runs: 2

Next action:
  Slack is not routed yet.
  Add a Slack channel or group route if you want Slack to receive messages.

Paths:
  Config: /home/node/.clisbot/clisbot.json
  Log: /home/node/.clisbot/state/clisbot.log
  tmux socket: /home/node/.clisbot/state/clisbot.sock
  Workspace: /home/node/.clisbot/workspaces/default

Accounts:
  Slack default: env-backed
  Telegram default: env-backed

Agents:
  - default tool=codex bootstrap=team-assistant:bootstrapped responseMode=inherit additionalMessageMode=inherit

Channels:
  - slack enabled=yes connection=disabled dm=pairing groups=allowlist routes=none
  - telegram enabled=yes connection=active dm=pairing groups=allowlist routes=2

Channel health:
  - slack: disabled in config
  - telegram: polling connected for 1 account
    instance: default bot=@longluong2bot token#c56b9033

Active runs:
  - agent=default state=running sessionKey=agent:default:telegram:group:-1003455688247:topic:1207
  - agent=default state=running sessionKey=agent:default:telegram:group:-1003455688247:topic:1230
```

Why this proposed version is better:

- It answers `is it healthy` first.
- It turns setup gaps into a visible next action instead of hiding them at the bottom.
- It preserves the operator-truth detail below the summary.

### 5. `logs --lines 20`

Command:

```bash
bun run src/main.ts logs --lines 20
```

Current output:

```text
[errors]: [ [Error], [Error] ]
  }
}
telegram typing failed TypeError: fetch failed
    at node:internal/deps/undici/undici:14976:13
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async callTelegramApi (file:///home/node/.npm-global/lib/node_modules/clisbot/dist/main.js:70176:18)
    at async TelegramPollingService.sendTyping (file:///home/node/.npm-global/lib/node_modules/clisbot/dist/main.js:71045:5)
    at async Timeout._onTimeout (file:///home/node/.npm-global/lib/node_modules/clisbot/dist/main.js:70599:9) {
  [cause]: AggregateError [ETIMEDOUT]:
      at internalConnectMultiple (node:net:1134:18)
      at internalConnectMultiple (node:net:1210:5)
      at Timeout.internalConnectMultipleTimeout (node:net:1742:5)
      at listOnTimeout (node:internal/timers:587:11)
      at process.processTimers (node:internal/timers:521:7) {
    code: 'ETIMEDOUT',
    [errors]: [ [Error], [Error] ]
  }
}

Channel health:
  - slack: Slack channel is disabled in config.
    updated: 2026-04-14T07:45:07.707Z
  - telegram: Telegram polling connected for 1 account(s).
    updated: 2026-04-14T07:45:10.113Z
    instances: default bot=@longluong2bot token#c56b9033
```

Problems to address:

- Raw tail is useful, but the operator gets no framing.
- There is no quick signal for whether the errors are recent, repeated, or likely channel-specific.
- `Channel health` is valuable, but arrives after the noise instead of framing it.

Proposed output:

```text
clisbot logs --lines 20

Recent log summary:
  Recent errors detected: yes
  Likely affected channel: telegram
  Slack status: disabled in config
  Telegram status: connected

Last 20 log lines from:
  /home/node/.clisbot/state/clisbot.log

[errors]: [ [Error], [Error] ]
...
telegram typing failed TypeError: fetch failed
...

Channel health:
  - slack: disabled in config
  - telegram: polling connected for 1 account
    instance: default bot=@longluong2bot token#c56b9033
```

Why this proposed version is better:

- It preserves the raw tail.
- It gives the operator immediate triage context.
- It reduces the chance that a user stares at stack trace noise without knowing what matters.

### 6. `pairing`

Command:

```bash
bun run src/main.ts pairing
```

Current output:

```text
error Usage: pairing list <channel> [--json] | pairing approve <channel> <code>
Help: clisbot --help
Docs: docs/user-guide/README.md
If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.
```

Problems to address:

- Syntax is shown, but task intent is not.
- A new operator may not know whether they should use `list` or `approve` next.

Proposed output:

```text
Usage:
  clisbot pairing list <telegram|slack> [--json]
  clisbot pairing approve <telegram|slack> <code>

Common flow:
  1. Ask the user to DM the bot and get a pairing code
  2. Run `clisbot pairing list <channel>` if you want to inspect pending requests
  3. Run `clisbot pairing approve <channel> <code>` to approve one

Docs:
  docs/user-guide/README.md
```

Why this proposed version is better:

- It explains intent, not just grammar.
- It keeps the surface short.
- It directly supports the onboarding flow used in the guides.

### 7. `channels add ...` Usage Errors

Commands:

```bash
bun run src/main.ts channels add telegram-group
bun run src/main.ts channels add slack-channel
bun run src/main.ts channels add slack-group
```

Current output:

```text
error Usage: clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]
Help: clisbot --help
Docs: docs/user-guide/README.md
If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.

error Usage: clisbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]
Help: clisbot --help
Docs: docs/user-guide/README.md
If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.

error Usage: clisbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]
Help: clisbot --help
Docs: docs/user-guide/README.md
If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.
```

Problems to address:

- The current output is short and consistent.
- The missing piece is a realistic example.
- This is especially important because `chatId`, `channelId`, and `groupId` are not self-explanatory for first-time operators.

Proposed output:

```text
Missing required argument.

Usage:
  clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]

Examples:
  clisbot channels add telegram-group -1001234567890
  clisbot channels add telegram-group -1001234567890 --topic 42 --agent default

Tip:
  Use `/whoami` in the Telegram group or topic to get `chatId` and `topicId`.

Docs:
  docs/user-guide/telegram-setup.md
```

```text
Missing required argument.

Usage:
  clisbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]

Example:
  clisbot channels add slack-channel C0123456789 --agent default

Tip:
  Copy the channel ID from the Slack conversation link.

Docs:
  docs/user-guide/slack-setup.md
```

```text
Missing required argument.

Usage:
  clisbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]

Example:
  clisbot channels add slack-group G0123456789 --agent default

Tip:
  Use the private group conversation link to find the group ID.

Docs:
  docs/user-guide/slack-setup.md
```

Why this proposed version is better:

- It keeps the short error shape.
- It adds one likely-successful example per route type.
- It links directly to the right guide instead of only the generic guide index.

## Remaining Operator-Facing Surfaces

### `channels --help`

Command:

```bash
bun run src/main.ts channels --help
```

Current output highlights:

```text
clisbot channels

Usage:
  clisbot channels
  clisbot channels --help
  clisbot channels enable <slack|telegram>
  clisbot channels disable <slack|telegram>
  clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]
  clisbot channels remove telegram-group <chatId> [--topic <topicId>]
  clisbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]
  clisbot channels remove slack-channel <channelId>
  clisbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]
  clisbot channels remove slack-group <groupId>
  clisbot channels privilege <enable|disable|allow-user|remove-user> <target> ...
  clisbot channels response-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]
  clisbot channels response-mode set <capture-pane|message-tool> --channel <slack|telegram> [--target <target>] [--topic <topicId>]
  clisbot channels additional-message-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]
  clisbot channels additional-message-mode set <queue|steer> --channel <slack|telegram> [--target <target>] [--topic <topicId>]
  clisbot channels set-token <slack-app|slack-bot|telegram-bot> <value>
  clisbot channels clear-token <slack-app|slack-bot|telegram-bot>
...
```

Problems to address:

- This screen is acting as syntax reference, policy guide, onboarding helper, pairing helper, privilege guide, and tmux debug guide at the same time.
- The content quality is not the issue.
- The issue is that too many modes of information are mixed into one surface.

Proposed output:

```text
clisbot channels

Most used commands:
  clisbot channels enable <slack|telegram>
  clisbot channels disable <slack|telegram>
  clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>]
  clisbot channels add slack-channel <channelId> [--agent <id>]
  clisbot channels add slack-group <groupId> [--agent <id>]
  clisbot channels remove telegram-group <chatId> [--topic <topicId>]
  clisbot channels remove slack-channel <channelId>
  clisbot channels remove slack-group <groupId>

Delivery controls:
  clisbot channels response-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]
  clisbot channels response-mode set <capture-pane|message-tool> --channel <slack|telegram> [--target <target>] [--topic <topicId>]
  clisbot channels additional-message-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]
  clisbot channels additional-message-mode set <queue|steer> --channel <slack|telegram> [--target <target>] [--topic <topicId>]

Token commands:
  clisbot channels set-token <slack-app|slack-bot|telegram-bot> <value>
  clisbot channels clear-token <slack-app|slack-bot|telegram-bot>

Discovery tips:
  Telegram: use `/whoami` in the target group or topic
  Slack: copy the ID from the conversation link

See also:
  clisbot status
  clisbot pairing --help
  docs/user-guide/telegram-setup.md
  docs/user-guide/slack-setup.md

Advanced help:
  clisbot channels privilege --help
```

Why this proposed version is better:

- It separates the common route-management path from advanced material.
- It keeps the screen scannable.
- It moves toward a layered help system instead of one mega-screen.

### `accounts --help`

Command:

```bash
bun run src/main.ts accounts --help
```

Current output:

```text
clisbot accounts

Usage:
  clisbot accounts --help
  clisbot accounts add telegram --account <id> --token <ENV_NAME|${ENV_NAME}|literal> [--persist]
  clisbot accounts add slack --account <id> --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]
  clisbot accounts persist --channel <slack|telegram> --account <id>
  clisbot accounts persist --all
```

Problems to address:

- This is clean, but too thin.
- It teaches syntax without clarifying the operator decision behind each command.

Proposed output:

```text
clisbot accounts

Usage:
  clisbot accounts add telegram --account <id> --token <ENV_NAME|${ENV_NAME}|literal> [--persist]
  clisbot accounts add slack --account <id> --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]
  clisbot accounts persist --channel <slack|telegram> --account <id>
  clisbot accounts persist --all

What these commands do:
  add         add an account now; if runtime is already running, the account can be used immediately
  --persist   save a literal token for later restarts
  persist     convert temporary runtime-only credentials into persisted credentials

Examples:
  clisbot accounts add telegram --account marketing --token TELEGRAM_BOT_TOKEN
  clisbot accounts add slack --account support --app-token SLACK_APP_TOKEN --bot-token SLACK_BOT_TOKEN --persist
```

Why this proposed version is better:

- It keeps the surface short.
- It explains the operator decision, not just the syntax.
- It reduces confusion around `add` versus `persist`.

### `loops --help`

Command:

```bash
bun run src/main.ts loops --help
```

Current output:

```text
clisbot loops

Usage:
  clisbot loops
  clisbot loops --help
  clisbot loops list
  clisbot loops status
  clisbot loops cancel <id>
  clisbot loops cancel --all

Behavior:
  - `list` and `status` are aliases that render the same global loop inventory
  - this CLI manages only persisted recurring loops created earlier through channel `/loop` commands
  - it does not create new loops
  - `cancel --all` cancels every persisted loop across the whole app
  - when runtime is already running, cancelled loops are suppressed before their next scheduled tick
```

Problems to address:

- This is already one of the strongest surfaces in the audit.
- The only missing piece is a quick example.

Proposed output:

```text
clisbot loops

Usage:
  clisbot loops list
  clisbot loops status
  clisbot loops cancel <id>
  clisbot loops cancel --all

Behavior:
  list and status show the same persisted loop inventory
  this CLI only manages loops that were created earlier through `/loop`
  it does not create new loops

Examples:
  clisbot loops list
  clisbot loops cancel loop_123
```

Why this proposed version is better:

- It keeps what already works.
- It trims repetition.
- It adds one example without bloating the screen.

### `message --help`

Command:

```bash
bun run src/main.ts message --help
```

Current output:

```text
clisbot message

Usage:
  clisbot message send --channel <slack|telegram> --target <dest> --message <text> [--account <id>] [--media <path-or-url>] [--reply-to <id>] [--thread-id <id>] [--force-document] [--silent] [--progress|--final]
  clisbot message poll --channel <slack|telegram> --target <dest> --poll-question <text> --poll-option <value> [--poll-option <value>] [--account <id>] [--thread-id <id>] [--silent]
  clisbot message react --channel <slack|telegram> --target <dest> --message-id <id> --emoji <emoji> [--account <id>] [--remove]
  clisbot message reactions --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]
  clisbot message read --channel <slack|telegram> --target <dest> [--account <id>] [--limit <n>]
  clisbot message edit --channel <slack|telegram> --target <dest> --message-id <id> --message <text> [--account <id>]
  clisbot message delete --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]
  clisbot message pin --channel <slack|telegram> --target <dest> --message-id <id> [--account <id>]
  clisbot message unpin --channel <slack|telegram> --target <dest> [--message-id <id>] [--account <id>]
  clisbot message pins --channel <slack|telegram> --target <dest> [--account <id>]
  clisbot message search --channel <slack|telegram> --target <dest> --query <text> [--account <id>] [--limit <n>]
```

Problems to address:

- The surface is broad but underspecified.
- `target`, `reply-to`, `thread-id`, `--progress`, and `--final` all need a little more operator guidance.

Proposed output:

```text
clisbot message

Most used actions:
  send     send a message or media
  read     read recent messages
  react    add or remove a reaction
  edit     edit one message
  delete   delete one message

Usage:
  clisbot message send --channel <slack|telegram> --target <dest> --message <text> [--account <id>] [--media <path-or-url>] [--reply-to <id>] [--thread-id <id>] [--progress|--final]
  clisbot message read --channel <slack|telegram> --target <dest> [--account <id>] [--limit <n>]
  clisbot message react --channel <slack|telegram> --target <dest> --message-id <id> --emoji <emoji> [--account <id>] [--remove]
  ...

Target guide:
  Telegram target: chat id
  Slack target: channel id, group id, or DM id

Reply guide:
  --reply-to   reply to one message
  --thread-id  post into one thread or topic when the channel supports it

Message mode:
  --progress   send a progress-style message
  --final      send a final-style message

Example:
  clisbot message send --channel telegram --target -1001234567890 --thread-id 42 --message "hello"
```

Why this proposed version is better:

- It makes the surface teachable.
- It explains the arguments that are currently easy to misuse.
- It keeps the long reference shape without feeling like a wall.

### `agents list`

Command:

```bash
bun run src/main.ts agents list
```

Current output:

```text
Configured agents:
- default tool=codex workspace=~/.clisbot/workspaces/default responseMode=inherit additionalMessageMode=inherit bootstrap=team-assistant:bootstrapped
```

Problems to address:

- The current line is efficient, but not very readable.
- `inherit` and `bootstrap=...` are meaningful, but dense.

Proposed output:

```text
Configured agents:

- default
  tool: codex
  workspace: ~/.clisbot/workspaces/default
  response mode: inherit
  additional message mode: inherit
  bootstrap: team-assistant:bootstrapped
```

Why this proposed version is better:

- It is easier to scan in screenshots and chat pastebacks.
- It trades a little density for a lot more readability.

### `pairing list telegram`

Command:

```bash
bun run src/main.ts pairing list telegram
```

Current output:

```text
No pending telegram pairing requests.
```

Problems to address:

- This is already strong.
- The only possible improvement is a next step for empty state.

Proposed output:

```text
No pending Telegram pairing requests.

To generate one:
  send `hi` or `/start` to the Telegram bot from a DM
```

Why this proposed version is better:

- It preserves the good empty state.
- It turns empty state into a usable next action.

### `version`

Command:

```bash
bun run src/main.ts version
```

Current output:

```text
0.1.14
```

Problems to address:

- Minimal is fine here.
- The only issue is screenshot and support clarity.

Proposed output:

```text
clisbot v0.1.14
```

Why this proposed version is better:

- It is still minimal.
- It is more self-explanatory when copied out of context.

## Cross-Cutting Recommendations

### 1. Prefer plain-language outcome lines first

Examples:

- `No channel was selected for first-time setup`
- `Initialization did not finish because no channel was selected`
- `Slack is disabled in config`

This matters because the user first wants diagnosis, not architecture.

### 2. Keep internal terms out of top-of-funnel surfaces

Terms like these are valuable, but should usually appear lower or in advanced output:

- `credentialType=mem`
- `bootstrap=team-assistant:bootstrapped`
- `responseMode=inherit`
- `additionalMessageMode=inherit`

### 3. Separate summary from detail

This matters most for:

- `status`
- `logs`
- `channels --help`

The right pattern is usually:

1. outcome summary
2. next action
3. detailed truth

### 4. Add one likely-successful example anywhere syntax alone is not enough

This matters most for:

- `channels add ...`
- `message --help`
- `pairing`
- `accounts --help`

## Gaps In This Audit

- `stop`, `stop --hard`, and `restart` were intentionally not live-run in this pass.
- This document focuses on operator CLI output, not chat-surface slash command output.
- Some captured output is environment-specific, especially `status` and `logs`.
- The CLI output for successful `channels add ...` flows is still worth a second pass, because this draft currently covers the usage-error path only.

## Recommended Next Review Pass

The next pass should focus on:

1. successful onboarding flows end to end
2. examples-heavy help output for `channels` and `message`
3. a two-layer `status` surface with summary first and operator detail second
4. aligning `start` and `init` failure copy so they are similar but not semantically sloppy

## Bottom Line

The current CLI output is already strong on truthfulness and operator power.

The main product gap is not missing information.

The main gap is presentation discipline:

- better hierarchy
- fewer internal terms in onboarding copy
- stronger next-step guidance
- more examples where syntax alone is not enough
