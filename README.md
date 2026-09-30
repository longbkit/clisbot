<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Clisbot logo">
</p>

<h1 align="center">Clisbot</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/longbkit/clisbot/stargazers">
    <img src="https://img.shields.io/github/stars/longbkit/clisbot?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/longbkit/clisbot/releases">
    <img src="https://img.shields.io/github/v/release/longbkit/clisbot?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://discord.gg/awGmcmFXC">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, and Pi agents.</p>

<p align="center">
  <img src="https://clisbot.com/hero-mockup.png" alt="Clisbot app screenshot" width="100%">
</p>

<p align="center">
  <img src="https://clisbot.com/mobile-mockup.png" alt="Clisbot mobile app" width="100%">
</p>

Run agents in parallel on your own machines. Ship from your phone or your desk.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Clisbot doesn't have any telemetry, tracking, or forced log-ins.

## Plugins

Add themes, workspace panels, commands, settings screens, and coding-agent providers with trusted
TypeScript plugins. Install from npm, Git, or a local directory with `clisbot plugin install <source>`.

Start with the [plugin quickstart](https://clisbot.com/docs/plugins). Plugins run with access to your daemon
machine and inside connected clients; install only code you trust.

## Getting Started

Clisbot runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Desktop app (recommended)

Download it from [clisbot.com/download](https://clisbot.com/download) or the [GitHub releases page](https://github.com/longbkit/clisbot/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### CLI / headless

Install the CLI and start Clisbot:

```bash
npm install -g @clisbot/cli
clisbot
```

Clisbot starts locally, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. This path is useful for servers and remote machines.

For full setup and configuration, see:

- [Docs](https://clisbot.com/docs)
- [Connectivity guide](https://clisbot.com/docs/connectivity)
- [Configuration reference](https://clisbot.com/docs/configuration)

### Docker

Run the Clisbot daemon and self-hosted web UI in Docker:

```bash
docker run -d --name clisbot \
  -p 6767:6767 \
  -e CLISBOT_PASSWORD=change-me \
  -v "$PWD/clisbot-home:/home/clisbot" \
  -v "$PWD:/workspace" \
  ghcr.io/longbkit/clisbot:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/clisbot` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
clisbot run --provider claude/opus-4.6 "implement user authentication"
clisbot run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

clisbot ls                           # list running agents
clisbot attach abc123                # stream live output
clisbot send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
clisbot run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](https://clisbot.com/docs/cli) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@clisbot/client`:

```ts
import { createClisbotClient } from "@clisbot/client";

const client = createClisbotClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](https://clisbot.com/docs/sdk/quickstart), [recipes](https://clisbot.com/docs/sdk/recipes), and [API reference](https://clisbot.com/docs/sdk/reference).

## Skills

Skills teach your agent to use Clisbot to orchestrate other agents.

```bash
npx skills add longbkit/clisbot
```

Then use them in any agent conversation:

- `/clisbot-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/clisbot-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/clisbot-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Clisbot daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `clisbot` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Marketing site and documentation (`clisbot.com`)

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## Sponsors

Sponsorship options for Clisbot are being set up. Check back here when they are ready.

<!-- Sponsor logos go here, in the same order as packages/website/src/data/sponsors.ts -->

## Related projects

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — official distributed relay, written in Elixir
- [clisbot-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.clisbot-vscode) — VS Code extension

## License

Apache-2.0
