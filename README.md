# clisbot - Agentic Coding CLI & chat bot
The cheapest, simplest path to frontier LLMs and agentic CLI workflows for teams and individuals.

`clisbot` exposes native agentic AI tool CLIs like Claude Code / Codex through multi-channel chat surfaces, with each agent running inside its own durable tmux session and ready to behave like a real bot, a real assistant - with SOUL, IDENTITY & MEMORY, not just a coding tool.

It is not just another tmux bridge or Telegram bridge. `clisbot` is meant to grow into a reusable agent runtime layer that can support many CLI tools, many channels, and many workflow shapes on top of the same durable agent session.

Agentic AI is powerful, but only with frontier models. OpenClaw took off because people found many ways to access strong frontier models cheaply through subscription-based OAuth. Recent Anthropic enforcement around third-party and proxy-style usage made that risk harder to ignore.

Meanwhile, the strongest agentic coding tools already come from serious enterprise teams with real investment in model quality, security, safety, and operator controls, especially Claude Code, Codex, and Gemini CLI. That naturally leads to a simple question: why not reuse those agents as they already are, keep them alive in tmux, and add communication channels, team workflows, and more toys around them?

Every company will likely need an OpenClaw-style strategy over time: a personal agentic assistant for each employee, plus shared agents for each team. `clisbot` starts from a team-first angle, with Slack and shared agent workflows as the default center of gravity instead of treating team collaboration as a later add-on. 

## Important caution

Strong vendor investment in security and safety does not make frontier agentic CLI tools inherently safe. `clisbot` exposes those tools more broadly through chat and workflow surfaces, so you should treat the whole system as high-trust software and use it at your own risk.

## Acknowledgements

`clisbot` would not exist without the ideas, momentum, and practical inspiration created by OpenClaw. Many configuration, routing, and workspace concepts here were learned from studying OpenClaw, then adapted to `clisbot`'s own direction. Respect and thanks to the OpenClaw project and community.

## Why clisbot

- Reuses the native CLI tools you already know and subscribe to, such as Claude Code, Codex, and Gemini CLI, then extends them across coding, chatbot, and non-dev workflows without forcing you to switch tools.
- Optimized for cheap subscription-backed usage with tools like Codex CLI and Claude CLI... A practical response to the reality that high-quality frontier models are expensive and vendor policies can tighten around third-party usage.
- Compatible with OpenClaw-style configuration, commands and some concepts, agent personality for bot usecases, and workspace bootstrap templates, help Openclaw users to quickly get started.
- Team-first by design, with agent bootstrap templates that fit shared team agents as well as personal ones.
- Fits the emerging pattern of one personal assistant per employee and shared assistants per team.
- Useful as a bot for coding, operations, teamwork, and general work in team environment, or on the go
- Strong team support in Slack, with Telegram already supported as another first-class channel.
- Configurable follow-up policy instead of a fixed TTL model, with a 5-minute default window and route-level controls so teams can tune behavior to how they actually work. Smart follow-up controls help avoid unwanted bot interruption in active threads: keep natural continuation when useful, or pause it when you want the bot to stay quiet until explicitly called again.
- Fast operator shortcuts for shell execution: `!<command>` or `/bash <command>`, plus slash-prefix mappings such as `\bash` or `::bash` when Slack slash-command handling is incompatible. Turns Slack / Telegram into a terminal interface on the go.
- The proof of concept already shows high potential beyond internal coding workflows, including customer chatbot use cases once messaging MCP or CLI-based skills let the agent send messages proactively in a cleaner way.

## Current Focus

`clisbot` is growing toward a broader agent runtime layer:

- more CLI tool support beyond Claude Code and Codex, including Gemini CLI, OpenCode, Qwen, Kilo, and other agentic CLIs
- more communication channels beyond Slack and Telegram, including Zalo, WhatsApp, Facebook, Discord, and future API-compatible surfaces
- simple workflow building blocks such as cronjobs, heartbeat jobs, lightweight Ralph-style loops, and prompt combinations that just work
- durable agent sessions, workspaces, follow-up policy, commands, attachments, and operator controls that stay reusable across all those surfaces

tmux is still the current stability boundary. One agent maps to one durable runner session in one workspace, and every CLI, channel, or workflow layer should route onto that durable runtime instead of recreating the agent from scratch.

