---
title: CLI Output Audit
status: draft
date: 2026-04-14
area: ux
summary: Audit draft for current `clisbot` CLI command output, with emphasis on onboarding-critical commands mentioned in Slack and Telegram setup guides, then the remaining operator-facing CLI surfaces.
---

# CLI Output Audit

## Purpose

This draft is for reviewing current CLI output as a product surface.

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

## Quick Review Takeaways

- `clisbot --help` is strong on completeness, but still dense for a first-time operator.
- first-run failure output is informative, but wording like `explicit channel flags` and `credentialType=mem` is still too internal for top-of-funnel onboarding.
- `clisbot status` is powerful, but the density is high; the first-time user likely needs a simpler “healthy / not healthy / what to do next” layer first.
- `clisbot logs` is pure raw tail output right now. Good for debugging, weak for operator guidance.
- `clisbot channels --help` mixes route setup, privilege help, pairing help, tmux help, and repo help into one long wall. Useful reference, weaker onboarding surface.
- `clisbot accounts --help` is the opposite problem: compact, but too thin to teach intent quickly.
- `clisbot agents` currently defaults to `list`, which is efficient for a power user but not very self-explanatory for a new operator.

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

Commands:
  start              Seed ~/.clisbot/clisbot.json if missing, apply explicit channel-account bootstrap intent, and start clisbot in the background.
  restart            Stop the running clisbot process, then start it again.
  stop               Stop the running clisbot process.
  stop --hard        Stop clisbot and kill all tmux sessions on the configured clisbot socket.
  status             Show runtime process, config, log, and tmux socket status.
  version            Show the installed clisbot version.
  logs               Print the most recent clisbot log lines.
  channels           Manage channel enablement, routes, and token references in config.
                     enable|disable <slack|telegram>
                     add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]
                     remove telegram-group <chatId> [--topic <topicId>]
                     add slack-channel <channelId> [--agent <id>] [--require-mention true|false]
                     remove slack-channel <channelId>
                     add slack-group <groupId> [--agent <id>] [--require-mention true|false]
                     remove slack-group <groupId>
                     set-token <slack-app|slack-bot|telegram-bot> <value>
                     clear-token <slack-app|slack-bot|telegram-bot>
  accounts           Manage Slack and Telegram provider accounts plus persistence state.
                     add telegram --account <id> --token <ENV_NAME|${ENV_NAME}|literal> [--persist]
                     add slack --account <id> --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]
                     persist --channel <slack|telegram> --account <id>
                     persist --all
  loops              Inspect or cancel managed recurring loops persisted by `/loop`.
                     list|status
                     cancel <id>
                     cancel --all
  message            Run provider message actions such as send, react, read, edit, delete, and pins.
  agents             Manage configured agents and top-level bindings.
  pairing            Run the pairing control CLI.
  init               Seed ~/.clisbot/clisbot.json and optionally create the first agent without starting clisbot.
  --version, -v      Show the installed clisbot version.
  --help             Show this help text.

Package usage:
  npx clisbot start
  npm install -g clisbot && clisbot start
  npm install -g clisbot && clis start

More info:
  Docs: docs/user-guide/README.md
  If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.
```

Review notes:

- Strong first impression on scope and seriousness.
- “Fastest start” is good, but the command examples still assume the reader already understands token types and bot type choice.
- The help is mixing first-run onboarding, credential semantics, and full reference in one screen.
- Likely improvement path: keep a short “first 3 minutes” surface first, then move dense rules lower or behind subcommand help.

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
Repo docs path (local or GitHub): docs/user-guide/channel-accounts.md
Slack docs: https://api.slack.com/apps
Telegram docs: https://core.telegram.org/bots#6-botfather
If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.

+---------+
| FAILED  |
+---------+
```

Review notes:

- Good that the command fails early and tells the user what to do next.
- “explicit channel flags” is correct but not plain language.
- `credentialType=mem` is too internal for a first-run failure.
- This output is very close to useful conversion copy, but it still sounds system-facing rather than operator-facing.

### 3. First-Run `init` Failure

Command:

```bash
tmpdir=$(mktemp -d)
CLISBOT_HOME="$tmpdir" CLISBOT_CONFIG_PATH="$tmpdir/clisbot.json" bun run src/main.ts init --cli codex --bot-type personal
```

Current output:
