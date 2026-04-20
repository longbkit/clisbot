# clisbot - Turn your favorite coding CLI into an agentic personal assistant, workplace assistant, coding partner - on the go
Want to use OpenClaw but are struggling because:

- API cost is too high, so you end up looking for LLM proxy workarounds
- you have to switch between OpenClaw for daily work and Claude / Codex / Gemini for real coding
- you want to code on the go and work on the go

`clisbot` is the right solution for you.

`clisbot` turns native frontier agent CLIs like Claude Code, Codex, and Gemini CLI into durable Slack and Telegram bots. Each agent runs inside its own tmux session, keeps a real workspace, and can behave like a coding bot, a daily-work assistant, or a team assistant with SOUL, IDENTITY, and MEMORY.

It is not just a tmux bridge with chat glued on top. `clisbot` treats Slack and Telegram as real channel surfaces with routing, durable conversation state, pairing, follow-up control, file sending and receiving, and the ability to keep frontier coding agents inside the tools and communication surfaces where teams already work.

`clisbot` is also meant to grow into a reusable agent runtime layer that can support many CLI tools, many channels, and many workflow shapes on top of the same durable agent session.

## Why I Built This

I’m Long Luong (Long), Co-founder & CTO of Vexere, Vietnam’s #1 transportation booking platform, where we also build SaaS and inventory distribution infrastructure for transportation operators. As we scale a 300-person company with a 100-member Engineering, Product, and Design team, I’ve been searching for the most practical way to roll out AI-native workflows across the organization.

The challenge is not whether AI is useful. It is how to make it work at enterprise scale without creating a fragmented, expensive, or ungovernable stack. In practice, that means solving several hard problems at once: cost control, workflow truthfulness, team accessibility, governance, and the ability to bring frontier AI into the real tools and communication surfaces where work already happens.

`clisbot` is the approach I landed on. Instead of building yet another isolated AI layer, it turns the coding CLIs we already trust into durable, chat-native agents that can work across Slack, Telegram, and real team workflows.

## Why clisbot

- One frontier-agent stack for both daily work and real coding. You do not need one product for assistant work and another for actual engineering work.
- Reuses native CLI subscriptions you already pay for, such as Claude Code, Codex, and Gemini CLI, instead of pushing you toward a separate API-cost-heavy stack.
- Learns from and integrates the two biggest strengths that made OpenClaw popular: memory and native channel integration with deep, channel-specific conversation and presentation capabilities.
- Not just a tmux bridge. Slack and Telegram are treated as real channel surfaces with routing, thread or topic continuity, pairing, follow-up control, and attachment-aware interaction instead of plain text passthrough so you can work from your laptop or on the go without giving up a real coding workspace.
- Team-first by design, with `AGENTS`, `USER`, and `MEMORY` context bootstrapping shaped for shared team reality instead of only personal solo-assistant flows.
- Useful for coding, operations, teamwork, and general assistant work, with fast chat controls such as `!<command>` and `/bash <command>` for terminal-like control, `/loop` to bring loop-style automation beyond Claude, `/queue` to add follow-up prompts in the same session without interrupting the current run, `/streaming on` to view real-time processing progress for coding tasks, and `/mention`, `/mention channel`, or `/mention all` to tighten follow-up policy at conversation, route, or bot scope.

## What to expect

- You can get the first Telegram bot or Slack bot running in one command.
- The first-run path creates one default agent and only enables the channels you explicitly name.
- DMs start with pairing so access stays explicit.
- `--persist` lets later restarts use plain `clisbot start`.
- Streaming is disabled by default. If you want real-time coding progress in chat, turn it on from the chat surface with `/streaming on`, and turn it off any time with `/streaming off`.
- Slack and Telegram are not treated as plain-text sinks: routed conversations can carry thread or topic identity, pairing, and file-aware workflows.
- Advanced multi-agent setup is available later, but it is not required for day one.

## CLI Compatibility Snapshot

`clisbot` currently works best with `codex`.

`claude` and `gemini` are both usable, but they need a bit more operator awareness today.

| CLI      | Current Stability   | Short Take                                                                                                  |
| ----------| ---------------------| -------------------------------------------------------------------------------------------------------------|
| `codex`  | Best today          | Strongest default for routed coding work.                                                                   |
| `claude` | Usable with caveats | Claude can surface its own plan-approval and auto-mode behavior even when launched with bypass-permissions. |
| `gemini` | Usable with caveats | Runner support is solid, but auth/setup gating and routed reply behavior still need more care.              |

CLI-specific operator notes:

- [Codex CLI Guide](docs/user-guide/codex-cli.md)
- [Claude CLI Guide](docs/user-guide/claude-cli.md)
- [Gemini CLI Guide](docs/user-guide/gemini-cli.md)

## Quick Start

Platform support:

- Linux and macOS are the supported host environments today.
- Native Windows is not supported yet because `clisbot` currently depends on `tmux` and Bash-based runtime flows.
- If you use Windows, run `clisbot` inside WSL2.

Most people should start here:

```bash
npm install -g clisbot
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

If you want to try first without persisting the token yet, just remove `--persist`.

Next steps:

- For security, just as openclaw, direct message with the bot currently requires pairing and groups need explicit specified in allowlist by default.
- However, `clisbot` has smart autopairing feature to help you get started frictionless. Just send direct message to your bot (through telegram or slack) within 30 minutes so you can claim owner role automatically, and use the bot right away without pairing. After this 30 minutes window you need to approve pairing following instructions by the bot in direct message.
- To chat with the bot in a group:
  - telegram: Add bot to group, then use slash command in that group /start, you will be guided with command to add a group. Run that command directly or copy that command and chat directly with the bot in DM to ask it do for you (since you are the owner, you are authorized to run that command). After completed, come back to the group and start talk with the bot. 
  - Notice that group has require mention (or tag the bot) enabled by default to avoid abuse. But it also has smart follow up within 5 minutes by default so you dont need to tag it again. You could change the mode by asking the bot to do for you.
  - If you want stricter mention behavior, use `/mention` for this conversation only, `/mention channel` for the current channel or group default, or `/mention all` for the current bot default.
  - For long running task such as coding, you might want to toggle streaming mode on with slash command inside the chat "/streaming on", check streaming status anytime with "/streaming status". In slack, native slash command is unconventional so you can get around to use slash command with a space prefix such as " /streaming on", or use alias "\streaming on". This is also true for any other slash command supported by `clisbot`. 
  - slack: 
- If you want to add more owner or app admin, grant that principal explicitly with the platform prefix plus the channel-native user id, for example `clisbot auth add-user app --role owner --user telegram:1276408333` or `clisbot auth add-user app --role admin --user slack:U123ABC456`.
- `clisbot auth --help` now covers role scopes, permission sets, and add/remove flows for users and permissions.
- App-level auth and owner-claim semantics in [Authorization And Roles](docs/user-guide/auth-and-roles.md) describe both the current runtime reality and the remaining target-model gaps.

Need the step-by-step setup docs instead of the shortest path?

- Telegram: [Telegram Bot Setup](docs/user-guide/telegram-setup.md)
- Slack: [Slack App Setup](docs/user-guide/slack-setup.md)
- Release notes: [CHANGELOG.md](CHANGELOG.md) and [docs/releases/](docs/releases/README.md)
- Slack app manifest template: [app-manifest.json](templates/slack/default/app-manifest.json)
- Slack app manifest guide: [app-manifest-guide.md](templates/slack/default/app-manifest-guide.md)

What happens next:

- `--bot-type personal` creates one assistant for one human
- `--bot-type team` creates one shared assistant for a team, channel, or group workflow
- literal token input stays in memory unless you also pass `--persist`
- `--persist` promotes the token into the canonical credential file so the next `clisbot start` can reuse it without retyping
- fresh bootstrap only enables the channels you name explicitly
- after the persisted first run, later restarts can use plain `clisbot start`

## Big Upgrades In v0.1.39

- Much better native Slack and Telegram rendering, so replies are easier to read and feel far less like pasted terminal output.
- A much cleaner first-run path, with a clearer bot-first setup story and better setup docs.
- Stronger pairing, auth, and safer shared-channel behavior by default.
- More trustworthy long-running work, with better attach, detach, recovery, and operator visibility.
- Real recurring automation with `/loop`.

Read the full notes here:

- [CHANGELOG.md](CHANGELOG.md)
- [Release Notes Index](docs/releases/README.md)
- [v0.1.39 Release Notes](docs/releases/v0.1.39.md)

If you prefer Slack first:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN
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

Repo-local `bun run start|stop|restart|status|logs|init|pairing` is pinned by `.env` to `CLISBOT_HOME=~/.clisbot-dev`, so local testing does not accidentally reuse your main `~/.clisbot` runtime.

Upgrade note for existing installs:

- `v0.1.39` includes breaking changes in config shape and in the main CLI command surface.
- If you already run an older install, ask Codex or Claude in this repo to update your current config before upgrading.
- The upgrade itself is still simple:

```bash
clisbot stop
npm install -g clisbot
clisbot start
clisbot --version
```

First conversation path:

- send a DM to the bot in Slack or Telegram
- if that principal is already app `owner` or app `admin`, pairing is bypassed and the bot should answer normally
- otherwise, `clisbot` defaults DMs to pairing mode and replies with a pairing code plus approval command

Approve it with:

```bash
clisbot pairing approve slack <CODE>
clisbot pairing approve telegram <CODE>
```

Fresh config starts with no configured agents, so first-run `clisbot start` requires both `--cli` and `--bot-type` before it creates the first `default` agent.
Fresh config also starts with no preconfigured Slack channels or Telegram groups or topics. Add those routes manually in `~/.clisbot/clisbot.json`.
`clisbot start` requires explicit channel token input before it bootstraps anything. You can pass raw values, env names such as `MY_TELEGRAM_BOT_TOKEN`, or placeholders such as `'${MY_TELEGRAM_BOT_TOKEN}'`.
If you want a separate dev instance beside your main bot, see the [Development Guide](docs/development/README.md).

## Showcase

The goal is a real chat-native agent surface, not a terminal transcript mirror: threads, topics, follow-up behavior, and file-aware workflows should feel native to Slack and Telegram.

Slack

![Slack showcase](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/slack-01.jpg)

Telegram

![Telegram topic showcase 1](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-01.jpg)

![Telegram topic showcase 2](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-02.jpg)

![Telegram topic showcase 3](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-03.jpg)

## Important caution

Strong vendor investment in security and safety does not make frontier agentic CLI tools inherently safe. `clisbot` exposes those tools more broadly through chat and workflow surfaces, so you should treat the whole system as high-trust software and use it at your own risk.

## Acknowledgements

`clisbot` would not exist without the ideas, momentum, and practical inspiration created by OpenClaw. Many configuration, routing, and workspace concepts here were learned from studying OpenClaw, then adapted to `clisbot`'s own direction. Respect and thanks to the OpenClaw project and community.

## Setup Guide

The easiest setup flow is still:

1. Install `clisbot`.
2. Run the quick start command above.
3. DM the bot; approve pairing unless that principal is already app `owner` or app `admin`.
4. Only move into advanced config after the first successful run.

If you want the repo-guided setup path:

1. Clone this repo.
2. Open Claude Code, Codex, or Gemini CLI in this repo.
3. Ask it to help you set up `clisbot`.

The docs in this repo are kept current, including the [User Guide](docs/user-guide/README.md), so the agent should have enough context to walk you through setup, configuration, and troubleshooting directly inside the repo.

If you prefer to configure everything yourself:

1. Read the official config template in [config/clisbot.json.template](config/clisbot.json.template).
2. If you need the archived legacy snapshot, compare it with [config/clisbot.json.v0.1.0.template](config/clisbot.json.v0.1.0.template).
3. Copy the official template to `~/.clisbot/clisbot.json` and adjust bots, routes, agents, workspaces, and policies for your environment.
4. Add agents through the CLI so tool defaults, startup options, and bootstrap templates stay consistent.
5. Optionally move stable channel secrets into env vars or canonical credential files after your first successful run.

Channel route setup is manual by design:

- fresh config does not auto-add Slack channels
- fresh config does not auto-add Telegram groups or topics
- add only the exact channel, group, topic, or DM routing you want to expose
- default bot credential setup lives in [docs/user-guide/bots-and-credentials.md](docs/user-guide/bots-and-credentials.md)

Advanced agent management:

- most users should stay on `clisbot start --cli ... --bot-type ...` and let first-run create the default agent
- if you need more than one agent, custom bot defaults, or manual route setup flows, use the `clisbot agents ...`, `clisbot bots ...`, and `clisbot routes ...` commands described in [docs/user-guide/README.md](docs/user-guide/README.md)
- README intentionally keeps that low-level surface out of the main onboarding path because the public first-run model is `--bot-type personal|team`, not internal template-mode naming
- fresh bot config still points at the `default` agent; if your first useful agent uses another id, update the fallback with `clisbot bots set-agent ...` or override it on a route with `clisbot routes set-agent ...`

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
- use this path when you want config to point at env variable names you chose yourself
- keep env export details in [docs/user-guide/bots-and-credentials.md](docs/user-guide/bots-and-credentials.md) instead of front-loading them into quick start

## Troubleshooting

If the quick start does not work, check these in order:

- If setup feels unclear, open Claude Code, Codex, or Gemini CLI in this repo and ask it to help using the local docs.
- If config behavior is confusing, inspect [config/clisbot.json.template](config/clisbot.json.template) first, then compare it with [docs/user-guide/README.md](docs/user-guide/README.md).
- If `clisbot start` says no agents are configured, prefer `clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>`.
- If you want later runs to work with plain `clisbot start`, rerun your successful first-run command with `--persist`.
- If `clisbot start` prints token refs as `missing`, either pass the token explicitly on the command line or switch to env-backed setup described in [docs/user-guide/bots-and-credentials.md](docs/user-guide/bots-and-credentials.md).
- If you use custom env names, pass them explicitly with `--slack-app-token`, `--slack-bot-token`, or `--telegram-bot-token`.
- If `clisbot status` shows `bootstrap=...:missing` or `bootstrap=...:not-bootstrapped`, follow the advanced agent bootstrap steps in [docs/user-guide/README.md](docs/user-guide/README.md).
- If Codex shows `Do you trust the contents of this directory?`, keep `trustWorkspace: true` in clisbot config and also mark the workspace as trusted in `~/.codex/config.toml`, for example:

```toml
[projects."/home/node/.clisbot/workspaces/default"]
trust_level = "trusted"
```

- If that trust screen is still blocking, attach directly and continue from tmux with `tmux -S ~/.clisbot/state/clisbot.sock attach -t agent-default-main`.
- If Gemini startup says it is waiting for manual authorization, authenticate Gemini directly first or provide a headless auth path such as `GEMINI_API_KEY` or Vertex AI credentials; `clisbot` now treats that screen as a startup blocker instead of a healthy ready session.
- If Codex warns that `bubblewrap` is missing on Linux, install `bubblewrap` in the runtime environment.
- If the bot does not answer, check that your shell environment really contains the expected tokens and restart `clisbot` after changing them.
- If runtime startup still fails, run `clisbot logs` and inspect the recent log tail that `clisbot` now prints automatically on startup failure.
- If you need the full command list, run `clisbot --help`.
- If you need step-by-step operator docs, start with [docs/user-guide/README.md](docs/user-guide/README.md).
- If Slack thread behavior feels too eager, use `/followup pause` or `/followup mention-only`.
- If Slack slash commands conflict with Slack-native command handling, add a leading space, for example ` /bash ls -la`.

## Common CLI commands

Most users only need a small set of commands at first:

- `clisbot start`: start the bot runtime and create the default first-run setup when needed.
- `clisbot restart`: restart the runtime cleanly; use this first when the bot stops responding.
- `clisbot stop`: stop the runtime cleanly before upgrades, config changes, or maintenance.
- `clisbot status`: check whether the runtime, channels, and active sessions look healthy.
- `clisbot logs`: inspect recent runtime logs when startup, routing, or replies look wrong.
- `clisbot runner list`: list the live tmux-backed runner sessions and see what is active.
- `clisbot runner watch <session-name>`: live-watch one specific session when debugging a real run.
- `clisbot runner watch --latest`: jump straight into the most recently active session.

Full operator command reference:

- [CLI Commands Guide](docs/user-guide/cli-commands.md)

If you are running from the repo instead of the global package:

- `bun run dev`
- `bun run start`
- `bun run restart`
- `bun run stop`
- `bun run typecheck`
- `bun run test`
- `bun run check`

## In Chat

`clisbot` supports a small set of chat-native commands for thread control and workflow acceleration inside Slack and Telegram.

Native coding-CLI command compatibility:

- `clisbot` only intercepts its own reserved chat commands
- any other native Claude, Codex, or Gemini command text is forwarded to the underlying CLI unchanged
- operator guide: [Native CLI Commands](docs/user-guide/native-cli-commands.md)

Slack note:

- To stop Slack from interpreting a slash command as a native Slack slash command, prefix it with a space.
- Example: ` /bash ls -la`
- Bash shorthand also works: `!ls -la`

Common commands:

- `/start`: show onboarding or route-status help for the current conversation.
- `/help`: show the available clisbot conversation commands.
- `/stop`: interrupt the current running turn.
- `/streaming on`, `/streaming off`, `/streaming status`: turn live progress on when you want to follow long coding work, then turn it back off when you only want final answers; in Slack, use ` /streaming on` or `\streaming on` when Slack grabs the raw slash command.
- `/followup status`, `/followup auto`, `/followup mention-only`, `/followup pause`, `/followup resume`: control whether the bot keeps naturally following the thread, stays quiet, or requires an explicit mention again; fast shorthands include `/mention`, `/pause`, and `/resume`.
- `/queue <message>`: queue the next prompt behind the current run so the bot can finish one thing, then keep going automatically without you babysitting every step.
- `/loop <schedule or count> <message>`: turn one instruction into repeated work, from recurring automation to brute-force progress like `/loop 3 tiếp đi em` when you want the AI to keep pushing instead of stopping early.

Why `/queue` and `/loop` matter:

- `/queue` is a very simple workflow primitive: stack the next prompts now, let the bot run them one by one later.
- `/loop` is the force multiplier: use it for recurring review/reporting, or just to keep the AI moving through multi-step coding work with less laziness and fewer early stops.

Examples:

- `/queue tiếp đi em`
- `/queue code review theo architecture, guideline và fix, test`
- `/loop 3 tiếp đi em`

Detailed slash-command guide:

- [Slash Commands](docs/user-guide/slash-commands.md)

## Docs

- [Overview](docs/overview/README.md)
- [Architecture](docs/architecture/README.md)
- [Development Guide](docs/development/README.md)
- [Feature Tables](docs/features/feature-tables.md)
- [Backlog](docs/tasks/backlog.md)
- [User Guide](docs/user-guide/README.md)

## Roadmap

- Add more native CLIs, starting with a stronger Claude, Codex, and Gemini launch trio.
- Add more channels, starting from Slack and Telegram, then moving toward Zalo and other expansion surfaces.
- Add better workflow building blocks such as heartbeat, cron-style jobs, and stronger loop automation.
- Explore structured output, ACP, and native SDK integrations where they improve truthfulness or operator control.
- Explore more stable native messaging paths beyond tmux-pane capture over time.

## Current Focus

`clisbot` is growing toward a broader agent runtime layer:

- more CLI tool support beyond Claude Code, Codex, and Gemini CLI
- more communication channels beyond Slack and Telegram
- simple workflow building blocks such as cron jobs, heartbeat jobs, and loops
- durable agent sessions, workspaces, follow-up policy, commands, attachments, and operator controls that stay reusable across all those surfaces

tmux is still the current stability boundary. One agent maps to one durable runner session in one workspace, and every CLI, channel, or workflow layer should route onto that durable runtime instead of recreating the agent from scratch.

## Completed

- [x] Multiple Codex, Claude, and Gemini sessions with streaming on/off support.
- [x] Stale tmux session cleanup and session resume.
- [x] OpenClaw-compatible configuration system.
- [x] Slack channel support with streaming and attachments, smart follow mode
- [x] Telegram channel support with streaming and attachments

## AI-Native Workflow

This repo also serves as a small example of an AI-native engineering workflow:

- simple `AGENTS.md` and `CLAUDE.md`-style operating rules
- lessons-learned docs to capture repeated feedback and pitfalls
- architecture docs used as a stable implementation contract
- end-to-end validation expectations to close the feedback loop for AI agents
- workflow docs for shortest-review-first artifacts, repeated review loops, and task-readiness shaping in [docs/workflow/README.md](docs/workflow/README.md)

## Contributing

Merge requests are welcome.

MRs with real tests, screenshots, or recordings of the behavior under test will be merged faster.
