# Upcoming

Use this file as the staging area for work that is expected to become the next public release note.

For beta or pre-release builds, keep notes here until the public version ships. When the release note is cut, move the meaningful beta history into that version's `Pre-Release History` section.

## Summary

`v0.1.53-beta.4` is the fourth beta for the channel/control/config/agents
boundary cleanup and release-workflow hardening after `v0.1.52`. It fixes a
beta.1 runtime status regression for legacy configs that do not yet contain
disabled provider bot records for every built-in channel, and removes
release-only recovery guidance from update help. It also fixes a CLI count-loop
regression where `clisbot loops create ... 3 ...` waited for the target session
to become idle instead of reserving queue items immediately.

## Operator Impact

- Required action: beta testers should install from the `beta` npm dist-tag.
- Behavior users should notice: CLI count/times loops now match chat `/loop`
  behavior by reserving all iterations as durable queue items immediately,
  including when the target session is already running.
- Compatibility notes: no manual config migration is required for this beta.
- Known risks: broad internal file moves may still expose stale import or package
  layout issues in environments not covered by the local/live test matrix.

## Functional Changes

- Reorganized channel integration boundaries around `integration`, `message`,
  `surface`, `config`, `pairing`, and provider-owned folders.
- Reorganized `control`, `config`, and `agents` into smaller owner folders with
  clearer command/runtime/session/queue/loop responsibilities.
- Added and installed the `release-clisbot` skill as the canonical beta/stable
  release workflow.
- Fixed runtime status rendering for installs whose config omits disabled
  provider bot records, such as a Slack/Telegram-only config that does not have
  `bots.zaloBot.default`.
- Kept enabled-provider config validation strict: an enabled provider still
  fails loudly when its configured default bot record is missing.
- Suppressed stale channel health details for disabled channels so old runtime
  metadata does not make a disabled provider look active.
- Removed release/publish recovery guidance from `clisbot update --help`; update
  help now stays scoped to install/update target choice, docs, install flow, and
  verification.
- Fixed CLI count/times loops so `clisbot loops create ... 3 ...` no longer
  waits for target-session idleness and instead persists every requested
  iteration as a pending queue item.

## Non-Functional Changes

- Reduced duplicate release-process documentation so release mechanics have one
  owner: the `release-clisbot` skill.
- Kept release docs pointer-only where they previously duplicated npm commands.
- Added regression coverage for disabled/missing provider bot records across
  Slack, Telegram, and Zalo Bot runtime summaries.
- Added regression coverage that update help does not mention publish recovery,
  npm login, EOTP, or `--otp`.
- Added regression coverage that CLI count loops persist queued iterations
  immediately even when the target session runtime is already `running`.
- Updated loop CLI help and user/docs test expectations so future agents see
  the queue-reservation contract instead of the removed synchronous CLI model.

## Update Notes

- Update path: `0.1.52` -> `0.1.53-beta.4`
- Manual action: none
- Risk level: medium because this is a broad refactor beta
- Automatic config update: no new schema migration is introduced by this beta

## Beta History

- `0.1.53-beta.1`: first broad boundary-refactor beta.
- `0.1.53-beta.2`: fixes runtime `status` summary rendering for legacy configs
  that omit disabled provider bot records, and adds regression coverage for the
  same class of mistake across built-in providers.
- `0.1.53-beta.3`: removes stale publish recovery text from
  `clisbot update --help`.
- `0.1.53-beta.4`: fixes CLI count/times loop creation to reserve durable
  queue items immediately instead of waiting for the target session to become
  idle.

## Validation

- `bun run check`
- `bun run build`
- `git diff --check`
- `npm publish --dry-run --access public`
- Targeted CLI/channel loop regression tests for count-loop queue reservation.
- Live Slack queue, loop, slash command, help, and message E2E were validated
  during the refactor test matrix.

## Links

- Migration index: [docs/migrations/index.md](../migrations/index.md)
- Release workflow: [skills/release-clisbot/SKILL.md](../../skills/release-clisbot/SKILL.md)
