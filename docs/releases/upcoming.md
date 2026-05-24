# Upcoming

Use this file as the staging area for work that is expected to become the next public release note.

For beta or pre-release builds, keep notes here until the public version ships. When the release note is cut, move the meaningful beta history into that version's `Pre-Release History` section.

## Summary

`v0.1.53-beta.6` is the sixth beta for the channel/control/config/agents
boundary cleanup and release-workflow hardening after `v0.1.52`. It fixes a
beta.1 runtime status regression for legacy configs that do not yet contain
disabled provider bot records for every built-in channel, and removes
release-only recovery guidance from update help. It also fixes a CLI count-loop
regression where `clisbot loops create ... 3 ...` waited for the target session
to become idle instead of reserving queue items immediately. The fifth beta
tightens queue/message-tool settlement, channel recent-context handling,
append-only Zalo Bot streaming truthfulness, and Slack persistent indicator
cleanup after runtime restart or reload. The sixth beta adds the larger
README/user-guide refresh, localized root README and user-guide mirrors, Zalo
Bot QR onboarding, and the Zalo Personal attachment/media-group and channel
operator documentation pass.

## Operator Impact

- Required action: beta testers should install from the `beta` npm dist-tag.
- Behavior users should notice: CLI count/times loops now match chat `/loop`
  behavior by reserving all iterations as durable queue items immediately,
  including when the target session is already running. Queued and immediate
  `message-tool` runs now share the same settlement rule: a fresh final
  `message-tool` reply wins, and pane-derived settlement is the fallback when no
  final tool reply arrives.
- Compatibility notes: no manual config migration is required for this beta.
- Known risks: broad internal file moves may still expose stale import or package
  layout issues in environments not covered by the local/live test matrix.
  Zalo Bot remains append-only and therefore does not support live draft
  streaming previews. The large README and localized-doc refresh should be
  reviewed for tone and link accuracy across languages before stable release.

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
- Fixed explicit `/queue` and route-queued `message-tool` settlement so queue
  start notifications are standalone lifecycle messages, not editable streaming
  drafts, and final settlement follows the same fresh-final-marker rule as
  normal prompt delivery.
- Fixed progress-only `message-tool` replies so they do not suppress pane
  fallback settlement unless a fresh final marker is present.
- Fixed recent conversation replay so Slack, Telegram, and Zalo Bot all store
  slash/control commands as marker-only entries instead of leaking prior control
  text into the next prompt.
- Fixed Zalo Bot live streaming truthfulness: Zalo Bot is append-only, so
  `/streaming on`, `/streaming latest`, and `/streaming all` now report that live
  preview streaming is unsupported instead of mutating config and duplicating
  progress bubbles.
- Fixed Slack processing indicators so assistant thread status clears when runs
  detach or complete, and stale persistent Slack statuses are swept for idle
  thread sessions when the Slack service starts after a restart or reload.
- Added Zalo Personal media and attachment handling updates, including local
  inbound image attachment staging, media-group coalescing, and clearer safe
  default guidance for personal-account DM/group routing.
- Added Zalo Bot setup onboarding with an embedded QR code for Zalo Bot Creator
  and a link to the official create-bot documentation.
- Reworked the root README into the main FAQ/troubleshooting and quick-start
  surface, including OpenClaw/Hermes positioning, supported channel capability
  mapping, AI-assisted setup prompts, bug-report guidance, and channel-specific
  guide links.

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
- Added cross-channel regression coverage for queue/message-tool settlement,
  append-only Zalo Bot streaming, recent-context slash command filtering, and
  Slack persistent indicator recovery.
- Updated channel integration and agent progress docs to make live reply update
  capability explicit: channels that cannot update or clear an existing reply
  must not fake streaming reconcile by posting duplicate progress messages.
- Added localized root README mirrors and user-guide mirrors for Vietnamese,
  Simplified Chinese, and Korean where the current documentation architecture
  supports them.
- Added surface-access model documentation and generic README backup in
  `docs/user-guide/` so the new root README can stay focused on user-facing
  onboarding and FAQ content.

## Update Notes

- Update path: `0.1.52` -> `0.1.53-beta.6`
- Manual action: none
- Risk level: medium because this is a broad refactor beta
- Automatic config update: yes; configs before schema `0.1.53` are backed up
  and rewritten to add the new admin-only sensitive channel permissions

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
- `0.1.53-beta.5`: fixes queue/message-tool settlement, recent-context command
  filtering, Zalo Bot append-only streaming truthfulness, and Slack persistent
  indicator cleanup after restart or reload.
- `0.1.53-beta.6`: adds the README/user-guide refresh, localized docs mirrors,
  Zalo Bot QR onboarding, and Zalo Personal attachment/media-group guidance.

## Validation

- `bun run check`
- `bun run build`
- `git diff --check`
- `npm publish --dry-run --access public`
- Targeted CLI/channel loop regression tests for count-loop queue reservation.
- Targeted queue/message-tool, recent-context, Zalo Bot, Slack indicator, and
  channel breadth regression tests.
- Live Slack queue, loop, slash command, help, and message E2E were validated
  during the refactor test matrix.

## Links

- Migration index: [docs/migrations/index.md](../migrations/index.md)
- Release workflow: [skills/release-clisbot/SKILL.md](../../skills/release-clisbot/SKILL.md)
