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

Current preferred publish flow is the same 2-step operator flow that already succeeded for `clisbot@0.1.22`.

Use this sequence unless the operator explicitly asks for something else:

1. authenticate first:

```bash
npm login
```

2. publish the current package publicly:

```bash
npm publish --access public
```

Remote operator flow:

- if the assistant is operating the repo remotely for the operator, the assistant should run `npm login` or `npm publish --access public` directly in an attached session
- if npm returns a browser approval URL such as `https://www.npmjs.com/auth/cli/...`, the assistant should send that exact link to the operator and wait for approval
- after the operator approves in the browser, the assistant should continue the same attached session instead of switching to a separate manual flow
- do not rewrite the documented command into a special OTP-only variant unless the operator explicitly asks for that path

Notes:

- do not skip the explicit `npm login` step if auth might be stale
- keep the login or publish process attached so the operator can complete npm approval or browser confirmation if npm asks for it
- after publish, verify the live version with:

```bash
npm view clisbot version
```

- the package that gets published is the local repo state at publish time, not automatically `origin/main`