## Launch MVP Path

See [docs/overview/launch-mvp-path.md](docs/overview/launch-mvp-path.md) for the full current launch order.

Short snapshot:

1. Foundations first:
   - frictionless start and credential persistence
   - runtime stability and truthful status or debug UX
   - `/loop` as the current differentiating workflow feature
2. International launch gate:
   - Claude, Codex, and Gemini as the well-tested core CLI trio
   - current shared channel package remains Slack plus Telegram
3. Vietnam launch package:
   - add Zalo Official Account and Zalo Personal on top of the same core trio
4. Next expansion wave:
   - more CLIs such as Cursor, Amp, OpenCode, Qwen, Kilo, and Minimax, prioritized by real userbase demand
   - more channels such as Discord, WhatsApp, Google Workspace, and Microsoft Teams
5. Open launch decision:
   - whether native CLI slash-command compatibility, override, and customization should ship before broader push

## Showcase

Slack

![Slack showcase](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/slack-01.jpg)

Telegram

![Telegram topic showcase 1](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-01.jpg)

![Telegram topic showcase 2](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-02.jpg)

![Telegram topic showcase 3](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-03.jpg)

## Quick Start

Fastest first-run path for the first Telegram bot:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token>
```

If you want later runs to work with plain `clisbot start`, persist that token immediately:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

What this does:

- `--bot-type personal` creates one assistant for one human
- `--bot-type team` creates one shared assistant for a team, channel, or group workflow
- literal token input stays in memory unless you also pass `--persist`
- `--persist` promotes the token into the canonical credential file so the next `clisbot start` can reuse it without retyping
- fresh bootstrap only enables the channels you name explicitly
- after the persisted first run, later restarts can use plain `clisbot start`

Packaged CLI path:

```bash
npm install -g clisbot
clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

Short alias:

```bash
clis start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>
```

Local repo path:

```bash
bun install
bun run start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

If you prefer Slack first:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN
```

First conversation path:

- send a DM to the bot in Slack or Telegram
- `clisbot` defaults DMs to pairing mode
- the bot replies with a pairing code and approval command

Approve it with:

```bash
clisbot pairing approve slack <CODE>
clisbot pairing approve telegram <CODE>
```

Fresh config starts with no configured agents, so first-run `clisbot start` requires both `--cli` and `--bot-type` before it creates the first `default` agent.
Fresh config also starts with no preconfigured Slack channels or Telegram groups or topics. Add those routes manually in `~/.clisbot/clisbot.json`.
`clisbot start` requires explicit channel token input before it bootstraps anything. You can pass raw values, env names such as `TELEGRAM_BOT_TOKEN`, or placeholders such as `'${CUSTOM_TELEGRAM_BOT_TOKEN}'`.
Set `CLISBOT_HOME` if you want a fully separate local config, state, tmux socket, wrapper, and workspace root, for example when running a dev instance beside your main bot.

## Setup Guide

The easiest setup flow is:

1. Clone this repo.
2. Open Claude Code or Codex in this repo.
3. Ask it to help you set up `clisbot`.

The docs in this repo are kept current, including the [User Guide](docs/user-guide/README.md), so the agent should have enough context to walk you through setup, configuration, and troubleshooting directly inside the repo.

If you prefer to configure things yourself:

1. Read the full config template in [config/clisbot.json.template](config/clisbot.json.template).
2. Copy it to `~/.clisbot/clisbot.json` and adjust channels, bindings, workspaces, and policies for your environment.
3. Add agents through the CLI so tool defaults, startup options, and bootstrap templates stay consistent.
4. Optionally move stable channel secrets into env vars or canonical credential files after your first successful run.

Separate dev home example:

```bash
export CLISBOT_HOME=~/.clisbot-dev
clisbot start --cli codex --bot-type team --telegram-bot-token TELEGRAM_BOT_TOKEN
```

- `CLISBOT_HOME` changes the default config path, runtime state dir, tmux socket, local wrapper path, and default workspaces together
- `CLISBOT_CONFIG_PATH` still works when you want to point at one exact config file manually

Channel route setup is manual by design:

- fresh config does not auto-add Slack channels
- fresh config does not auto-add Telegram groups or topics
- add only the exact channel, group, topic, or DM routing you want to expose
- default channel account setup lives in [docs/user-guide/channel-accounts.md](docs/user-guide/channel-accounts.md)

