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
- route CLI positional parsing now skips option values correctly, so `--bot <id>` and similar flags no longer get misread as route ids when the route comes later in the command
- route removal and route listing now fail truthfully on missing routes or invalid `--channel` filters instead of silently implying success or showing empty output
- internal config helpers now expose bot-named resolution helpers alongside the compatibility account-named wrappers, and core config consumers now use the bot-named path
- active runtime summaries and configured-credential status lines now say `bot` instead of `account`, so operator-facing status output matches the official mental model
- the runtime channel plugin seam is now bot-oriented too: internal types and callbacks now use `listBots`, `botId`, and bot-shaped runtime identities instead of account-named variants
- runtime health persistence now normalizes older `accountId` entries to `botId` when reading the health file, so the cleanup does not break existing debug or recovery state on disk
- runtime supervisor failure details and owner-alert routing now also use bot-oriented wording and local naming, which keeps first-run and recovery behavior more reviewable from the user surface
- runtime health summaries now render instance labels as `bot=<id>` instead of a bare leading token, which makes the status surface easier to scan without knowing older internals
- a dedicated regression test now covers legacy runtime-health records that still persist `accountId`, so the compatibility path is explicit instead of assumed
- the internal message-command plugin seam now uses `botId` too: `runMessageCommand(...)` returns `botId`, `resolveMessageReplyTarget(...)` receives `botId`, and the message CLI now passes bot-oriented identity through that path
- the bootstrap and credential seam now also uses bot-oriented naming through the live implementation path: parsed bootstrap flags, mem-credential staging, credential resolution, persistence, source reporting, and startup help all converge on `botId`, while compatibility `accountId` aliases stay only where needed to avoid hidden breakage
- the provider plugin seam now resolves and lists Slack and Telegram bots via bot-named helpers (`resolve*BotCredentials`, `list*Bots`) instead of account-named helpers, so runtime startup and message actions no longer translate back into the older noun on their main code path
- the latest convergence verification reran the entire repo test suite and typecheck after this cleanup: `bun test` is green at `546 pass, 0 fail`, and `bunx tsc --noEmit` is green
- the deeper conversation-identity seam is now cleaner too: channel identity, session-target builders, route resolution, loop surface binding, agent prompt reply scaffolding, and Slack or Telegram runtime services now use `botId` on their main internal path instead of carrying `accountId` as the live noun
- canonical internal config module names are now bot-oriented too:
  - `src/config/channels/channel-bots.ts` is now the main implementation file for Slack and Telegram bot config helpers
  - `src/config/channels/channel-bot-management.ts` is now the main implementation file for bootstrap bot mutation helpers
- the temporary shim files at the older `channel-accounts.ts` and `channel-account-management.ts` paths have now been removed entirely after the remaining internal and test imports were migrated
- internal Slack and Telegram runtime services now carry `botCredentials` and bot-credential types on their main path instead of `accountConfig`
- binding helpers now accept `botId` as the canonical internal field while still tolerating `accountId` where the public binding contract still uses it
- the `fast start e2e` stop-path timeout was raised to match the rest of the spawned-process suite, so full-repo verification no longer flakes under heavier suite load
- compatibility stays explicit where it is still justified:
  - public binding syntax and older helper wrappers can still accept `accountId`
  - stored loop surface binding still tolerates legacy `accountId` state while resolving to `botId` internally
- latest verification after this deeper identity cleanup:
  - full suite rerun green again: `bun test` => `546 pass, 0 fail`
  - local TypeScript binary rerun green: `./node_modules/.bin/tsc --noEmit`

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
- [x] route CLI positional parsing and validation no longer hide obvious operator mistakes
- [x] internal helper naming has started converging on `bot` for config ownership and resolution
- [x] operator-facing status wording no longer says `account` for Slack and Telegram bot summaries
- [x] runtime startup and health-reporting seams now use bot-oriented internal naming instead of account-oriented type names
- [x] runtime health file reads preserve debug/recovery truth while tolerating older `accountId` records
- [x] runtime health status lines identify instances as bots explicitly instead of relying on bare ids
- [x] legacy runtime health record normalization is covered by a dedicated regression test
- [x] message-command plugin internals now use bot-oriented identity instead of account-oriented callback payloads
- [x] bootstrap, credential resolution, credential persistence, and startup-help seams now use bot-oriented naming on the main implementation path
- [x] provider plugin credential helpers now expose bot-named resolve/list helpers and the main Slack/Telegram plugin path consumes them directly
- [x] full repo verification was rerun after the deeper cleanup, not just a targeted subset
- [x] channel identity, route resolution, session-target builders, loop surface binding, and runtime channel services now use bot-oriented naming on the main internal path
- [x] stored loop surface binding preserves explicit compatibility for older `accountId` state while the runtime resolves it as `botId`
- [x] TypeScript verification now passes again with the local compiler binary after the latest identity cleanup
- [x] canonical internal config helper modules now use bot-oriented filenames, with compatibility shim files left behind only as bounded bridges
- [x] the temporary shim files were removed after the remaining imports were moved onto the bot-oriented module paths
- [x] internal Slack and Telegram runtime services now use bot-credential type names and `botCredentials` locals on the main implementation path
- [x] full-suite e2e verification no longer flakes on the fast-stop spawned-process path under normal suite load

### Remaining obvious sweep

- no broad stale regression cluster remains from the original migration inventory
- any further work should be treated as convergence cleanup, not the first-wave migration blocker
- the remaining live-code `accountId` usage is now concentrated in compatibility surfaces and deliberately preserved public string contracts, not in the main runtime identity path

### Follow-Up Items

- [ ] sweep older research and task docs that preserve migration history but still read too much like current guidance
- [ ] decide whether any remaining compatibility `accountId` aliases should be removed entirely, or whether they should stay as a bounded bridge for public binding syntax and historical state
- [ ] decide whether the migration task can move from `In Progress` to `Done` after that convergence cleanup, or whether another adjacent slice should stay attached here

### Known Follow-Up Targets

- older task or research docs that intentionally preserve history but currently read too much like live guidance
- `docs/research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md`
- `docs/research/ux/2026-04-14-cli-output-audit.md`
- `docs/tasks/features/configuration/2026-04-13-telegram-fast-start-and-credential-persistence.md`
- bounded compatibility seams such as public binding syntax, selected helper wrappers, and historical persisted state that still tolerate `accountId`

## Next Steps

1. finish the convergence sweep on compatibility strings and older docs
2. once that sweep is done, reassess whether this task should move to `Done`
3. if future migration work reopens this area, start from the inventory doc instead of inventing a second mental model
