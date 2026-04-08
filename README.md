# muxbot - tmux-based Agentic Coding CLI & chat bot
The cheapest path to high-end agentic AI for teams.

`muxbot` exposes native agentic AI tool CLIs like Claude Code / Codex through chat surfaces, with each agent running inside its own durable tmux session and ready to behave like a real bot, a real assistant - with SOUL & IDENTITY, not just a coding tool.

Agentic AI is powerful, but only with frontier models. OpenClaw took off because people found many ways to access strong frontier models cheaply through subscription-based OAuth. Recent Anthropic enforcement around third-party and proxy-style usage made that risk harder to ignore.

Meanwhile, the strongest agentic coding tools already come from serious enterprise teams with real investment in model quality, security, safety, and operator controls, especially Claude Code, Codex, and Gemini CLI. That naturally leads to a simple question: why not reuse those agents as they already are, keep them alive in tmux, and add communication channels, team workflows, and more toys around them?

The idea has been stuck in my head since Claude Code introduced agent skills back in October 2025, which opened more possibilities for non-developer workers, and the OpenClaw trend recently only made it harder to ignore. Having played around with Anthropic's Agent SDK to address the agentic AI adoption inside my company but somehow it was not working, not stable, not flexible, not fast enough, and the CLI path now looks like the better choice until now. Now feels like the right time to push that idea.

Every company will likely need an OpenClaw-style strategy over time: a personal agentic assistant for each employee, plus shared agents for each team. `muxbot` starts from a team-first angle, with Slack and shared agent workflows as the default center of gravity instead of treating team collaboration as a later add-on. 

## Why muxbot

- Runs native agentic AI coding CLIs in durable tmux sessions
- Optimized for cheap subscription-backed usage with tools like Codex CLI and Claude CLI... A practical response to the reality that high-quality frontier models are expensive and vendor policies can tighten around third-party usage.
- Compatible with OpenClaw-style configuration, commands and some concepts, agent personality for bot usecases, and workspace bootstrap templates, help Openclaw users to quickly get started.
- Team-first by design, with agent bootstrap templates that fit shared team agents as well as personal ones.
- Reuses mature agentic tools such as Claude Code, Codex, and Gemini CLI
- Fits the emerging pattern of one personal assistant per employee and shared assistants per team.
- Useful as a bot for coding, operations, teamwork, and general work in team environment, or on the go
- Strong team support in Slack, with Telegram already supported as another first-class channel.
- Configurable follow-up policy instead of a fixed TTL model, with a 5-minute default window and route-level controls so teams can tune behavior to how they actually work. Smart follow-up controls help avoid unwanted bot interruption in active threads: keep natural continuation when useful, or pause it when you want the bot to stay quiet until explicitly called again.
- Fast operator shortcuts for shell execution: `!<command>` or `/bash <command>`. Turns Slack / Telegram to terminal interface on the go.
- The proof of concept already shows high potential beyond internal coding workflows, including customer chatbot use cases once messaging MCP or CLI-based skills let the agent send messages proactively in a cleaner way.

## Current Focus

`muxbot` is a communication bridge for long-lived AI agents, organized around the repository architecture contract:

- `channels`: Slack, Telegram, and future API-compatible surfaces
- `agent-os`: agents, sessions, workspaces, commands, attachments, and follow-up policy
- `runners`: tmux today, with ACP, SDK, and other execution backends later
- `control`: operator-facing inspection, lifecycle, and debugging flows
- `configuration`: the local control plane that wires the system together

tmux is the current stability boundary. One agent maps to one durable runner session in one workspace, and chat surfaces route conversations onto that runtime instead of trying to recreate it.

## Quick Start

Choose one setup path.

Local repo path:

1. Install dependencies.

```bash
bun install
```

2. Set the required environment variables.

```bash
export SLACK_APP_TOKEN=...
export SLACK_BOT_TOKEN=...
export TELEGRAM_BOT_TOKEN=...
```

3. Start `muxbot` directly.

```bash
bun run start --cli codex --bootstrap personal-assistant
```

Packaged CLI path:

1. Install globally:

```bash
npm install -g muxbot
```

2. Set the required environment variables.

