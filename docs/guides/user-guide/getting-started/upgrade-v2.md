# Upgrade Clisbot 0.1.x to v2

[User guide](../README.md) · [Quick start](quick-start.md) · [Q&A](../help/faq.md)

V2 keeps the npm name `clisbot`, the `clis` command and the default home `~/.clisbot`. Requires Node.js 22.19 or later.

```bash
npm install -g clisbot@latest
npx --yes clisbot@latest onboard
```

Use `npx` to make sure you run the v2 CLI, even if `~/.clisbot/bin/clisbot` still points at the old version. For a different home, add `--home /path/to/home`. Then open the printed pairing link, as in the [quick start](quick-start.md#open-on-the-web-or-a-phone).

If systemd/launchd starts v1 automatically, stop that service first.

## What onboard does with the old home

- **Backs up** v1 configuration, state and temporary credentials to `<home>/backups/`.
- **Stops v1** when it can confirm the process belongs to this home; if unsure, it stops and does not start v2. It does not touch tmux sessions.
- **Creates `config.json`** for v2 if missing. The v1 `clisbot.json` stays as is. A valid `config.json` stays as is; a broken one is backed up and recreated.
- **Registers old working folders as Projects** without changing files. Code, `MEMORY.md`, `SOUL.md`, `USER.md`… stay as they are.

The result is written to `<home>/v1-upgrade.json` (no tokens). The backup folder may contain credentials; keep it private.

## What you redo by hand

- **Slack/Telegram/Zalo:** v2 manages channels in the Hub and does not migrate the old configuration yet. Run `clisbot hub start`, finish Account setup, create a Connection with the old token, set Rules for groups/DMs and allowed people, then link the owner when asked.
- Not migrated: running tmux sessions, pending prompts, loops, runner parameters, custom provider environment variables, the Zalo Personal sign-in.
- Provider history can be imported separately with `clisbot import` if the provider supports it.
- Instructions in a workspace that still mention old CLI commands need manual edits.

## When something fails

- Onboard reports a handoff error: v2 is not running. Fix the process or file it names, then run onboard again.
- V2 is running but a later step fails: check `clisbot status` and `<home>/daemon.log`.
- Going back to v1: stop v2 (`clisbot daemon stop`), reinstall the old npm version, restore the wrapper and credentials from the backup. Changes made in v2 do not carry back to v1.
