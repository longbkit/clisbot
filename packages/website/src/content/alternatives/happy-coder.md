---
title: Happy Coder Alternative With Worktrees and Multi-Provider Support
description: Clisbot adds managed worktrees, native clients across desktop and mobile, and extensible daemon and client surfaces to a remote coding-agent workflow.
nav: Happy Coder
order: 53
---

# Clisbot vs Happy Coder

Happy Coder connects Claude Code and Codex sessions across its macOS, web, iOS, and Android apps. It wraps the agent CLI on your laptop and syncs sessions over an end-to-end encrypted relay. Open source under MIT.

Clisbot is an app for orchestrating coding agents, with native clients on desktop, mobile, web, and the CLI. Open source (Apache-2.0).

![Clisbot desktop and mobile app](/hero-mockup.png)

## The main difference

Happy Coder focuses on connecting Claude Code and Codex sessions to its mobile, web, and macOS clients through an end-to-end encrypted relay.

Clisbot supports the same two providers alongside OpenCode, Pi, ACP agents, and custom providers. It also manages workspaces, worktrees, services, pull-request review, and application plugins through the same daemon.

## Architecture

Clisbot runs the agent inside its own daemon. The daemon owns the agent lifecycle, the worktree, and the dev servers. Clients connect over a websocket and drive the daemon.

Happy Coder runs the agent through its CLI on your laptop and syncs the session to its desktop, mobile, and web clients through an end-to-end encrypted relay.

## Panes

Clisbot's app has split panes and tabs (⌘D for vertical, ⌘⇧D for horizontal). Panes include a terminal alongside your agents, a diff viewer, and a browser for testing running services.

Happy Coder's macOS app places conversations beside files, diffs, terminals, and previews.

## GitHub

Clisbot's app handles commit, push, opening PRs, watching checks and reviews, and merging.

## Mobile

The mobile app is the full app, native on iOS and Android, with full feature parity with desktop. Happy Coder also ships native iOS and Android apps.

## Providers

Clisbot runs Claude Code, Codex, OpenCode, Pi, Antigravity, and Muse Code natively, plus 30+ more agents through the in-app catalog including GitHub Copilot, Cursor, Gemini CLI, and Amp. Clisbot speaks the [Agent Client Protocol](https://agentclientprotocol.com), so any ACP agent works. Custom providers run any CLI agent. See [all supported providers](/agents).

Happy Coder runs Claude Code and Codex.

## Application plugins

[Clisbot plugins](/docs/plugins) extend Clisbot itself. They can add server behavior and native client components such as workspace panels, sidebar items, composer attachments, themes, and Command Center items across desktop, browser, iOS, and Android.

Happy Coder does not document an application extension API for adding both server behavior and native client components.

## Worktrees and services

Clisbot runs each agent in its own git worktree. Each worktree gets its own dev server URL like `web--fix-auth--my-app.localhost`, so parallel agents don't fight for the same port.

Happy Coder can start an agent in a selected machine path, including an existing Git worktree. It does not currently create or manage the worktree lifecycle.

## CLI

Clisbot has a CLI that mirrors the app:

```bash
clisbot run --provider codex "implement OAuth"
clisbot run --host devbox:6767 "run the test suite"
clisbot ls
clisbot send <agent-id> "add tests"
clisbot schedule create --cron "0 9 * * 1" "audit the codebase"
```

`clisbot run --host` connects to a remote daemon. `clisbot schedule` runs an agent on a cron.

Happy Coder has CLIs for launching wrapped sessions and for creating, sending to, monitoring, and stopping remote sessions. It does not document schedules or loops.

## Voice

Both products support voice interaction. Clisbot can run speech-to-text and text-to-speech locally on the device.

## Comparison

|                              | Clisbot                                                                                            | Happy Coder                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| License                      | Open source (Apache-2.0)                                                                           | Open source (MIT)                               |
| Account required             | No                                                                                                 | -                                               |
| Desktop app                  | Yes (one click install, daemon bundled)                                                            | Yes (macOS)                                     |
| Mobile app                   | Yes (native, full parity with desktop)                                                             | Yes (native)                                    |
| CLI                          | Yes (everything the app does)                                                                      | Yes (launch and control sessions)               |
| Remote machines              | Yes (install the daemon anywhere)                                                                  | -                                               |
| Built-in relay               | Yes (opt-in, end-to-end encrypted, no account)                                                     | Yes (end-to-end encrypted)                      |
| Direct network access        | Yes (LAN, Tailscale, VPN)                                                                          | -                                               |
| SSH access                   | Yes                                                                                                | -                                               |
| Providers                    | Claude Code, Codex, OpenCode, Pi, Antigravity, Muse Code, 30+ more                                 | Claude Code, Codex                              |
| Parallel agents              | Yes (isolated worktrees, across machines)                                                          | Existing worktree paths, no worktree management |
| Terminal agents              | Yes (run any agent in a terminal, get notified when it finishes)                                   | Yes (wraps the agent CLI)                       |
| Agent orchestration          | Yes (agents create worktrees and launch other agents, across providers)                            | -                                               |
| Editor                       | Yes                                                                                                | -                                               |
| Terminals                    | Yes                                                                                                | Yes                                             |
| Diff review                  | Yes (comments go to the agent)                                                                     | Yes                                             |
| Pull requests in app         | GitHub, GitLab, Gitea, Forgejo, Codeberg                                                           | -                                               |
| In-app browser               | Yes (element picker, agent browser tools)                                                          | Yes (previews)                                  |
| Per-worktree dev server URLs | Yes (`web--fix-auth--my-app.localhost`)                                                            | -                                               |
| Schedules and heartbeats     | Yes                                                                                                | -                                               |
| Plan usage                   | Yes                                                                                                | -                                               |
| Plugins                      | Yes (new screens, panels, agent hooks, and providers, one plugin runs on desktop, web, and mobile) | No                                              |
| Voice                        | Yes (local dictation, realtime voice)                                                              | Yes                                             |
| Telemetry                    | None                                                                                               | -                                               |

See also: [Clisbot vs Conductor](/alternatives/conductor), [Clisbot vs Superset](/alternatives/superset), [Clisbot vs OpenChamber](/alternatives/openchamber).