```bash
export SLACK_APP_TOKEN=...
export SLACK_BOT_TOKEN=...
export TELEGRAM_BOT_TOKEN=...
```

3. Start the service directly.

```bash
muxbot start --cli codex --bootstrap personal-assistant
```

If you do not want to install globally, you can also run it directly with `npx`:

```bash
npx muxbot start --cli codex --bootstrap personal-assistant
```

Fresh config now starts with no configured agents, and first-run `muxbot start` requires both `--cli` and `--bootstrap` before it creates the first `default` agent.
Fresh config also starts with no preconfigured Slack channels or Telegram groups/topics. Add those routes manually in `~/.muxbot/muxbot.json`.
`muxbot start` now also requires Slack or Telegram token references before it bootstraps anything. By default it looks for `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, and `TELEGRAM_BOT_TOKEN`, but you can pass custom placeholders such as `--slack-app-token '${CUSTOM_SLACK_APP_TOKEN}'`.
On startup, `muxbot` now prints which token env names it is checking and whether each one is set or missing.

## Setup Guide

The easiest setup flow is:

1. Clone this repo.
2. Open Claude Code or Codex in this repo.
3. Ask it to help you set up `muxbot`.

If you are still unsure which command or bootstrap mode to use, clone `https://github.com/longbkit/muxbot`, open the repo in Codex or Claude Code, and ask directly for setup help.

The docs in this repo are kept current, including the [User Guide](docs/user-guide/README.md), so the agent should have enough context to walk you through setup, configuration, and troubleshooting directly inside the repo.

If you prefer to configure things yourself:

1. Read the full config template in [config/muxbot.json.template](config/muxbot.json.template).
2. Copy it to `~/.muxbot/muxbot.json` and adjust channels, bindings, workspaces, and policies for your environment.
3. Add agents through the CLI so tool defaults, startup options, and bootstrap templates stay consistent.
4. Set the required environment variables in your shell startup file so `muxbot` can read them consistently.

Channel route setup is manual by design:

- fresh config does not auto-add Slack channels
- fresh config does not auto-add Telegram groups or topics
- add only the exact channel, group, topic, or DM routing you want to expose
- default channel account setup lives in [docs/user-guide/channel-accounts.md](docs/user-guide/channel-accounts.md)

Example agent setup:

```bash
muxbot start --cli codex --bootstrap personal-assistant
```

```bash
muxbot agents add claude --cli claude --bootstrap team-assistant --bind telegram
muxbot agents bootstrap claude --mode team-assistant --force
muxbot agents list --bindings
```

Agent setup rules:

- `agents add` requires `--cli` and currently supports `codex` and `claude`.
- `--startup-option` is optional; if omitted, muxbot uses the built-in startup options for the selected CLI.
- `--bootstrap` accepts `personal-assistant` or `team-assistant` and seeds the workspace from `templates/openclaw` plus the selected customized template.
- `personal-assistant` fits one assistant for one human.
- `team-assistant` fits one shared assistant for a team, channel, or group workflow.
- `agents bootstrap <agentId> --mode <personal-assistant|team-assistant>` bootstraps an existing agent workspace using the agent's configured CLI tool.
- bootstrap runs a dry check first; if any template markdown file already exists in the workspace, it stops and asks you to rerun with `--force`.
- Fresh channel config still points at the `default` agent. If your first agent is not named `default`, update `defaultAgentId` and any route `agentId` values in config.

Custom token placeholder setup:

