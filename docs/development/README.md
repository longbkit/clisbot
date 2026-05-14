# Development Guide

## Purpose

Use this guide for local development flows that should not distract from the public first-run path in the main `README.md`.

## Separate Dev Home

Repo-local `bun run start`, `bun run stop`, `bun run restart`, `bun run status`, `bun run logs`, `bun run init`, and `bun run pairing` now read the repo `.env` and use `CLISBOT_HOME` as the single home selector.

Default repo-local setup:

```bash
CLISBOT_HOME=~/.clisbot-dev
CLISBOT_CLI_NAME=clisbot-dev
```

That means the convenience scripts stay pinned to `~/.clisbot-dev` even if your shell still has stale `CLISBOT_CONFIG_PATH`, `CLISBOT_PID_PATH`, or `CLISBOT_LOG_PATH` exported from another runtime.
`CLISBOT_CLI_NAME` keeps repo-local help text, prompt permission guidance, and monitor-spawned runtime messages aligned with the `clisbot-dev` command name.

If you want to run a dev instance beside your main bot, keep using a separate `CLISBOT_HOME`:

```bash
export CLISBOT_HOME=~/.clisbot-dev
bun run start --cli codex --bot-type team --telegram-bot-token DEV_TELEGRAM_BOT_TOKEN
```

What this changes:

- `CLISBOT_HOME` changes the default config path
- `CLISBOT_HOME` changes the runtime state directory
- `CLISBOT_HOME` changes the tmux socket path
- `CLISBOT_HOME` changes the local wrapper path
- `CLISBOT_HOME` changes the default workspace root

Direct CLI overrides such as `CLISBOT_CONFIG_PATH`, `CLISBOT_PID_PATH`, and `CLISBOT_LOG_PATH` still work when you invoke `clisbot ...` or `bun run src/main.ts ...` manually. They are no longer part of the repo-local default flow because `CLISBOT_HOME` is the intended source of truth.

## npm Publish

Use the `release-clisbot` skill for beta/stable release sequencing, npm auth,
release notes, migration notes, GitHub Releases, tags, validation, and
post-publish checks.

This page intentionally does not repeat release commands. `AGENTS.md` owns the
repo command baseline, and [`release-process.md`](release-process.md) points to
the canonical release skill.
