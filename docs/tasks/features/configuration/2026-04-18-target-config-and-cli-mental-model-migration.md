# Target Config And CLI Mental Model Migration

## Summary

Move the official `clisbot` product contract fully onto:

1. `app`
2. `bots`
3. `agents`

with `bots` and `routes` as the only official operator CLI surfaces for channel setup.

## Status

In Progress

## Why

The old `channels` and `accounts` mental model leaks across config, CLI, status, docs, and tests.

That creates the wrong product story even when parts of the runtime already support the new direction.

The migration goal is not a cosmetic rename. It must leave one obvious mental model for operators and one canonical config shape for runtime code.

## Scope

- keep the official template, docs, help text, and operator guidance on the new shape only
- make official runtime and control surfaces read `app`, `bots`, and `agents`
- make legacy command surfaces fail fast instead of silently mutating config
- migrate regression tests away from old-shape fixtures
- track remaining stale suites until the migration sweep is actually converged

## Goal Guardrail

Always judge follow-up work against the same north star:

- one obvious user mental model
- one canonical config shape
- no accidental drift back toward `channels` / `accounts` / `bindings` as official product language

## References

- [2026-04-18-target-config-and-cli-migration-inventory.md](../../research/configuration/2026-04-18-target-config-and-cli-migration-inventory.md)
- [cli-commands.md](../../../user-guide/cli-commands.md)
- [clisbot.json.template](../../../../config/clisbot.json.template)

## Progress So Far

### Done in this batch

- official template name restored at `config/clisbot.json.template`
- public docs and guidance swept toward `bots` and `routes`
- legacy `accounts` surface now fail-fast instead of mutating config
- route and bot-aware runtime resolution is in place for Slack and Telegram
- migrated regression coverage now includes the main config, bootstrap, runtime-summary, bot CLI, route CLI, startup-bootstrap, agent-service, Slack route, and Telegram route slices
- the previously stale regression sweep is now migrated and green
- current broad migration verification is green at `277 pass, 0 fail`
- `bunx tsc --noEmit` is now green in this workspace
- stale dead helpers that still carried `channels` / privilege-command guidance were removed
- remaining targeted test-doc coverage was updated to use `bots.*` config paths and `routes ...` setup commands
- the operator guide path now uses `bots-and-credentials.md` instead of the old `channel-accounts.md` wording
- the older message-actions task and feature docs were updated to read as bot-aware historical artifacts instead of active `channel accounts` guidance
- the main configuration feature docs now either use the bot-rooted contract directly or carry an explicit historical note when they still preserve pre-migration rollout detail
- selected historical task and research docs now carry explicit notes so old `accounts`, `channels`, and `defaultAccount` references do not read like live guidance
- the OpenClaw Telegram credential security research doc now also carries an explicit historical note

### Completed Checklist

- [x] official template name and examples point to `config/clisbot.json.template`
- [x] official config shape uses `app`, `bots`, and `agents`
- [x] official operator setup flow uses `bots` and `routes`
- [x] legacy `accounts` path no longer behaves like an official mutating surface
- [x] stale first-wave regression cluster moved onto the new shape
- [x] broad migration verification rerun after the sweep
- [x] typecheck rerun after the sweep
- [x] dead compatibility-only helper files with legacy guidance removed
- [x] targeted test-doc references updated away from old setup commands and config paths
- [x] operator docs and startup help now point to `bots-and-credentials.md`
- [x] the stale active task entry for old `channel accounts` wording was collapsed into a delivered bot-aware historical record
- [x] older feature docs were either updated to bot-rooted paths or marked historical where a full rewrite is not worth the churn right now
- [x] selected historical task and research docs now explicitly mark old `channels` and `accounts` language as research or rollout history
- [x] the OpenClaw Telegram credential security research doc now marks old `channels` and `accounts` nouns as historical research input

### Remaining obvious sweep

- no broad stale regression cluster remains from the original migration inventory
- any further work should be treated as convergence cleanup, not the first-wave migration blocker

### Follow-Up Items

- [ ] sweep older research and task docs that preserve migration history but still read too much like current guidance
- [ ] decide whether the migration task can move from `In Progress` to `Done` after that convergence cleanup, or whether another adjacent slice should stay attached here

### Known Follow-Up Targets

- older task or research docs that intentionally preserve history but currently read too much like live guidance
- `docs/research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md`
- `docs/research/ux/2026-04-14-cli-output-audit.md`
- `docs/tasks/features/configuration/2026-04-13-telegram-fast-start-and-credential-persistence.md`

## Next Steps

1. finish the convergence sweep on compatibility strings and older docs
2. once that sweep is done, reassess whether this task should move to `Done`
3. if future migration work reopens this area, start from the inventory doc instead of inventing a second mental model
