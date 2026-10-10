---
title: Upgrade to v2
description: Move from Clisbot 0.1.x to v2 in the same home, keeping your workspaces and memory files.
nav: Upgrade to v2
order: 3
category: Getting started
---

# Upgrade to v2

Clisbot v2 keeps the npm package `clisbot`, the `clis` command and the default home `~/.clisbot`. It needs Node.js 22.19 or newer.

```bash
npm install -g clisbot@latest
npx --yes clisbot@latest onboard
```

`npx` makes sure the v2 CLI runs even if `~/.clisbot/bin/clisbot` still points at the old install. For another home, add `--home /absolute/path`. Then open the printed pairing link, as in [Getting started](/docs#connect-the-web-app-or-your-phone).

If systemd or launchd starts v1 for you, stop that service first so it cannot restart v1.

## What happens to your old home

- **Backup:** the v1 config, runtime state and temporary credentials are copied to a private folder under `<home>/backups/`.
- **Stop v1:** only a process proven to be v1 in this home is stopped. If that cannot be proven, onboarding stops and v2 does not start. tmux sessions are left alone.
- **Config:** v2 creates `config.json` if it is missing. The v1 `clisbot.json` is not changed. A valid `config.json` is kept as is; an invalid one is backed up and replaced.
- **Projects:** your old agent folders are registered as Projects without changing their files. Code, `MEMORY.md`, `SOUL.md`, `USER.md` and other workspace files stay where they are.

`<home>/v1-upgrade.json` lists the backup, the stopped processes, the registered folders and what is left to do. It holds no tokens; the backup folder can, so keep it private.

## Set up again

- **Slack, Telegram and Zalo:** channels now live in the Hub, and v2 does not import the old setup. Run `clisbot hub start`, finish account setup, create a Connection with your existing token, set its Rules to the old groups, DMs and allowed people, then link the owner when asked.
- **Not converted:** running tmux sessions, queued prompts, loops, runner arguments, custom provider environment settings and Zalo Personal logins.
- **History:** import provider sessions with `clisbot import` where the provider supports it.
- **Instructions:** workspace files that mention old CLI commands need editing by hand.

## If something fails

- Onboarding reports a handover failure: v2 has not started. Fix the process or file it names and run onboarding again.
- v2 started but a later step failed: check `clisbot status` and `<home>/daemon.log`.
- Back to v1: run `clisbot daemon stop`, install the old npm version, and restore the wrapper and credentials from the backup. Changes made in v2 do not carry back to v1.
