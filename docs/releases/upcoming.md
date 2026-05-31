# Upcoming

Use this file as the staging area for work that is expected to become the next public release note.

For beta or pre-release builds, keep notes here until the public version ships. When the release note is cut, move the meaningful beta history into that version's `Pre-Release History` section.

## Summary

`0.1.54-beta.1` starts the API channel hardening beta after `v0.1.53`.
It focuses on API ingress/operator docs, result persistence safety, and
follow-up backlog clarity before a future stable `v0.1.54`.

## Operator Impact

- Required action: none.
- Behavior users should notice: API bot result polling and `message.send`
  replies are safer under concurrent API listener / one-shot CLI writes.
- Compatibility notes: API listener default port is now `6868`.
- Known risks: global runner admission/backpressure is still planned; high-burst
  API traffic across many conversations can still start many runner sessions.

## Functional Changes

### Channels

- Added the first end-to-end API channel MVP follow-up docs for Chatwoot/Jira
  style ingress, result polling, and optional `actions.message.send`.
- Changed API event examples toward URL-friendly event ids and simpler local
  conversation/surface mapping.
- Fixed API message reply routing so explicit `--reply-to` uses that event's
  reply metadata.
- Fixed default API event ids to use a timestamp when mapping omits `eventId`.

## Non-Functional Changes

### Stability

- Fixed channel result persistence so concurrent result-store writers do not
  lose records or outputs.
- Added shared JSON storage guidance and a persistence-store inventory to reduce
  unplanned JSON store sprawl.
- Added a planned backlog item for global runner admission and API burst
  backpressure.

### Architecture Conformance

- Documented cross-process runtime state rules and API channel domain wording
  around conversation/surface terminology.

## Update Notes

- Update path: direct from `0.1.53` to `0.1.54-beta.1`.
- Manual action: none.
- Risk level: medium for API channel adopters; low for non-API-channel users.
- Automatic config update: no new schema migration in this beta.

## Beta History

- `0.1.54-beta.1`: API channel MVP hardening, result persistence concurrency
  fix, API listener default port `6868`, API docs, and backlog item for global
  runner admission/backpressure.

## Validation

- `bun test test/api-channel.test.ts test/api-message-actions.test.ts test/api-auth.test.ts test/channel-results-store.test.ts test/json-storage.test.ts`: 28 pass, 0 fail.
- `bun run check`: 978 pass, 0 fail.
- `bun run build`: pass.
- `git diff --check`: pass.
- `npm publish --dry-run --access public`: pass.

## Links

- Release guide: [docs/updates/releases/v0.1.54-beta.1-release-guide.md](../updates/releases/v0.1.54-beta.1-release-guide.md)
- Migration index: [docs/migrations/index.md](../migrations/index.md)
- Release workflow: [skills/release-clisbot/SKILL.md](../../skills/release-clisbot/SKILL.md)