Example agent setup:

```bash
clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>
```

```bash
clisbot agents add claude --cli claude --bootstrap team-assistant --bind telegram
clisbot agents bootstrap claude --mode team-assistant --force
clisbot agents list --bindings
```

Agent setup rules:

- `agents add` requires `--cli` and currently supports `codex` and `claude`.
- `--bootstrap` accepts `personal-assistant` or `team-assistant` and seeds the workspace from `templates/openclaw`, `templates/customized/default`, and the selected customized template.
- `personal-assistant` fits one assistant for one human.
- `team-assistant` fits one shared assistant for a team, channel, or group workflow.
- `agents bootstrap <agentId> --mode <personal-assistant|team-assistant>` bootstraps an existing agent workspace using the agent's configured CLI tool.
- bootstrap runs a dry check first; if any template markdown file already exists in the workspace, it stops and asks you to rerun with `--force`.
- Fresh channel config still points at the `default` agent. If your first agent is not named `default`, update `defaultAgentId` and any route `agentId` values in config.

Env-backed setup is still supported when you want config to reference an env name instead of persisting a credential file:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

- these flags are written into `~/.clisbot/clisbot.json` as `${ENV_NAME}` placeholders
- you can pass either `CUSTOM_SLACK_APP_TOKEN` or `'${CUSTOM_SLACK_APP_TOKEN}'`
- use this path when your environment variable names differ from `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, or `TELEGRAM_BOT_TOKEN`
- keep env export details in [docs/user-guide/channel-accounts.md](docs/user-guide/channel-accounts.md) instead of front-loading them into quick start

## Troubleshooting

- If setup feels unclear, open Claude Code or Codex in this repo and ask it to help using the local docs.
- If you are still in doubt, clone `https://github.com/longbkit/clisbot`, open the repo in Codex or Claude Code, and ask questions about setup or the bot type choice.
- If config behavior is confusing, inspect [config/clisbot.json.template](config/clisbot.json.template) first, then compare it with [docs/user-guide/README.md](docs/user-guide/README.md).
- If `clisbot start` says no agents are configured, prefer `clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>`.
- If you want later runs to work with plain `clisbot start`, rerun your successful first-run command with `--persist`.
- If `clisbot start` prints token refs as `missing`, either pass the token explicitly on the command line or switch to env-backed setup described in [docs/user-guide/channel-accounts.md](docs/user-guide/channel-accounts.md).
- If you use custom env names, pass them explicitly with `--slack-app-token`, `--slack-bot-token`, or `--telegram-bot-token`.
- If `clisbot status` shows `bootstrap=...:missing`, the workspace is missing the tool-specific bootstrap file or `IDENTITY.md`; run `clisbot agents bootstrap <agentId> --mode <mode>`.
- If `clisbot status` shows `bootstrap=...:not-bootstrapped`, finish the workspace bootstrap by reviewing `BOOTSTRAP.md`, `SOUL.md`, `IDENTITY.md`, and the mode-specific files in that workspace.
- If Codex shows `Do you trust the contents of this directory?`, keep `trustWorkspace: true` in clisbot config and also mark the workspace as trusted in `~/.codex/config.toml`, for example:

```toml
[projects."/home/node/.clisbot/workspaces/default"]
trust_level = "trusted"
```

- If that trust screen is still blocking, attach directly and continue from tmux with `tmux -S ~/.clisbot/state/clisbot.sock attach -t agent-default-main`.
- If Codex warns that `bubblewrap` is missing on Linux, install `bubblewrap` in the runtime environment.
- If the bot does not answer, check that your shell environment really contains the expected tokens and restart `clisbot` after changing them.
- If runtime startup still fails, run `clisbot logs` and inspect the recent log tail that `clisbot` now prints automatically on startup failure.
- If you need the full command list, run `clisbot --help`.
- If you need step-by-step operator docs, start with [docs/user-guide/README.md](docs/user-guide/README.md).
- If Slack thread behavior feels too eager, use `/followup pause` or `/followup mention-only`.
- If Slack slash commands conflict with Slack-native command handling, add a leading space, for example ` /bash ls -la`.

## Commands

