---
title: Getting started
description: Install Clisbot and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Clisbot runs your coding agents on your machine and gives you a mobile, desktop, web, and CLI client to drive them from anywhere. Three common ways to install.

## Desktop app (recommended)

Download from [clisbot.com/download](https://clisbot.com/download) or the [GitHub releases page](https://github.com/longbkit/clisbot/releases). Open it and you're done.

The desktop app bundles its own daemon and starts it automatically, no separate install required. On first launch you'll see a brief startup screen, then connect from your phone using **Settings → your host → Pair Device**.

### Linux

Use the `.deb` on Debian/Ubuntu or the `.rpm` on Fedora to keep Chromium's sandbox available even when your distribution restricts user namespaces. The installer configures the bundled sandbox helper; you do not need to change system security settings.

For an AppImage, make the download executable and open it:

```bash
chmod +x Clisbot-x86_64.AppImage
./Clisbot-x86_64.AppImage
```

If it reports `error loading libfuse.so.2`, run without FUSE:

```bash
./Clisbot-x86_64.AppImage --appimage-extract-and-run
```

Alternatively, install `libfuse2t64` on Ubuntu 24.04 or newer (`sudo apt install libfuse2t64`), or your distribution's FUSE 2 compatibility package. This dependency belongs to the AppImage runtime, before Clisbot starts.

Clisbot checks sandbox availability each time it launches. AppImage and extracted tar archives retain sandboxing when user namespaces work. On a restricted host without a usable installed helper, they launch with Chromium's sandbox disabled. Prefer the installed package if you require OS process isolation. **Settings → Diagnostics → App Diagnostics** reports the sandbox state and reason; the desktop log records the same decision. An explicit `--no-sandbox` argument overrides the automatic choice.

## Server / CLI

For headless machines, dev boxes, or any setup where you want the daemon running without the desktop UI:

```bash
npm install -g clisbot
clisbot
```

Clisbot starts the daemon locally, then asks whether to enable the end-to-end encrypted relay and print a pairing QR code. If you decline, enter the daemon address manually over TCP, Tailscale, or another VPN.

The daemon can also serve the browser web app itself, so you can use the full UI without the hosted app. See [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `CLISBOT_HOME` (defaults to `~/.clisbot`).

## Docker

For servers, dev boxes, NAS devices, or homelab hosts, run the official image:

```bash
docker run -d --name clisbot \
  -p 6868:6868 \
  -e CLISBOT_PASSWORD=change-me \
  -v "$PWD/clisbot-home:/home/clisbot" \
  -v "$PWD:/workspace" \
  ghcr.io/longbkit/clisbot:latest
```

Then open `http://localhost:6868`.

The image runs the daemon and serves the bundled web UI. It does not bundle agent CLIs, so extend it with the agents you use. See [Docker](/docs/docker) for Compose, reverse proxy, agent install, and security examples.

## Where next

- [Run parallel tasks](/docs/parallel-development), use separate worktrees, review diffs, and test changes in the desktop app.
- [Connectivity](/docs/connectivity), connect through the relay or Tailscale.
- [Docker](/docs/docker), run the daemon and bundled web UI in a container.
- [Workspaces](/docs/workspaces), the project, workspace, and session model Clisbot is built around.
- [Providers](/docs/providers), what a provider is and how Clisbot wraps existing CLIs.
- [Orchestration](/docs/orchestration), let one agent delegate work to other providers and models.
- [Plugins](/docs/plugins), add trusted local surfaces, sidebar actions, daemon behavior, and composer attachments.
- [CLI reference](/docs/cli), every command.
- [Self-hosting the web UI](/docs/web-ui), serve the browser app from your own daemon.
- [GitHub repo](https://github.com/longbkit/clisbot)
- [Report an issue](https://github.com/longbkit/clisbot/issues)

## Prerequisites

Clisbot manages other agents, it doesn't ship one. Before it's useful, install at least one provider CLI yourself and make sure it works with your credentials. See [Supported providers](/docs/supported-providers) for the full list.

You'll also want the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated, Clisbot uses it for PR-aware worktrees and a few orchestration features.