```bash
muxbot start \
  --cli codex \
  --bootstrap personal-assistant \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

- these flags are written into `~/.muxbot/muxbot.json` exactly as provided
- you can pass either `CUSTOM_SLACK_APP_TOKEN` or `'${CUSTOM_SLACK_APP_TOKEN}'`
- `muxbot` does not expand or print the token values during config generation
- use them when your environment variable names differ from `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, or `TELEGRAM_BOT_TOKEN`
- the env var itself still needs a real value in your shell before `muxbot start` can launch

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
# custom names are also valid
export CUSTOM_SLACK_APP_TOKEN=...
export CUSTOM_SLACK_BOT_TOKEN=...
export CUSTOM_TELEGRAM_BOT_TOKEN=...
```

Then reload your shell:

```bash
source ~/.bashrc
```

```bash
source ~/.zshrc
```

## Troubleshooting

- If setup feels unclear, open Claude Code or Codex in this repo and ask it to help using the local docs.
- If you are still in doubt, clone `https://github.com/longbkit/muxbot`, open the repo in Codex or Claude Code, and ask questions about setup or the bootstrap mode choice.
- If config behavior is confusing, inspect [config/muxbot.json.template](config/muxbot.json.template) first, then compare it with [docs/user-guide/README.md](docs/user-guide/README.md).
- If `muxbot start` says no agents are configured, prefer `muxbot start --cli codex --bootstrap personal-assistant`.
- If `muxbot start` says no default tokens were found, set Slack or Telegram tokens first using [docs/user-guide/channel-accounts.md](docs/user-guide/channel-accounts.md).
- If `muxbot start` prints token refs as `missing`, set those exact env vars in `~/.bashrc` or `~/.zshrc`, reload the shell, then start again.
- If you use custom env names, pass them explicitly with `--slack-app-token`, `--slack-bot-token`, or `--telegram-bot-token`.
- If `muxbot status` shows `bootstrap=...:missing`, the workspace is missing the tool-specific bootstrap file or `IDENTITY.md`; run `muxbot agents bootstrap <agentId> --mode <mode>`.
- If `muxbot status` shows `bootstrap=...:not-bootstrapped`, finish the workspace bootstrap by reviewing `BOOTSTRAP.md`, `SOUL.md`, `IDENTITY.md`, and the mode-specific files in that workspace.
- If the bot does not answer, check that your shell environment really contains the expected tokens and restart `muxbot` after changing them.
- If runtime startup still fails, run `muxbot logs` and inspect the recent log tail that `muxbot` now prints automatically on startup failure.
- If you need the full command list, run `muxbot --help`.
- If you need step-by-step operator docs, start with [docs/user-guide/README.md](docs/user-guide/README.md).
- If Slack thread behavior feels too eager, use `/followup pause` or `/followup mention-only`.
- If Slack slash commands conflict with Slack-native command handling, add a leading space, for example ` /bash ls -la`.

## Commands

- `muxbot start`
- `muxbot restart`
- `muxbot stop`
- `muxbot stop --hard`
- `muxbot status`
- `muxbot logs`
- `muxbot channels enable slack`
- `muxbot channels enable telegram`
- `muxbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]`
- `muxbot channels remove telegram-group <chatId> [--topic <topicId>]`
- `muxbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]`
- `muxbot channels remove slack-channel <channelId>`
- `muxbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]`
- `muxbot channels remove slack-group <groupId>`
- `muxbot channels set-token <slack-app|slack-bot|telegram-bot> <value>`
- `muxbot channels clear-token <slack-app|slack-bot|telegram-bot>`
- `muxbot channels privilege enable <target>`
- `muxbot channels privilege disable <target>`
- `muxbot channels privilege allow-user <target> <userId>`
- `muxbot channels privilege remove-user <target> <userId>`
- `muxbot agents list --bindings`
- `muxbot start --cli codex --bootstrap personal-assistant`
- `muxbot agents bootstrap default --mode personal-assistant`
- `muxbot agents bind --agent default --bind telegram`
- `muxbot agents bindings`
- `muxbot --help`
- `bun run dev`
- `bun run start`
- `bun run restart`
- `bun run stop`
- `bun run typecheck`
- `bun run test`
- `bun run check`

## In Chat

`muxbot` supports a small set of chat-native commands for thread control, transcript access, and quick shell execution.

Slack note:

- To stop Slack from interpreting a slash command as a native Slack slash command, prefix it with a space.
- Example: ` /bash ls -la`
- Bash shorthand also works: `!ls -la`

Common commands:

- `/start`: show onboarding or route-status help for the current conversation.
- `/help`: show the available muxbot conversation commands.
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

- enable them per route with `muxbot channels privilege enable ...`
- optionally restrict them to specific users with `muxbot channels privilege allow-user ...`
- DM examples: `muxbot channels privilege enable slack-dm` or `muxbot channels privilege enable telegram-dm`
- use `muxbot channels --help` for the route and privilege command guide

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
