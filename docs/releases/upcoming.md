# Upcoming

Use this file as the staging area for work that is expected to become the next public release note.

For beta or pre-release builds, keep notes here until the public version ships. When the release note is cut, move the meaningful beta history into that version's `Pre-Release History` section.

## Summary

`v0.1.53-beta.2` is the second beta for the channel/control/config/agents
boundary cleanup and release-workflow hardening after `v0.1.52`. It fixes a
beta.1 runtime status regression for legacy configs that do not yet contain
disabled provider bot records for every built-in channel.

## Operator Impact

- Required action: beta testers should install from the `beta` npm dist-tag.
- Behavior users should notice: no intended user-facing command behavior change;
  CLI help, slash command help, queue, loop, and live Slack paths were
  regression-tested after the refactor.
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

## Non-Functional Changes

- Reduced duplicate release-process documentation so release mechanics have one
  owner: the `release-clisbot` skill.
- Kept release docs pointer-only where they previously duplicated npm commands.
- Added regression coverage for disabled/missing provider bot records across
  Slack, Telegram, and Zalo Bot runtime summaries.

## Update Notes

- Update path: `0.1.52` -> `0.1.53-beta.2`
- Manual action: none
- Risk level: medium because this is a broad refactor beta
- Automatic config update: no new schema migration is introduced by this beta

## Beta History

- `0.1.53-beta.1`: first broad boundary-refactor beta.
- `0.1.53-beta.2`: fixes runtime `status` summary rendering for legacy configs
  that omit disabled provider bot records, and adds regression coverage for the
  same class of mistake across built-in providers.

## Validation

- `bun run check`
- `bun run build`
- `git diff --check`
- `npm publish --dry-run --access public`
- Live Slack queue, loop, slash command, help, and message E2E were validated
  during the refactor test matrix.

## Links

- Migration index: [docs/migrations/index.md](../migrations/index.md)
- Release workflow: [skills/release-clisbot/SKILL.md](../../skills/release-clisbot/SKILL.md)
