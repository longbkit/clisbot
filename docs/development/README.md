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

## Channel Testing In Dev Mode

Use `clisbot-dev` for channel fixes. A channel bug should be reproducible,
fixed, and revalidated against `~/.clisbot-dev` before it needs an npm release.

Baseline loop:

```bash
export CLISBOT_HOME=~/.clisbot-dev
bun run restart
bun run status
~/.clisbot-dev/bin/clisbot-dev status
```

Use the wrapper for chat-facing operator actions:

```bash
~/.clisbot-dev/bin/clisbot-dev routes list --channel telegram
~/.clisbot-dev/bin/clisbot-dev queues status --channel telegram --target topic:<chat-id>:<topic-id>
~/.clisbot-dev/bin/clisbot-dev loops status --channel telegram --target topic:<chat-id>:<topic-id>
```

The wrapper matters because message-tool replies, queue settlement, loop
notifications, and runtime status must all read and write the same dev home.

For channel happy-path validation, run the matrix in
[`docs/tests/features/channels/channel-happy-path-matrix.md`](../tests/features/channels/channel-happy-path-matrix.md).
At minimum, a channel pass should cover:

- first-DM owner auto-claim or pairing inside the 30-minute claim window
- unrouted `/start`, `/status`, and `/whoami` guidance
- a second provider bot on another channel bound to agent `default`
- queues and loops from both CLI and slash command paths
- slash-command inventory and auth denials
- DM, group/shared surface, topic/thread when supported
- one attachment, attachment-only input, and multiple attachments where the
  provider supports them
- streaming off/on behavior according to provider capability
- processing indicator activation and cleanup, including detached sparse-follow
  and restart cleanup when supported

## npm Publish

Use the `release-clisbot` skill for beta/stable release sequencing, npm auth,
release notes, migration notes, GitHub Releases, tags, validation, and
post-publish checks.

This page intentionally does not repeat release commands. `AGENTS.md` owns the
repo command baseline, and [`release-process.md`](release-process.md) points to
the canonical release skill.
