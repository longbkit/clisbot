---
title: Getting started
description: Install Clisbot and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Clisbot runs your coding agents on your machine and gives you a mobile, desktop, web, and CLI client to drive them from anywhere. Install it with the desktop app, the CLI, or Docker.

## Desktop app (recommended)

Download from [clisbot.com/download](https://clisbot.com/download) or the [GitHub releases page](https://github.com/longbkit/clisbot/releases). Open it and you're done.

The desktop app bundles its own daemon and starts it automatically, no separate install required. On first launch you'll see a brief startup screen, then connect from your phone using **Settings → your host → Pair a device**.

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

## CLI

For headless machines, servers, or when you prefer the terminal. Requires Node.js 22.19 or newer.

```bash
npm install -g clisbot
clisbot
```

`clisbot` asks whether to enable voice, then picks a connection:

- Signed in to Tailscale: it uses Tailscale. If Tailscale Serve cannot expose the daemon, it falls back to the encrypted relay.
- No Tailscale: choose **Use encrypted relay** to connect from anywhere, or **Use this machine only**.

It starts the daemon in the background and prints a QR code and a pairing link. Each link pairs one device and expires after 5 minutes.

Run `clisbot` again whenever you need a new link or after a reboot. It reuses the running daemon, or starts it if it stopped. On a relay setup, run `clisbot --relay` so it does not ask for the connection again. For a first launch without prompts, use `clisbot --relay --voice disable`. Without an interactive terminal it skips prompts and keeps the saved voice setting (off on a fresh setup). Stop the daemon with `clisbot daemon stop`.

The daemon can also serve the browser web app itself. See [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `CLISBOT_HOME` (defaults to `~/.clisbot`). Upgrading from Clisbot 0.1.x? See [Upgrade to v2](/docs/upgrade-v2).

## Connect the web app or your phone

- **Browser:** open the pairing link. It opens [app.clisbot.com](https://app.clisbot.com) and connects.
- **Phone:** scan the QR code, or open the link in the phone's browser. The iOS and Android apps are not in the stores yet.
- **From the desktop app:** **Settings → your host → Pair a device** shows a new QR code.

## A daemon on another machine

1. SSH into the machine, run `npm install -g clisbot`, then `clisbot`. Choose Tailscale or the relay.
2. In the desktop app, choose **Add a Host → Paste pairing link** and paste the printed link. Or connect over [SSH](/docs/connectivity#ssh).
3. For your phone, run `clisbot` on that machine again and scan the new QR code.

## Join an existing Hub

- **Member:** accept the email invitation, then sign in with the **Clisbot Hub** tile on the Welcome screen or **Settings → Account**. Hosts shared with you appear in **Settings → Hosts**.
- **Add a machine to the Hub:** start the daemon on it, run `clisbot hub connect https://hub.example.com`, and open the printed URL. An Owner or Admin approves it. See [Hub daemons](/docs/hub/daemons).

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