- `clisbot start`
- `clisbot restart`
- `clisbot stop`
- `clisbot stop --hard`
- `clisbot status`
- `clisbot logs`
- `clisbot channels enable slack`
- `clisbot channels enable telegram`
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
- `clisbot agents list --bindings`
- `clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist`
- `clisbot agents bootstrap default --mode personal-assistant`
- `clisbot agents bind --agent default --bind telegram`
- `clisbot agents bindings`
- `clisbot --help`
- `bun run dev`
- `bun run start`
- `bun run restart`
- `bun run stop`
- `bun run typecheck`
- `bun run test`
- `bun run check`

## In Chat

`clisbot` supports a small set of chat-native commands for thread control, transcript access, and quick shell execution.

Slack note:

- To stop Slack from interpreting a slash command as a native Slack slash command, prefix it with a space.
- Example: ` /bash ls -la`
- Bash shorthand also works: `!ls -la`

Common commands:

- `/start`: show onboarding or route-status help for the current conversation.
- `/help`: show the available clisbot conversation commands.
- `/status`: show the current route status, follow-up policy, and operator setup hints.
- `/whoami`: show the current sender and route identity for the active conversation.
- `/stop`: interrupt the current running turn.
- `/followup status`: show the current thread follow-up mode.
- `/followup auto`: allow natural in-thread follow-up after the bot has replied.
- `/followup mention-only`: require an explicit mention for later turns in the thread.
- `/followup pause`: pause passive follow-up so the bot does not keep interrupting the thread unless explicitly mentioned again.
- `/followup resume`: restore the default follow-up behavior for that conversation.
- `/transcript`: return the current conversation transcript when privilege commands are enabled on the route.
- `::transcript` or `\transcript`: transcript shortcuts from the default slash-style prefixes.
- `/bash <command>`: run a shell command in the current agent workspace when sensitive commands are enabled.
- `!<command>`: shorthand for `/bash <command>`.

Command prefix defaults:

- slash-style shortcuts: `["::", "\\"]`
- bash shortcuts: `["!"]`
- both are configurable with `channels.slack.commandPrefixes` and `channels.telegram.commandPrefixes`

Sensitive commands are disabled by default:

- enable them per route with `clisbot channels privilege enable ...`
- optionally restrict them to specific users with `clisbot channels privilege allow-user ...`
- DM examples: `clisbot channels privilege enable slack-dm` or `clisbot channels privilege enable telegram-dm`
- use `clisbot channels --help` for the route and privilege command guide

Follow-up behavior matters in team threads:

- `auto` is convenient when a thread is actively collaborating with the bot.
- `pause` is useful when the bot has already participated but you do not want it to keep jumping into every follow-up message.
- `mention-only` is the stricter mode when you want every new bot turn to require an explicit call.

## Docs

- [Overview](docs/overview/README.md)
- [Architecture](docs/architecture/README.md)
- [Feature Tables](docs/features/feature-tables.md)
- [Backlog](docs/tasks/backlog.md)
- [User Guide](docs/user-guide/README.md)

## Roadmap

- Webhook and OpenAI-compatible completion API to integrate with more workflows.
- Heartbeat and cronjob support, with the note that Claude already has a useful cronjob path today through loop-style workflows.
- Autodrive / hardwork mode.
- Support more native CLIs such as Gemini, OpenCode, and others.
- Experiment with json output mode from codex / claude code, Agent Client Protocol and native Codex SDK integration.
- Experiment with native messaging tools so the bot can send Slack or Telegram messages through MCP or CLI-based skills instead of tmux pane capture, for more stable and natural public-facing behavior over time.
- Add more channels on demand.

## Completed

- [x] Multiple Codex and Claude sessions with streaming on/off support.
- [x] Stale tmux session cleanup and session resume.
- [x] OpenClaw-compatible configuration system.
- [x] Slack channel support with streaming and attachments, smart follow mode
- [x] Telegram channel support with streaming and attachments

## AI-Native Workflow

This repo also serves as a small example of an AI-native engineering workflow:

- simple `AGENTS.md` and `CLAUDE.md`-style operating rules, short but addresses some common drawbacks of AI models as of 2026
- lessons-learned docs to capture repeated feedback and pitfalls
- architecture docs used as a stable implementation contract
- end-to-end validation expectations to close the feedback loop for AI agents

## Contributing

Merge requests are welcome.

MRs with real tests, screenshots, or recordings of the behavior under test will be merged faster.
